import Phaser from 'phaser';
import StartScene from './game/StartScene.js';
import MainScene from './game/MainScene.js';

const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-container',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 800 },
            debug: false
        }
    },
    scene: [StartScene, MainScene]
};

const game = new Phaser.Game(config);

document.getElementById('difficulty').addEventListener('change', (e) => {
    const scene = game.scene.getScene('MainScene');
    if (scene && scene.aiWorker) {
        scene.aiWorker.postMessage({ type: 'set_difficulty', payload: e.target.value });
    }
});
