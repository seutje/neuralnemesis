import torch as th
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv, VecFrameStack, VecNormalize
from envs.fighting_env import FightingGameEnv
import os
import subprocess
import json
import numpy as np

def export_model(model_path, onnx_path):
    # Load the model
    def make_env():
        return FightingGameEnv()
    
    env = DummyVecEnv([make_env])
    env = VecFrameStack(env, n_stack=4)
    
    # Load model
    print(f"Loading model from {model_path}...")
    model = PPO.load(model_path, env=env)
    
    class FullOnnxModel(th.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.policy = model.policy
        
        def forward(self, obs):
            # obs shape: (batch, n_stack * features)
            features = self.policy.features_extractor(obs)
            latent_pi, latent_vf = self.policy.mlp_extractor(features)
            
            # Action distribution logits
            logits = self.policy.action_net(latent_pi)
            
            # Value estimate
            value = self.policy.value_net(latent_vf)
            
            return logits, value

    onnx_model = FullOnnxModel(model)
    onnx_model.to("cpu")
    onnx_model.eval()
    
    # Input shape: (1, 16 * 4) = (1, 64)
    dummy_input = th.randn(1, 64).to("cpu")
    
    th.onnx.export(
        onnx_model,
        (dummy_input,),
        onnx_path,
        verbose=False,
        input_names=["input"],
        output_names=["logits", "value"],
        opset_version=12
    )
    print(f"Model exported to {onnx_path}")

def export_stats(stats_path, output_json):
    def make_env():
        return FightingGameEnv()
    
    venv = DummyVecEnv([make_env])
    venv = VecFrameStack(venv, n_stack=4)
    
    print(f"Loading normalization stats from {stats_path}...")
    vn = VecNormalize.load(stats_path, venv)
    
    # In SB3, obs_rms is a RunningMeanStd object for non-dict spaces
    # We can access mean and var directly
    obs_rms = vn.obs_rms
    
    stats = {
        "mean": obs_rms.mean.tolist(),
        "variance": obs_rms.var.tolist(),
        "epsilon": float(1e-8) # Default epsilon used in RunningMeanStd
    }
    
    os.makedirs(os.path.dirname(output_json), exist_ok=True)
    with open(output_json, "w") as f:
        json.dump(stats, f)
    print(f"Normalization stats exported to {output_json}")

def convert_to_tfjs(onnx_path, output_dir):
    # 1. Convert ONNX to SavedModel using onnx2tf
    # We'll use a temp directory for the saved_model
    saved_model_path = "models/saved_model"
    print(f"Converting ONNX to SavedModel: {onnx_path} -> {saved_model_path}")
    
    # Run onnx2tf
    subprocess.run([
        "onnx2tf",
        "-i", onnx_path,
        "-o", saved_model_path,
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
    # Ensure we are in the backend_train directory or handle paths
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    model_file = os.path.join(base_dir, "models/neural_nemesis_pro")
    stats_file = os.path.join(base_dir, "models/vec_normalize.pkl")
    onnx_file = os.path.join(base_dir, "models/model.onnx")
    
    tfjs_output = os.path.abspath(os.path.join(base_dir, "../frontend_web/public/assets/model/"))
    stats_output = os.path.join(tfjs_output, "norm_stats.json")
    
    if os.path.exists(model_file + ".zip"):
        export_model(model_file, onnx_file)
        if os.path.exists(stats_file):
            export_stats(stats_file, stats_output)
        convert_to_tfjs(onnx_file, tfjs_output)
    else:
        print(f"Error: Model not found at {model_file}.zip")
