import * as tf from '@tensorflow/tfjs';

const N_STACK = 4;
const FEATURES = 14;

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
let replayBuffer = new ReplayBuffer();
let isInitialized = false;
let outputNames = [];

async function init() {
    try {
        console.log("AI Worker: Starting Initialization...");
        await tf.setBackend('cpu');
        await tf.ready();
        console.log("AI Worker: TFJS Backend:", tf.getBackend());
        
        console.log("AI Worker: Loading model from /assets/model/model.json");
        model = await tf.loadGraphModel('/assets/model/model.json');
        
        // Detect output names
        outputNames = model.outputs.map(o => o.name);
        console.log("AI Worker: Model loaded. Output names:", outputNames);

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
    if (!normStats) return obs;
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

    if (type === 'store_experience') {
        replayBuffer.push(payload);
        if (replayBuffer.length % 100 === 0) {
            self.postMessage({ type: 'stats', bufferSize: replayBuffer.length });
        }
        return;
    }
    
    if (type === 'predict') {
        if (!isInitialized || !model) return;

        updateFrameBuffer(payload);
        const normalizedStack = normalize(frameBuffer);

        try {
            tf.tidy(() => {
                const inputTensor = tf.tensor2d([normalizedStack], [1, FEATURES * N_STACK]);
                
                // Execute and handle multiple outputs dynamically
                const results = model.execute(inputTensor, outputNames);
                
                let logits, value;
                // Heuristic to find logits vs value
                if (results[0].shape[1] === 9) {
                    logits = results[0];
                    value = results[1];
                } else {
                    logits = results[1];
                    value = results[0];
                }
                
                const action = logits.argMax(-1).dataSync()[0];
                const confidence = value.dataSync()[0];
                
                self.postMessage({ 
                    type: 'action', 
                    payload: action,
                    confidence: confidence
                });
            });
        } catch (err) {
            console.error("AI Worker: Prediction error", err);
        }
    }
};
