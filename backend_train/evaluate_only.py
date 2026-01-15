import gymnasium as gym
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv, VecFrameStack, VecNormalize
from stable_baselines3.common.evaluation import evaluate_policy
from stable_baselines3.common.monitor import Monitor
from gymnasium.wrappers import TimeLimit
from envs.fighting_env import FightingGameEnv
import os

def evaluate():
    # 1. Setup the exact same environment pipeline used in training
    def make_env():
        env = FightingGameEnv()
        env = TimeLimit(env, max_episode_steps=2000)
        env = Monitor(env)
        return env
    
    env = DummyVecEnv([make_env])
    env = VecFrameStack(env, n_stack=4)
    
    # Load normalization stats
    stats_path = "models/vec_normalize.pkl"
    if not os.path.exists(stats_path):
        stats_path = os.path.join(os.path.dirname(__file__), "models/vec_normalize.pkl")
    
    if os.path.exists(stats_path):
        print(f"Loading normalization stats from {stats_path}...")
        env = VecNormalize.load(stats_path, env)
        # Disable training mode for normalization
        env.training = False
        # Reward normalization is not needed during evaluation
        env.norm_reward = False
    else:
        print("Warning: Normalization stats not found. Evaluation might be inaccurate.")
    
    # 2. Load the trained model
    # ... (rest of the logic remains similar)
    possible_paths = [
        "models/neural_nemesis_pro.zip",
        "backend_train/models/neural_nemesis_pro.zip",
        os.path.join(os.path.dirname(__file__), "models/neural_nemesis_pro.zip")
    ]
    
    model_path = None
    for p in possible_paths:
        if os.path.exists(p):
            model_path = p
            break
            
    if not model_path:
        print(f"Error: Model not found. Checked: {possible_paths}")
        return

    print(f"Loading model from {model_path}...")
    model = PPO.load(model_path, env=env)
    
    # 3. Run evaluation
    print("Evaluating for 20 episodes...")
    wins = 0
    total_reward = 0
    
    for i in range(20):
        obs = env.reset()
        done = False
        episode_reward = 0
        while not done:
            action, _ = model.predict(obs, deterministic=True)
            obs, reward, done_vec, info = env.step(action)
            
            # VecNormalize returns original rewards in info
            unnormalized_reward = env.get_original_reward()[0]
            episode_reward += unnormalized_reward
            done = done_vec[0]
            
            # Use get_attr for robust debugging across wrappers
            if i == 0:
                # Note: after reset, step is 0. But env.step() returns the state AFTER the step.
                # So we can see the progress.
                pass
            
            # Check for win
            if done:
                # If unnormalized_reward is large, it means we got the +100 win bonus
                if unnormalized_reward > 50:
                    wins += 1
        
        total_reward += episode_reward
        print(f"Episode {i+1}: Reward = {episode_reward:.2f}")

    win_rate = (wins / 20) * 100
    mean_reward = total_reward / 20
    
    print("\n" + "="*30)
    print(f"EVALUATION RESULTS")
    print(f"Win Rate: {win_rate:.1f}%")
    print(f"Mean Reward: {mean_reward:.2f}")
    print("="*30)
    
    if win_rate >= 80:
        print("VERIFICATION: PASSED (>80% Win Rate)")
    else:
        print("VERIFICATION: FAILED (<80% Win Rate)")

if __name__ == "__main__":
    evaluate()
