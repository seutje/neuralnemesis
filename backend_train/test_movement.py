from envs.fighting_env import FightingGameEnv
import numpy as np

def test_movement_reward():
    env = FightingGameEnv()
    env.reset()
    
    # Force players to be far apart
    env.p1_x = 100
    env.p2_x = 700
    env.prev_dist = 600/800
    
    print(f"Starting distance: {abs(env.p1_x - env.p2_x)}")
    
    # Move Player 1 Right (action 2)
    total_reward = 0
    for i in range(10):
        obs, reward, terminated, truncated, info = env.step(2)
        total_reward += reward
        
    print(f"Final distance: {abs(env.p1_x - env.p2_x)}")
    print(f"Total movement reward: {total_reward:.4f}")
    
    assert abs(env.p1_x - env.p2_x) < 600, "Player 1 should have moved closer"
    assert total_reward > 0.2, f"Reward should be positive for closing distance, got {total_reward}"
    print("Movement reward verification successful!")

if __name__ == "__main__":
    test_movement_reward()
