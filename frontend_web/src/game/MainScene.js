import Phaser from 'phaser';

export default class MainScene extends Phaser.Scene {
    constructor() {
        super('MainScene');
        this.gameState = {
            p1_health: 100,
            p2_health: 100,
            p1_stun: 0,
            p2_stun: 0,
            p1_attacking: 0,
            p2_attacking: 0,
            p1_blocking: false,
            p2_blocking: false,
        };
        this.MAX_HEALTH = 100;
        this.ATTACK_DURATION = 20;
        this.STUN_DURATION = 30;
        this.ATTACK_REACH = 90;
        this.WIDTH = 800;
        this.HEIGHT = 600;
        this.GROUND_Y = 500;
    }

    preload() {
        // No assets yet, using graphics
    }

    create() {
        // Background
        this.add.rectangle(400, 300, 800, 600, 0x111111);
        this.add.rectangle(400, 550, 800, 100, 0x333333); // Ground

        // P1 (Player) - Blue
        this.player = this.add.rectangle(200, 450, 50, 100, 0x0088ff);
        this.physics.add.existing(this.player);
        this.player.body.setCollideWorldBounds(true);

        // P2 (AI) - Red
        this.opponent = this.add.rectangle(600, 450, 50, 100, 0xff4444);
        this.physics.add.existing(this.opponent);
        this.opponent.body.setCollideWorldBounds(true);

        // UI
        this.createUI();
        
        // Inputs
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keys = this.input.keyboard.addKeys('A,D,W,S,J,K,L');

        // AI Setup
        this.setupAI();
    }

