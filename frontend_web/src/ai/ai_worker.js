import * as tf from '@tensorflow/tfjs';

const N_STACK = 4;
const FEATURES = 16;

class ReplayBuffer {
    constructor(maxSize = 5000) {
        this.buffer = [];
        this.maxSize = maxSize;
    }

    push(transition) {
        if (this.buffer.length >= this.maxSize) {
            this.buffer.shift();
        }
        this.buffer.push(transition);
    }

    clear() {
        this.buffer = [];
    }

    sample(batchSize) {
        const validBuffer = this.buffer.filter(b => b.stackedState);
        if (validBuffer.length === 0) return [];
        
        const batch = [];
        for (let i = 0; i < batchSize; i++) {
            const index = Math.floor(Math.random() * validBuffer.length);
            batch.push(validBuffer[index]);
        }
        return batch;
    }

    get length() { return this.buffer.length; }
}

let model = null;
let normStats = null;
let frameBuffer = [];
let currentStack = null;
let replayBuffer = new ReplayBuffer();
let isInitialized = false;
let outputNames = [];

// Entropy/Difficulty settings
let difficulty = 'hard'; // easy, medium, hard
const DIFFICULTY_CONFIG = {
    'hard': { temperature: 0.1, useArgmax: true },
    'medium': { temperature: 1.0, useArgmax: false },
    'easy': { temperature: 2.5, useArgmax: false }
};

// Nemesis Online Learning Variables
let actorWeights, actorBias, criticWeights, criticBias;
let optimizer = null;
const LEARNING_RATE = 1e-4;
const DB_NAME = 'NemesisDB';
const STORE_NAME = 'weights';

async function saveWeights() {
    return new Promise(async (resolve, reject) => {
        try {
            const weightsData = {
                actorWeights: await actorWeights.array(),
                actorBias: await actorBias.array(),
                criticWeights: await criticWeights.array(),
                criticBias: await criticBias.array(),
                timestamp: Date.now()
            };
            
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE_NAME);
            request.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const putRequest = tx.objectStore(STORE_NAME).put(weightsData, 'latest');
                putRequest.onsuccess = () => {
                    console.log("AI Worker: Weights saved to IndexedDB");
                    resolve();
                };
                putRequest.onerror = () => reject(new Error("Failed to put weights"));
            };
            request.onerror = () => reject(new Error("Failed to open IndexedDB"));
        } catch (e) {
            console.error("AI Worker: Failed to save weights", e);
            reject(e);
        }
    });
}

async function loadWeights() {
    return new Promise((resolve) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE_NAME);
        request.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction(STORE_NAME, 'readonly');
            const getRequest = tx.objectStore(STORE_NAME).get('latest');
            getRequest.onsuccess = () => resolve(getRequest.result);
            getRequest.onerror = () => resolve(null);
        };
        request.onerror = () => resolve(null);
    });
}

// In GraphModel, weights are stored in model.weights object
// The structure is { [name: string]: tf.Tensor[] }
const findWeight = (name) => {
    if (!model) return null;
    const weightGroup = model.weights[name];
    if (!weightGroup || weightGroup.length === 0) {
        console.error(`AI Worker: Weight ${name} not found in model.weights`);
        return null;
    }
    return weightGroup[0];
};

