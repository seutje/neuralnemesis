from envs.fighting_env import FightingGameEnv
import numpy as np

def verify_env():
    env = FightingGameEnv()
    obs, info = env.reset()
    print(f"Initial observation: {obs}")
    print(f"Observation space shape: {env.observation_space.shape}")
    
    sample = env.observation_space.sample()
    print(f"Sample observation: {sample}")
    
    assert env.observation_space.contains(obs), "Initial observation out of bounds"
    assert env.observation_space.contains(sample), "Sample observation out of bounds"
    print("Verification successful!")

if __name__ == "__main__":
    verify_env()
