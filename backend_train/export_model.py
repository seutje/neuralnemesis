import torch as th
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv, VecFrameStack
from envs.fighting_env import FightingGameEnv
import os
import subprocess

def export_model(model_path, onnx_path):
    # Load the model
    # We need an env to load the model correctly if we want to trace it
    def make_env():
        return FightingGameEnv()
    
    env = DummyVecEnv([make_env])
    env = VecFrameStack(env, n_stack=4)
    
    model = PPO.load(model_path, env=env)
    
    # Create a wrapper to export to ONNX
    class OnnxablePolicy(th.nn.Module):
        def __init__(self, policy):
            super().__init__()
            self.policy = policy

        def forward(self, observation):
            # SB3 policy returns a tuple (action, value, log_prob)
            # For inference we only need the action distribution or the action itself
            # DESIGN.md Section 6.2 says we need the action probabilities for "Difficulty Presets"
            # and Value for "AI Confidence".
            return self.policy(observation)

    # SB3 ActorCriticPolicy forward returns (latent_pi, latent_vf, latent_sre)
    # But we want the actual action distribution and value
    
    class FullOnnxModel(th.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.policy = model.policy
        
        def forward(self, obs):
            # obs shape: (batch, n_stack * features)
            # In SB3, policies first extract features
            features = self.policy.features_extractor(obs)
            latent_pi, latent_vf = self.policy.mlp_extractor(features)
            distribution = self.policy._get_action_dist_from_latent(latent_pi)
            # We want the distribution parameters (e.g. logits for Discrete)
            logits = distribution.distribution.logits
            value = self.policy.value_net(latent_vf)
            return logits, value

    onnx_model = FullOnnxModel(model)
    onnx_model.to("cpu")
    onnx_model.eval()
    
    # Input shape: (1, 14 * 4) = (1, 56)
    dummy_input = th.randn(1, 56).to("cpu")
    
    th.onnx.export(
        onnx_model,
        (dummy_input,),
        onnx_path,
        verbose=True,
        input_names=["input"],
        output_names=["logits", "value"],
        opset_version=12
    )
    print(f"Model exported to {onnx_path}")

def convert_to_tfjs(onnx_path, output_dir):
    # 1. Convert ONNX to SavedModel using onnx2tf
    saved_model_path = "backend_train/models/saved_model"
    print(f"Converting ONNX to SavedModel: {onnx_path} -> {saved_model_path}")
    
    # Run onnx2tf
    subprocess.run([
        "onnx2tf",
        "-i", onnx_path,
        "-o", saved_model_path,
        "-nonc" # No non-constant weights for optimization? Actually let's use default
    ], check=True)
    
    # 2. Convert SavedModel to TFJS
    print(f"Converting SavedModel to TFJS: {saved_model_path} -> {output_dir}")
    os.makedirs(output_dir, exist_ok=True)
    
    subprocess.run([
        "tensorflowjs_converter",
        "--input_format=tf_saved_model",
        "--output_format=tfjs_graph_model",
        saved_model_path,
        output_dir
    ], check=True)
    print("Conversion to TFJS complete.")

if __name__ == "__main__":
    model_file = "backend_train/models/test_model"
    if os.path.exists("backend_train/models/neural_nemesis_pro.zip"):
        model_file = "backend_train/models/neural_nemesis_pro"
        
    onnx_file = "backend_train/models/model.onnx"
    tfjs_output = "frontend_web/public/assets/model/"
    
    export_model(model_file, onnx_file)
    convert_to_tfjs(onnx_file, tfjs_output)