async function init() {
    try {
        console.log("AI Worker: Starting Initialization...");
        await tf.setBackend('cpu');
        await tf.ready();
        
        model = await tf.loadGraphModel('/assets/model/model.json');
        
        // Try to load from IndexedDB first
        const saved = await loadWeights();
        if (saved) {
            console.log("AI Worker: Found saved weights from", new Date(saved.timestamp).toLocaleString());
            actorWeights = tf.variable(tf.tensor2d(saved.actorWeights));
            actorBias = tf.variable(tf.tensor1d(saved.actorBias));
            criticWeights = tf.variable(tf.tensor2d(saved.criticWeights));
            criticBias = tf.variable(tf.tensor1d(saved.criticBias));
        } else {
            // Map weight indices from model.json (converted SB3 PPO)
            // unknown_12: Policy/Actor Weights [64, 9]
            // unknown_16: Policy/Actor Bias [9]
            // unknown_11: Value/Critic Weights [64, 1]
            // unknown_15: Value/Critic Bias [1]
            const w12 = findWeight('unknown_12');
            const w16 = findWeight('unknown_16');
            const w11 = findWeight('unknown_11');
            const w15 = findWeight('unknown_15');

            if (!w12 || !w16 || !w11 || !w15) {
                throw new Error("Required head weights not found in model. Check model.json names.");
            }

            actorWeights = tf.variable(w12);
            actorBias = tf.variable(w16);
            criticWeights = tf.variable(w11);
            criticBias = tf.variable(w15);
        }

        optimizer = tf.train.adam(LEARNING_RATE);


        console.log("AI Worker: Nemesis Heads initialized as trainable variables.");

        console.log("AI Worker: Fetching normalization stats...");
        const statsResponse = await fetch('/assets/model/norm_stats.json');
        normStats = await statsResponse.json();
        console.log("AI Worker: Normalization stats loaded");
        
        isInitialized = true;
        self.postMessage({ type: 'ready' });
    } catch (e) {
        console.error("AI Worker: Initialization failed", e);
        self.postMessage({ type: 'error', payload: e.message });
    }
}

function normalize(obs) {
    if (!normStats || !obs) return obs;
    return obs.map((val, i) => {
        const statsIdx = i % normStats.mean.length;
        return (val - normStats.mean[statsIdx]) / Math.sqrt(normStats.variance[statsIdx] + (normStats.epsilon || 1e-8));
    });
}

function updateFrameBuffer(newState) {
    if (frameBuffer.length === 0) {
        for (let i = 0; i < N_STACK; i++) {
            frameBuffer.push(...newState);
        }
    } else {
        frameBuffer.splice(0, FEATURES);
        frameBuffer.push(...newState);
    }
    return frameBuffer;
}

