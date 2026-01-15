import Phaser from 'phaser';

export default class MainScene extends Phaser.Scene {
    constructor() {
        super('MainScene');
    }

    preload() {
        // Create simple graphics for players
        this.graphics = this.add.graphics();
    }

    create() {
        // ... (existing code)
        this.createUI();
        this.setupAI();
    }

    createUI() {
        // Health bars
        this.p1HealthBar = this.add.graphics();
        this.p2HealthBar = this.add.graphics();
        this.updateHealthBars();
    }

    updateHealthBars() {
        this.p1HealthBar.clear();
        this.p1HealthBar.fillStyle(0x00ff00, 1);
        this.p1HealthBar.fillRect(50, 50, this.gameState.p1_health * 2, 20);
        this.p1HealthBar.lineStyle(2, 0xffffff);
        this.p1HealthBar.strokeRect(50, 50, 200, 20);

        this.p2HealthBar.clear();
        this.p2HealthBar.fillStyle(0x00ff00, 1);
        this.p2HealthBar.fillRect(550, 50, this.gameState.p2_health * 2, 20);
        this.p2HealthBar.lineStyle(2, 0xffffff);
        this.p2HealthBar.strokeRect(550, 50, 200, 20);
    }

    setupAI() {
        this.aiWorker = new Worker(new URL('../ai/ai_worker.js', import.meta.url), { type: 'module' });
        this.aiWorker.postMessage({ type: 'init' });
        this.aiWorker.onmessage = (e) => {
            if (e.data.type === 'action') {
                this.executeAIAction(e.data.payload);
            }
        };
    }

    executeAIAction(action) {
        // action 0-8
        // For now just basic movement/jumping
        if (action === 1) this.opponent.body.setVelocityX(-200);
        if (action === 2) this.opponent.body.setVelocityX(200);
        if (action === 3 && this.opponent.body.touching.down) this.opponent.body.setVelocityY(-500);
    }

    update() {
        // ...
        // Send state to AI periodically
        if (this.time.now % 10 === 0) { // Every 10ms or so (not every frame for now)
            const state = this.captureGameState();
            this.aiWorker.postMessage({ type: 'predict', payload: state });
        }
    }

    getBotAction() {
        // Randomly jump or move
        if (Math.random() < 0.01 && this.opponent.body.touching.down) {
            this.opponent.body.setVelocityY(-500);
        }
        
        if (Math.random() < 0.05) {
            const dir = Math.random() < 0.5 ? -1 : 1;
            this.opponent.body.setVelocityX(dir * 200);
        }
    }

    captureGameState() {
        // dx, dy, h_self, h_opp, vx_self, vy_self, vx_opp, vy_opp, 
        // self_stunned, self_attacking, self_blocking, 
        // opp_stunned, opp_attacking, opp_blocking
        
        // Normalized values matching Python env
        const dx = (this.opponent.x - this.player.x) / 800;
        const dy = (this.opponent.y - this.player.y) / 600;
        
        return [
            dx, dy,
            this.gameState.p1_health / 100,
            this.gameState.p2_health / 100,
            this.player.body.velocity.x / 300,
            this.player.body.velocity.y / 500,
            this.opponent.body.velocity.x / 300,
            this.opponent.body.velocity.y / 500,
            this.gameState.p1_stun > 0 ? 1 : 0,
            this.gameState.p1_attacking > 0 ? 1 : 0,
            this.gameState.p1_blocking ? 1 : 0,
            this.gameState.p2_stun > 0 ? 1 : 0,
            this.gameState.p2_attacking > 0 ? 1 : 0,
            this.gameState.p2_blocking ? 1 : 0
        ];
    }
}
