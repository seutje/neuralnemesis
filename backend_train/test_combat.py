from envs.fighting_env import FightingGameEnv
import numpy as np

def test_combat_logic():
    env = FightingGameEnv()
    env.reset()
    
    # Place players close to each other
    env.p1_x = 300
    env.p2_x = 320 # Close enough for collision (width is 50)
    env.p1_y = env.GROUND_Y - env.PLAYER_HEIGHT
    env.p2_y = env.GROUND_Y - env.PLAYER_HEIGHT
    
    # Player 1 performs Light Attack (action 6)
    # Light attack duration is 22 frames, hit phase starts at 4
    print("Starting light attack...")
    hit_detected = False
    total_reward = 0
    
    for i in range(30):
        # We only send the action once to start the attack, 
        # then send Idle (0) while the timer handles the animation
        action = 6 if i == 0 else 0
        obs, reward, terminated, truncated, info = env.step(action)
        total_reward += reward
        
        if env.p2_health < 100 and not hit_detected:
            print(f"Hit detected on frame {i}!")
            print(f"P2 Health: {env.p2_health}")
            hit_detected = True
            
    print(f"Total Reward over 30 frames: {total_reward:.2f}")
    
    assert hit_detected, "Player 2 should have taken damage within 30 frames"
    assert total_reward > 5.0, f"Reward should be significant for dealing damage, got {total_reward}"
    print("Combat logic verification successful!")

if __name__ == "__main__":
    test_combat_logic()
