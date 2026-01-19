import torch as th
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import SubprocVecEnv, VecFrameStack, VecNormalize
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.callbacks import CheckpointCallback
from gymnasium.wrappers import TimeLimit
from envs.fighting_env import FightingGameEnv
import os

def make_env(rank, seed=0):
    def _init():
        env = FightingGameEnv()
        env = TimeLimit(env, max_episode_steps=800)
        env = Monitor(env)
        env.reset(seed=seed + rank)
        return env
    return _init

def train():
    # 1. Configuration
    num_cpu = 10 
    total_timesteps = 5_000_000
    
    # 2. Setup Parallel Environments
    print(f"Initializing {num_cpu} parallel environments...")
    env = SubprocVecEnv([make_env(i) for i in range(num_cpu)])
    env = VecFrameStack(env, n_stack=4)
    # Add normalization for observations and rewards
    env = VecNormalize(env, norm_obs=True, norm_reward=True, clip_obs=10.)
    
    # 3. Setup PPO with ReLU for better TFJS compatibility
    policy_kwargs = dict(activation_fn=th.nn.ReLU)
    
    model = PPO(
        "MlpPolicy",
        env,
        policy_kwargs=policy_kwargs,
        device="cpu", 
        verbose=1,
        tensorboard_log="./logs/ppo_fighting_fast/",
        learning_rate=1e-4, 
        n_steps=2048, 
        batch_size=256,
        n_epochs=10,
        gamma=0.99,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.02, # Slightly higher entropy to encourage breaking out of "staring contest"
    )
    
    # 4. Callbacks
    checkpoint_callback = CheckpointCallback(
        save_freq=max(100_000 // num_cpu, 1),
        save_path="./models/",
        name_prefix="ppo_fast_checkpoint"
    )
    
    print(f"Starting High-Speed CPU training for {total_timesteps} steps...")
    model.learn(total_timesteps=total_timesteps, callback=checkpoint_callback)
    
    # 5. Save
    os.makedirs("models", exist_ok=True)
    model.save("models/neural_nemesis_pro")
    # Save the normalization stats as well
    env.save("models/vec_normalize.pkl")
    print("Training Complete. Model and stats saved to models/")

if __name__ == "__main__":
    train()
