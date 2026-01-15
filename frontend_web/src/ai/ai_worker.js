import * as tf from '@tensorflow/tfjs';

let model = null;

async function init() {
    console.log("AI Worker: Initializing TFJS...");
    await tf.setBackend('cpu'); // Start with CPU, can try webgl later
    console.log("AI Worker: TFJS Backend:", tf.getBackend());
}

async function loadModel() {
    try {
        console.log("AI Worker: Loading model...");
        // This will be populated after Phase 1.4
        // model = await tf.loadGraphModel('/assets/model/model.json');
        console.log("AI Worker: Model loaded (placeholder)");
    } catch (e) {
        console.error("AI Worker: Failed to load model", e);
    }
}

self.onmessage = async (e) => {
    const { type, payload } = e.data;
    
    if (type === 'init') {
        await init();
        await loadModel();
        self.postMessage({ type: 'ready' });
    }
    
    if (type === 'predict') {
        // payload is the state vector
        // For now, return random action
        const action = Math.floor(Math.random() * 9);
        self.postMessage({ type: 'action', payload: action });
    }
};
