import * as tf from '@tensorflow/tfjs';

const N_STACK = 4;
const FEATURES = 14;

class ReplayBuffer {
    constructor(maxSize = 2000) {
        this.buffer = [];
        this.maxSize = maxSize;
    }

    push(transition) {
        if (this.buffer.length >= this.maxSize) {
            this.buffer.shift();
        }
        this.buffer.push(transition);
    }

    sample(batchSize) {
        const batch = [];
        for (let i = 0; i < batchSize; i++) {
            const index = Math.floor(Math.random() * this.buffer.length);
            batch.push(this.buffer[index]);
        }
        return batch;
    }

    get length() { return this.buffer.length; }
}

let model = null;
let normStats = null;
let frameBuffer = [];
let optimizer = null;
let replayBuffer = new ReplayBuffer();

async function init() {
    console.log("AI Worker: Initializing TFJS...");
    try {
        await tf.setBackend('webgl');
    } catch (e) {
        await tf.setBackend('cpu');
    }
    console.log("AI Worker: TFJS Backend:", tf.getBackend());
    optimizer = tf.train.adam(3e-4);
}

async function loadModelAndStats() {
    try {
        console.log("AI Worker: Loading model...");
        model = await tf.loadGraphModel('/assets/model/model.json');
        console.log("AI Worker: Model loaded successfully");

        const statsResponse = await fetch('/assets/model/norm_stats.json');
        normStats = await statsResponse.json();
        console.log("AI Worker: Normalization stats loaded");
    } catch (e) {
        console.error("AI Worker: Failed to load assets", e);
    }
}

function normalize(obs) {
    if (!normStats) return obs;
    return obs.map((val, i) => {
        return (val - normStats.mean[i]) / Math.sqrt(normStats.variance[i] + normStats.epsilon);
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

async function trainOnBuffer() {
    if (replayBuffer.length < 32 || !model) return;
    
    console.log("AI Worker: Online Training Burst...");
    // Demonstration of the training pipeline
    // In GraphModel, we can't easily use minimize() without rebuilding the graph
    // For Phase 4, we log the process.
    console.log(`AI Worker: Sampling ${replayBuffer.length} experiences`);
}

self.onmessage = async (e) => {
    const { type, payload } = e.data;
    
    if (type === 'init') {
        await init();
        await loadModelAndStats();
        self.postMessage({ type: 'ready' });
        return;
    }

    if (type === 'store_experience') {
        replayBuffer.push(payload);
        if (replayBuffer.length % 100 === 0) {
            self.postMessage({ type: 'stats', bufferSize: replayBuffer.length });
        }
        if (replayBuffer.length % 500 === 0) {
            await trainOnBuffer();
        }
        return;
    }
    
    if (type === 'predict') {
        if (!model || !normStats) return;

        updateFrameBuffer(payload);
        const normalizedStack = normalize(frameBuffer);

        tf.tidy(() => {
            const inputTensor = tf.tensor2d([normalizedStack], [1, FEATURES * N_STACK]);
            const results = model.predict(inputTensor);
            
            // model.predict returns [logits, value] based on our export
            const logits = results[0];
            const value = results[1];
            
            const actionTensor = logits.argMax(-1);
            const action = actionTensor.dataSync()[0];
            
            self.postMessage({ 
                type: 'action', 
                payload: action,
                confidence: value.dataSync()[0]
            });
        });
    }
};
