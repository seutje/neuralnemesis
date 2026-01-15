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
    # We need to call step multiple times or manually trigger resolve_combat
    # Let's use step
    obs, reward, terminated, truncated, info = env.step(6)
    
    print(f"P2 Health after attack: {env.p2_health}")
    print(f"Reward: {reward}")
    
    assert env.p2_health < env.MAX_HEALTH, "Player 2 should have taken damage"
    assert reward > 0, "Reward should be positive for dealing damage"
    print("Combat logic verification successful!")

if __name__ == "__main__":
    test_combat_logic()