self.onmessage = async (e) => {
    const { type, payload } = e.data;
    
    if (type === 'init') {
        if (!isInitialized) {
            await init();
        } else {
            self.postMessage({ type: 'ready' });
        }
        return;
    }

    if (type === 'set_difficulty') {
        difficulty = payload;
        console.log(`AI Worker: Difficulty set to ${difficulty}`);
        return;
    }

    if (type === 'reset_weights') {
        console.log("AI Worker: Resetting weights to base model...");
        try {
            const w12 = findWeight('unknown_12');
            const w16 = findWeight('unknown_16');
            const w11 = findWeight('unknown_11');
            const w15 = findWeight('unknown_15');
            
            actorWeights.assign(w12);
            actorBias.assign(w16);
            criticWeights.assign(w11);
            criticBias.assign(w15);
            
            const request = indexedDB.deleteDatabase(DB_NAME);
            request.onsuccess = () => console.log("AI Worker: IndexedDB cleared");
            
            self.postMessage({ type: 'weights_reset' });
        } catch (e) {
            console.error("AI Worker: Reset failed", e);
        }
        return;
    }

    if (type === 'predict') {
        if (!isInitialized || !model) return;

        const stackedState = updateFrameBuffer(payload);
        const normalizedStack = normalize(stackedState);
        
        // Cache the current stack for the NEXT store_experience call
        currentStack = [...stackedState];

        try {
            tf.tidy(() => {
                const inputTensor = tf.tensor2d([normalizedStack], [1, FEATURES * N_STACK]);
                
                const latentActorNode = 'PartitionedCall/model/tf.nn.relu_2/Relu';
                const latentCriticNode = 'PartitionedCall/model/tf.nn.relu_3/Relu';
                
                const latents = model.execute(inputTensor, [latentActorNode, latentCriticNode]);
                const actorLatent = latents[0];
                const criticLatent = latents[1];

                const logits = actorLatent.matMul(actorWeights).add(actorBias);
                const value = criticLatent.matMul(criticWeights).add(criticBias);
                
                const conf = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG['hard'];
                
                let action;
                const probsTensor = tf.softmax(logits.div(conf.temperature));
                const probs = probsTensor.dataSync();

                if (conf.useArgmax) {
                    action = logits.argMax(-1).dataSync()[0];
                } else {
                    // Weighted random selection
                    const r = Math.random();
                    let acc = 0;
                    action = 0;
                    for (let i = 0; i < probs.length; i++) {
                        acc += probs[i];
                        if (r <= acc) {
                            action = i;
                            break;
                        }
                    }
                }

                const confidence = value.dataSync()[0];
                
                self.postMessage({ 
                    type: 'action', 
                    payload: action,
                    confidence: confidence,
                    probs: Array.from(probs)
                });
            });
        } catch (err) {
            console.error("AI Worker: Prediction error", err);
        }
    }

    if (type === 'store_experience') {
        // payload: { state, action, reward, nextState, done }
        // We use the cached currentStack for the 'state' to include history
        if (currentStack) {
            replayBuffer.push({
                ...payload,
                stackedState: currentStack
            });
        }
        
        if (replayBuffer.length % 100 === 0) {
            self.postMessage({ type: 'stats', bufferSize: replayBuffer.length });
        }
        return;
    }

    if (type === 'train') {
        const validCount = replayBuffer.buffer.filter(b => b.stackedState).length;
        if (!isInitialized || validCount < 32) {
            console.log(`AI Worker: Not enough valid experiences to train (${validCount}/32)`);
            return;
        }
        
        console.log(`AI Worker: Starting training on ${validCount} valid experiences...`);
        
        const batchSize = Math.min(64, validCount);
        const iterations = 5;
        
        for (let i = 0; i < iterations; i++) {
            const batch = replayBuffer.sample(batchSize);
            if (batch.length === 0) continue;
            
            // 1. Compute Advantage and Latents outside minimize to control gradients
            // Note: GraphModel has fixed batch size of 1, so we must execute sample-by-sample
            const { states, rewards, actions, adv, actorLatent, criticLatent } = tf.tidy(() => {
                const s = tf.tensor2d(batch.map(b => normalize(b.stackedState)), [batchSize, FEATURES * N_STACK]);
                const r = tf.tensor1d(batch.map(b => b.reward), 'float32');
                const a = tf.tensor1d(batch.map(b => b.action), 'int32');

                const latentActorNode = 'PartitionedCall/model/tf.nn.relu_2/Relu';
                const latentCriticNode = 'PartitionedCall/model/tf.nn.relu_3/Relu';
                
                // Process each sample in the batch individually for the frozen backbone
                const alList = [];
                const clList = [];
                for (let j = 0; j < batchSize; j++) {
                    const singleState = s.slice([j, 0], [1, -1]);
                    const out = model.execute(singleState, [latentActorNode, latentCriticNode]);
                    alList.push(out[0]);
                    clList.push(out[1]);
                }
                
                const al = tf.concat(alList, 0);
                const cl = tf.concat(clList, 0);

                // Advantage = Reward - CurrentValue
                const values = cl.matMul(criticWeights).add(criticBias).squeeze();
                const advantage = r.sub(values);

                return {
                    states: tf.keep(s),
                    rewards: tf.keep(r),
                    actions: tf.keep(a),
                    adv: tf.keep(advantage),
                    actorLatent: tf.keep(al),
                    criticLatent: tf.keep(cl)
                };
            });

            optimizer.minimize(() => {
                const logits = actorLatent.matMul(actorWeights).add(actorBias);
                const values = criticLatent.matMul(criticWeights).add(criticBias).squeeze();

                // Critic Loss
                const criticLoss = tf.losses.meanSquaredError(rewards, values);

                // Actor Loss (using pre-computed detached Advantage)
                const actionProbs = tf.softmax(logits);
                const actionMask = tf.oneHot(actions, 9);
                const pickedActionProbs = tf.sum(actionProbs.mul(actionMask), 1);
                const logProbs = tf.log(pickedActionProbs.add(1e-8));
                const actorLoss = tf.mean(logProbs.mul(adv).neg());

                // Entropy Bonus
                const entropy = tf.mean(actionProbs.mul(tf.log(actionProbs.add(1e-8))).sum(1).neg());
                
                return actorLoss.add(criticLoss.mul(0.5)).add(entropy.mul(-0.01));
            });

            states.dispose();
            rewards.dispose();
            actions.dispose();
            adv.dispose();
            actorLatent.dispose();
            criticLatent.dispose();
        }
        
        console.log("AI Worker: Training complete.");
        await saveWeights();
    }
};