    createUI() {
        this.p1HealthBar = this.add.graphics();
        this.p2HealthBar = this.add.graphics();
        this.updateHealthBars();

        this.statusText = this.add.text(400, 100, '', { fontSize: '32px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        
        // AI Debug UI
        this.debugContainer = this.add.container(20, 100);
        const bg = this.add.rectangle(0, 0, 180, 100, 0x000000, 0.7).setOrigin(0);
        this.confidenceText = this.add.text(10, 10, 'AI Confidence: 0%', { fontSize: '14px', fill: '#0ff' });
        this.intentText = this.add.text(10, 35, 'Intent: Idle', { fontSize: '14px', fill: '#f0f' });
        this.bufferText = this.add.text(10, 60, 'Memories: 0', { fontSize: '14px', fill: '#ff0' });
        
        this.debugContainer.add([bg, this.confidenceText, this.intentText, this.bufferText]);
    }

    setupAI() {
        this.aiWorker = new Worker(new URL('../ai/ai_worker.js', import.meta.url), { type: 'module' });
        this.aiWorker.postMessage({ type: 'init' });
        this.aiWorker.onmessage = (e) => {
            if (e.data.type === 'action') {
                this.executeAIAction(e.data.payload);
                
                // Update Debug UI
                const conf = (e.data.confidence * 100).toFixed(1);
                this.confidenceText.setText(`AI Confidence: ${conf}%`);
                
                const actions = ['Idle', 'Left', 'Right', 'Jump', 'Crouch', 'Block', 'Light', 'Heavy', 'Special'];
                this.intentText.setText(`Intent: ${actions[e.data.payload]}`);
            }
            if (e.data.type === 'stats') {
                this.bufferText.setText(`Memories: ${e.data.bufferSize}`);
            }
            if (e.data.type === 'ready') {
                document.getElementById('ai-status').innerText = 'Online';
            }
        };
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

    handlePlayerInput() {
        if (this.gameState.p1_stun > 0 || this.gameState.p1_attacking > 0) return;

        this.gameState.p1_blocking = false;
        let vx = 0;

        if (this.cursors.left.isDown || this.keys.A.isDown) vx = -300;
        else if (this.cursors.right.isDown || this.keys.D.isDown) vx = 300;

        if ((this.cursors.up.isDown || this.keys.W.isDown) && this.player.body.blocked.down) {
            this.player.body.setVelocityY(-600);
        }

        if (this.keys.S.isDown) {
            vx = 0;
            this.gameState.p1_blocking = true;
        }

        if (Phaser.Input.Keyboard.JustDown(this.keys.J)) {
            this.gameState.p1_attacking = this.ATTACK_DURATION;
            vx = 0;
        }

        this.player.body.setVelocityX(vx);
    }

    executeAIAction(action) {
        // AI is P2
        if (this.gameState.p2_stun > 0 || this.gameState.p2_attacking > 0) return;

        this.lastAIAction = action;

        this.gameState.p2_blocking = false;
        let vx = 0;

        if (action === 1) vx = -300; // Left
        else if (action === 2) vx = 300; // Right
        
        if (action === 3 && this.opponent.body.blocked.down) {
            this.opponent.body.setVelocityY(-600); // Jump
        }

        if (action === 5) { // Block
            vx = 0;
            this.gameState.p2_blocking = true;
        }

        if (action >= 6) { // Attacks
            this.gameState.p2_attacking = this.ATTACK_DURATION;
            vx = 0;
        }

        this.opponent.body.setVelocityX(vx);
    }

    update() {
        if (this.gameState.p1_health <= 0 || this.gameState.p2_health <= 0) {
            this.statusText.setText(this.gameState.p1_health <= 0 ? 'AI WINS' : 'PLAYER WINS');
            return;
        }

        const prevState = this.captureGameState();
        const prevH1 = this.gameState.p1_health;
        const prevH2 = this.gameState.p2_health;

        this.handlePlayerInput();
        this.resolveCombat();
        
        // Update timers
        if (this.gameState.p1_stun > 0) this.gameState.p1_stun--;
        if (this.gameState.p2_stun > 0) this.gameState.p2_stun--;
        if (this.gameState.p1_attacking > 0) this.gameState.p1_attacking--;
        if (this.gameState.p2_attacking > 0) this.gameState.p2_attacking--;

        // Visual feedback for states
        this.player.setAlpha(this.gameState.p1_stun > 0 ? 0.5 : 1);
        this.opponent.setAlpha(this.gameState.p2_stun > 0 ? 0.5 : 1);
        this.player.setFillStyle(this.gameState.p1_attacking > 0 ? 0xffffff : 0x0088ff);
        this.opponent.setFillStyle(this.gameState.p2_attacking > 0 ? 0xffffff : 0xff4444);

        const currentState = this.captureGameState();
        
        // Calculate reward for the AI (P2)
        // AI Reward = 10 * (damage dealt to P1) - 10 * (damage taken by P2) + approach
        let reward = 10.0 * (prevH1 - this.gameState.p1_health);
        reward -= 10.0 * (prevH2 - this.gameState.p2_health);
        const dist = Math.abs(this.player.x - this.opponent.x) / this.WIDTH;
        reward += 0.005 * (1.0 - dist);

        // Send state to AI for next action
        this.aiWorker.postMessage({ type: 'predict', payload: currentState });

        // Store experience
        if (this.lastAIAction !== undefined) {
            this.aiWorker.postMessage({ 
                type: 'store_experience', 
                payload: {
                    state: prevState,
                    action: this.lastAIAction,
                    reward: reward,
                    nextState: currentState,
                    done: false
                }
            });
        }
    }

    resolveCombat() {
        const p1_rect = { x: this.player.x - 25, y: this.player.y - 50, w: 50, h: 100 };
        const p2_rect = { x: this.opponent.x - 25, y: this.opponent.y - 50, w: 50, h: 100 };

        // P1 Attacks
        if (this.gameState.p1_attacking > 0) {
            let reach_rect = { ...p1_rect };
            if (this.player.x < this.opponent.x) reach_rect.w += this.ATTACK_REACH;
            else { reach_rect.x -= this.ATTACK_REACH; reach_rect.w += this.ATTACK_REACH; }

            if (this.checkOverlap(reach_rect, p2_rect)) {
                if (!this.gameState.p2_blocking) {
                    this.gameState.p2_health -= 0.5; // Damage per frame while overlapping? 
                    // To match Python which is step-based, we should probably only damage once.
                    // But here update() runs at 60fps.
                    this.gameState.p2_stun = this.STUN_DURATION;
                    this.gameState.p2_attacking = 0;
                }
            }
        }

        // P2 Attacks
        if (this.gameState.p2_attacking > 0) {
            let reach_rect = { ...p2_rect };
            if (this.opponent.x < this.player.x) reach_rect.w += this.ATTACK_REACH;
            else { reach_rect.x -= this.ATTACK_REACH; reach_rect.w += this.ATTACK_REACH; }

            if (this.checkOverlap(reach_rect, p1_rect)) {
                if (!this.gameState.p1_blocking) {
                    this.gameState.p1_health -= 0.5;
                    this.gameState.p1_stun = this.STUN_DURATION;
                    this.gameState.p1_attacking = 0;
                }
            }
        }

        this.updateHealthBars();
    }

    checkOverlap(r1, r2) {
        return r1.x < r2.x + r2.w && r1.x + r1.w > r2.x &&
               r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;
    }

    captureGameState() {
        // Matching Python observation space (14 features)
        // Note: dx, dy are P2 relative to P1
        const dx = (this.opponent.x - this.player.x) / this.WIDTH;
        const dy = (this.opponent.y - this.player.y) / this.HEIGHT;
        
        return [
            dx, dy,
            this.gameState.p1_health / 100,
            this.gameState.p2_health / 100,
            this.player.body.velocity.x / 300, // Normalized roughly
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
