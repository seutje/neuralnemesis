import gymnasium as gym
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv, VecFrameStack
from stable_baselines3.common.evaluation import evaluate_policy
from envs.fighting_env import FightingGameEnv
import os

def train():
    # Create environment
    def make_env():
        return FightingGameEnv()
    
    env = DummyVecEnv([make_env])
    # Frame stacking as per DESIGN.md Section 3.1
    env = VecFrameStack(env, n_stack=4)
    
    # Setup PPO as per DESIGN.md Section 4
    # Note: We use MlpPolicy which is compatible with VecFrameStack (it flattens the input)
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
    
    # Train for 200k timesteps (enough for a good demo against random bot)
    print("Starting training for 200,000 timesteps...")
    model.learn(total_timesteps=200_000)
    
    # Save the model
    os.makedirs("backend_train/models", exist_ok=True)
    model.save("backend_train/models/neural_nemesis_pro")
    print("Model saved to backend_train/models/neural_nemesis_pro.zip")
    
    # Verification: Evaluate against random bot
    print("Evaluating model...")
    mean_reward, std_reward = evaluate_policy(model, env, n_eval_episodes=20)
    print(f"Mean reward: {mean_reward} +/- {std_reward}")

if __name__ == "__main__":
    train()
