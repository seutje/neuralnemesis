# Design Document: Neural Nemesis

## Browser-Based Adaptive Fighting Game AI

### 1. Project Overview

**Title:** Neural Nemesis
**Objective:** To build a 3D (but fixed to a 2D plane with side-view) web-based 1v1 fighting game where the CPU opponent is driven by a Deep Reinforcement Learning (DRL) agent. The agent is pre-trained offline for high-level competence and fine-tuned online (in the browser) to adapt to specific player strategies in real-time, creating a "Nemesis" that learns the player's habits.

### 2. System Architecture

The system is divided into two distinct pipelines: **Offline Training (Python)** and **Online Inference/Adaptation (JavaScript/Web Workers)**.

#### A. High-Level Data Flow

1. **Gym Environment (Python):** Simulates the game logic at high speed for initial training (millions of steps).
2. **Base Model Export:** The trained Policy Network is converted to a `tfjs_graph_model`.
3. **Browser Game Loop (Main Thread):** Handles rendering, input capture, and rigid body physics (60 FPS).
4. **AI Manager (Web Worker):**
* Receives Game State () from Main Thread.
* Outputs Action () back to Main Thread.
* Accumulates an "Experience Replay" buffer locally.
* Performs background SGD (Stochastic Gradient Descent) to update weights without blocking the UI.



### 3. Reinforcement Learning Formulation (MDP)

We define the game as a Markov Decision Process (MDP) defined by the tuple .

#### 3.1 State Space ()

The input to the neural network. To ensure fast inference in the browser, we use a compact vector rather than raw pixels.

Let  where .

* : Relative distance between players (normalized to ).
* : Health percentages.
* : Velocities (essential for detecting jump arcs).
* : One-hot encoded state of the opponent (e.g., `is_stunned`, `is_attacking`, `is_blocking`).
* **Frame Stacking:** Concatenate the last  frames to allow the AI to perceive momentum and reaction speed.

#### 3.2 Action Space ()

We use a **Discrete Action Space** corresponding to valid controller inputs.

* *Note:* Complex combos (e.g., Down-Forward-Punch) are abstracted into single macro-actions for the AI to ensure faster convergence.

#### 3.3 Reward Function ()

The shaping of the reward function is critical for "fighting" behavior.

Where:

* : Reward for dealing damage.
* : Penalty for taking damage (higher than  to encourage defense/blocking).
* : Bonus for winning the round ( is 1 if win, else 0).
* *Spacing Penalty:* Small negative reward for being trapped in corners.

### 4. Model Architecture & Algorithms

#### 4.1 Algorithm Selection: PPO (Proximal Policy Optimization)

We use PPO for both offline and online phases. It is sample-efficient and stable, preventing "catastrophic forgetting" during the online fine-tuning phase where batch sizes are small.

**Objective Function:**


* : Advantage estimate (how much better was this action than average?).
* : Probability ratio .
* : Clipping parameter (usually 0.2) to prevent wild weight updates.

#### 4.2 Network Topology

A shared backbone with two heads (Actor-Critic).

* **Input Layer:** shape `(k_frames * state_features)`
* **Hidden Layers (Backbone):**
* Dense (128 units, ReLU)
* Dense (64 units, ReLU)  *These layers are frozen during online play.*


* **Heads:**
* **Actor (Policy):** Dense (Action_Size, Softmax)  Outputs probabilities.
* **Critic (Value):** Dense (1, Linear)  Estimates win probability.



### 5. Offline Pre-Training Strategy

Before shipping, train base models to serve as "Personality Archetypes."

1. **The Spammer:** Reward heavily for attack frequency, discount defense.
2. **The Turtle:** High penalty for taking damage, high reward for successful blocks.
3. **The Pro:** Balanced rewards, trained via **Self-Play** (Agent vs. Agent).

**Method:**
Use `Stable-Baselines3` in Python.

```python
model = PPO("MlpPolicy", env, verbose=1)
model.learn(total_timesteps=1_000_000)
model.save("neural_nemesis_pro")
# Convert to TFJS
tensorflowjs_converter --input_format=tf_saved_model ...

```

### 6. Online Real-Time Fine-Tuning

This is the core innovation. We use **Web Workers** to isolate the training process so the rendering thread never stutters.

#### 6.1 The "Transfer Learning" Trick

Full retraining is too slow for a browser. We use **Head Tuning**.

* Load the `model.json`.
* Set `backbone_layers.trainable = false`.
* Only update weights for the final Actor/Critic dense layers.
* **Why?** The backbone has already learned physics and spacing. The head only needs to learn *decision making* (e.g., "This player jumps a lot, so I should anti-air").

#### 6.2 The Loop (Pseudocode)

**Main Thread (Game Loop):**

```javascript
// Every frame
state = captureGameState();
// Send state to worker, do not await (async)
AIWorker.postMessage({ type: 'predict', payload: state });

// When worker replies with action
function onWorkerMessage(e) {
    if (e.data.type === 'action') executeAction(e.data.payload);
}

// End of Round / Significant Event
reward = calculateReward();
AIWorker.postMessage({ 
    type: 'store_experience', 
    payload: { prevState, action, reward, state } 
});

```

**AI Worker (Background Thread):**

```javascript
import * as tf from '@tensorflow/tfjs';

// 1. Inference
if (msg.type === 'predict') {
    const action = model.predict(msg.payload);
    postMessage({ type: 'action', payload: action });
}

// 2. Training (The "Sleep" Learning)
// Triggered periodically or between rounds
if (msg.type === 'train_batch') {
    const batch = replayBuffer.sample(32);
    
    // Run training step on WebGL backend
    optimizer.minimize(() => {
        // Custom loss function focusing on recent failures
        const pred = model.predict(batch.states);
        return loss(pred, batch.actions, batch.rewards);
    });
    
    // Weights are now updated in the Worker's RAM
}

```

### 6.3 Anti-Cheating & Humanization

To ensure the AI feels fair:

1. **Reaction Delay:** Implement a standard queue buffer. The AI decides an action at frame , but the game engine executes it at  (approx 200ms).
2. **Exploration Noise:** Inject entropy based on difficulty settings.
* *Easy Mode:* High temperature on Softmax (pick random moves often).
* *Hard Mode:* Argmax (pick best move).



### 7. Technical Stack Requirements

* **Game Engine:** Phaser.js or Three.js (for rendering/physics).
* **ML Engine:** TensorFlow.js (WebGL backend).
* **Concurrency:** Native Web Workers.
* **Offline Training:** Python 3.9+, Gym, Stable-Baselines3.

### 8. Deployment Strategy

1. **Asset Loading:** Pre-load the "Pro" model (~2MB) on game start.
2. **Session Learning:** Reset the fine-tuned weights when the browser tab closes, or save weights to `IndexedDB` to allow the Nemesis to "remember" the player across sessions.
3. **Visualization:** Add a debug overlay showing the AI's "Confidence" (Value Head output) and "Intent" (Policy Head distribution) to show the user *why* the AI made a move.