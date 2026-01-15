### Phase 1: The Offline "Brain" (Python & Gym)

**Goal:** Create a headless simulation of the fighting game and train a competent "Pro" model using Stable-Baselines3.

* **1.1. Define the Gym Environment**
* Create a class `FightingGameEnv(gym.Env)` in Python.
* **Implement State Space:** Define `observation_space` matching the vector in **DESIGN.md Section 3.1** (distance, health, flags).
* **Implement Action Space:** Define `action_space` as `Discrete(9)` matching **DESIGN.md Section 3.2**.
* **Verification:** Run `env = FightingGameEnv(); env.reset(); print(env.observation_space.sample())` and verify the output vector shape and range.


* **1.2. Implement Game Logic & Physics (Python)**
* Replicate the core hitboxes and frame data in Python. *Note: This doesn't need graphics, just rectangle math.*
* Implement the **Reward Function** defined in **DESIGN.md Section 3.3** ().
* **Verification:** Write a unit test where Player 1 hits Player 2, and verify that `reward > 0` and `h_opp` decreases.


* **1.3. Train the Base Model**
* Setup PPO using `Stable-Baselines3` as described in **DESIGN.md Section 5**.
* Train for 1M timesteps against a randomized opponent (random actions).
* **Verification:** Run `model.evaluate()` and ensure the agent wins >80% of matches against a random bot. Save the model as `neural_nemesis_pro.zip`.


* **1.4. Model Export**
* Export the trained model to ONNX or SavedModel format.
* Use `tensorflowjs_converter` to generate the `model.json` and shard files.
* **Verification:** Check that the output directory contains a `model.json` and binary weight files.



---

### Phase 2: The Browser Engine (JavaScript & Phaser)

**Goal:** Build the visual game engine that will eventually host the AI.

* **2.1. Game Loop & Physics Setup**
* Initialize Phaser.js or Three.js.
* Implement the inputs and rigid body physics.
* **Reference:** **DESIGN.md Section 6.2 (Main Thread)**.
* **Verification:** You can move a character left/right and jump using keyboard arrow keys.


* **2.2. State Capture System**
* Write a function `captureGameState()` that returns a JavaScript array exactly matching the Python `observation_space` structure.
* **Reference:** **DESIGN.md Section 3.1**.
* **Verification:** Log `captureGameState()` to the console while moving. Verify that  changes when you walk and  changes when you take damage.


* **2.3. The "Dummy" AI Hook**
* Create a placeholder function `getBotAction()` that returns a random integer 0-8.
* Hook this into the opponent's input handler.
* **Verification:** The opponent moves randomly but validly (no crashing) during the game loop.



---

### Phase 3: The Bridge (Inference Integration)

**Goal:** Replace the dummy AI with the pre-trained TFJS model running in a Web Worker.

* **3.1. Web Worker Setup**
* Create `ai_worker.js`.
* Initialize TensorFlow.js (WebGL backend) inside the worker.
* **Reference:** **DESIGN.md Section 6.2 (Worker)**.
* **Verification:** The worker logs "TFJS Backend initialized: webgl" to the console.


* **3.2. Model Loading**
* Load the `model.json` from Phase 1.4 inside the worker.
* **Verification:** The worker logs "Model loaded successfully" without 404 errors.


* **3.3. Async Inference Loop**
* Implement the `postMessage` system: Main Thread sends `state`  Worker calls `model.predict()`  Worker sends `action`.
* **Reference:** **DESIGN.md Section 6.2**.
* **Verification:** Play the game. The opponent should now move "intelligently" (blocking, attacking) based on the offline training, rather than randomly.



---

### Phase 4: Online Learning Pipeline (The "Nemesis" Logic)

**Goal:** Enable the AI to learn from the current player in real-time.

* **4.1. Experience Replay Buffer**
* Implement a `ReplayBuffer` class in the worker (circular buffer array).
* Store `{state, action, reward, next_state}` tuples.
* **Verification:** Log the buffer size. It should grow as you play the game.


* **4.2. Head-Only Freezing**
* Iterate through `model.layers`. Set `trainable = false` for all layers except the final Policy (Actor) and Value (Critic) dense layers.
* **Reference:** **DESIGN.md Section 6.1**.
* **Verification:** Inspect `model.trainableWeights.length`. It should be significantly smaller than `model.weights.length`.


* **4.3. The Training Step**
* Implement the `optimizer.minimize()` logic inside the worker.
* Trigger this training step every time a round ends (or every 500 frames).
* **Reference:** **DESIGN.md Section 6.2 (Worker)**.
* **Verification:** Monitor the loss value in the console. It should fluctuate (and ideally decrease) as training bursts occur between rounds.


* **4.4. Anti-Cheating Latency**
* Implement an input queue buffer in the Main Thread. Actions received from the worker are pushed to the queue and only popped after `N` frames.
* **Reference:** **DESIGN.md Section 6.3**.
* **Verification:** Visually confirm the AI reacts to your jump with a slight, human-like delay (approx 200ms) rather than instantly frame-1.



---

### Phase 5: Polish & UX

**Goal:** Make the "learning" visible and exciting to the player.

* **5.1. Debug Overlay**
* Create a UI panel showing "AI Confidence" (Value Head output) and a bar chart of "Next Move Probability" (Policy Head).
* **Reference:** **DESIGN.md Section 8**.
* **Verification:** The bars shift dynamically as you move closer/further from the AI.


* **5.2. Save/Load Weights**
* Implement `model.save('indexeddb://nemesis-v1')` on window unload.
* Load this model on startup if it exists.
* **Reference:** **DESIGN.md Section 8**.
* **Verification:** Refresh the page. The AI should retain its behavior (e.g., if you taught it to block spam, it should start blocking immediately).


* **5.3. Difficulty Presets**
* Implement "Entropy Injection." Add a random noise factor to the action selection based on a difficulty slider (Easy/Medium/Hard).
* **Reference:** **DESIGN.md Section 6.3**.
* **Verification:** On "Easy," the AI should visibly miss attacks or drop combos it usually hits.