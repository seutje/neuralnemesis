import gymnasium as gym
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv, VecFrameStack
from stable_baselines3.common.evaluation import evaluate_policy
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.callbacks import CheckpointCallback
from gymnasium.wrappers import TimeLimit
from envs.fighting_env import FightingGameEnv
import os

def train():
    # Create environment
    def make_env():
        env = FightingGameEnv()
        # Ensure a hard limit at the wrapper level too
        env = TimeLimit(env, max_episode_steps=2000)
        env = Monitor(env)
        return env
    
    env = DummyVecEnv([make_env])
    # Frame stacking as per DESIGN.md Section 3.1
    env = VecFrameStack(env, n_stack=4)
    
    # Setup PPO as per DESIGN.md Section 4
    model = PPO(
        "MlpPolicy",
        env,
        verbose=1,
        tensorboard_log="./logs/ppo_fighting_game/",
        learning_rate=3e-4,
        n_steps=2048,
        batch_size=64,
        n_epochs=10,
        gamma=0.99,
        gae_lambda=0.95,
        clip_range=0.2,
    )
    
    # Setup Checkpoint Callback
    checkpoint_callback = CheckpointCallback(
        save_freq=100_000,
        save_path="./models/",
        name_prefix="ppo_fighting_checkpoint"
    )
    
    # Train for 1M timesteps as per PLAN.md
    print("Starting training for 1,000,000 timesteps...")
    model.learn(total_timesteps=1_000_000, callback=checkpoint_callback)
    
    # Save the final model
    os.makedirs("models", exist_ok=True)
    model.save("models/neural_nemesis_pro")
    print("Model saved to models/neural_nemesis_pro.zip")
    
    # Verification: Evaluate against random bot
    print("Evaluating model...")
    mean_reward, std_reward = evaluate_policy(model, env, n_eval_episodes=20)
    print(f"Mean reward: {mean_reward} +/- {std_reward}")

if __name__ == "__main__":
    train()
