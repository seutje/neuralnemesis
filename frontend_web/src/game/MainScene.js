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
        this.LIGHT_ATTACK_DUR = 20;
        this.HEAVY_ATTACK_DUR = 35;
        this.SPECIAL_ATTACK_DUR = 55;
        
        this.STUN_DURATION = 30;
        this.ATTACK_REACH = 90;
        this.WIDTH = 800;
        this.HEIGHT = 600;
        this.GROUND_Y = 500;
        this.PLAYER_HEIGHT = 100;
        this.CROUCH_HEIGHT = 50;
        this.isAiReady = false;
        this.waitingForPrediction = false;
        this.roundEnded = false;
        
        // Humanizing AI: Action Queue
        this.aiActionQueue = [];
        this.REACTION_DELAY_FRAMES = 10; // ~160ms at 60fps
    }

    preload() {
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
        this.keys = this.input.keyboard.addKeys('A,D,W,S,Q,Z,J,K,L,SPACE');

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
        const bg = this.add.rectangle(0, 0, 200, 240, 0x000000, 0.7).setOrigin(0);
        this.confidenceText = this.add.text(10, 10, 'AI Confidence: ---', { fontSize: '14px', fill: '#0ff' });
        this.intentText = this.add.text(10, 30, 'Intent: ---', { fontSize: '14px', fill: '#f0f' });
        this.bufferText = this.add.text(10, 50, 'Memories: 0', { fontSize: '14px', fill: '#ff0' });
        
        // Probability bars
        this.probBars = [];
        const actions = ['Idle', 'Left', 'Right', 'Jump', 'Crouch', 'Block', 'Light', 'Heavy', 'Spec'];
        for (let i = 0; i < 9; i++) {
            const label = this.add.text(10, 75 + i * 18, actions[i], { fontSize: '10px', fill: '#aaa' });
            const bar = this.add.rectangle(50, 80 + i * 18, 0, 10, 0x00ff00).setOrigin(0, 0.5);
            this.probBars.push(bar);
            this.debugContainer.add([label, bar]);
        }
        
        this.debugContainer.add([bg, this.confidenceText, this.intentText, this.bufferText]);
    }

    updateHealthBars() {
        this.p1HealthBar.clear();
        this.p1HealthBar.fillStyle(0xff0000, 0.3); // Background
        this.p1HealthBar.fillRect(50, 50, 200, 20);
        this.p1HealthBar.fillStyle(0x00ff00, 1); // Foreground
        this.p1HealthBar.fillRect(50, 50, Math.max(0, this.gameState.p1_health) * 2, 20);
        this.p1HealthBar.lineStyle(2, 0xffffff);
        this.p1HealthBar.strokeRect(50, 50, 200, 20);

        this.p2HealthBar.clear();
        this.p2HealthBar.fillStyle(0xff0000, 0.3);
        this.p2HealthBar.fillRect(550, 50, 200, 20);
        this.p2HealthBar.fillStyle(0x00ff00, 1);
        this.p2HealthBar.fillRect(550, 50, Math.max(0, this.gameState.p2_health) * 2, 20);
        this.p2HealthBar.lineStyle(2, 0xffffff);
        this.p2HealthBar.strokeRect(550, 50, 200, 20);
    }

    setupAI() {
        this.aiWorker = new Worker(new URL('../ai/ai_worker.js', import.meta.url), { type: 'module' });
        this.aiWorker.postMessage({ type: 'init' });
        this.aiWorker.onmessage = (e) => {
            const { type, payload, confidence, bufferSize, probs } = e.data;
            
            if (type === 'ready') {
                console.log("MainThread: AI Worker is READY");
                this.isAiReady = true;
                document.getElementById('ai-status').innerText = 'Online';
                document.getElementById('ai-status').style.color = '#0f0';
            }
            
            if (type === 'action') {
                // Instead of executing immediately, push to queue
                this.aiActionQueue.push({
                    action: payload,
                    confidence: confidence,
                    probs: probs,
                    time: this.time.now
                });
                this.waitingForPrediction = false;
            }

            if (type === 'stats') {
                this.bufferText.setText(`Memories: ${bufferSize}`);
            }

            if (type === 'error') {
                console.error("MainThread: AI Worker error", payload);
                document.getElementById('ai-status').innerText = 'Error';
                document.getElementById('ai-status').style.color = '#f00';
            }
        };
    }

    handlePlayerInput() {
        if (this.gameState.p1_stun > 0) {
            this.player.body.setVelocityX(0);
            return;
        }

        if (this.gameState.p1_attacking > 0) {
            // Can't move while attacking
            this.player.body.setVelocityX(0);
            return;
        }

        this.gameState.p1_blocking = false;
        this.gameState.p1_crouching = false;
        let vx = 0;

        if (this.cursors.left.isDown || this.keys.A.isDown || this.keys.Q.isDown) vx = -300;
        else if (this.cursors.right.isDown || this.keys.D.isDown) vx = 300;

        if ((this.cursors.up.isDown || this.keys.W.isDown || this.keys.Z.isDown) && this.player.body.blocked.down) {
            this.player.body.setVelocityY(-600);
        }

        if (this.keys.S.isDown || this.cursors.down.isDown) {
            vx = 0;
            this.gameState.p1_crouching = true;
        }

        if (this.keys.SPACE.isDown) {
            vx = 0;
            this.gameState.p1_blocking = true;
        }

        if (Phaser.Input.Keyboard.JustDown(this.keys.J)) {
            this.gameState.p1_attacking = 1; // Light
            this.gameState.p1_attack_timer = this.LIGHT_ATTACK_DUR;
            vx = 0;
        } else if (Phaser.Input.Keyboard.JustDown(this.keys.K)) {
            this.gameState.p1_attacking = 2; // Heavy
            this.gameState.p1_attack_timer = this.HEAVY_ATTACK_DUR;
            vx = 0;
        } else if (Phaser.Input.Keyboard.JustDown(this.keys.L)) {
            this.gameState.p1_attacking = 3; // Special
            this.gameState.p1_attack_timer = this.SPECIAL_ATTACK_DUR;
            vx = 0;
        }

        this.player.body.setVelocityX(vx);
        
        // Handle Visual Crouching
        if (this.gameState.p1_crouching) {
            this.player.setDisplaySize(50, this.CROUCH_HEIGHT);
            this.player.body.setSize(50, this.CROUCH_HEIGHT);
            this.player.body.setOffset(0, this.PLAYER_HEIGHT - this.CROUCH_HEIGHT);
        } else {
            this.player.setDisplaySize(50, this.PLAYER_HEIGHT);
            this.player.body.setSize(50, this.PLAYER_HEIGHT);
            this.player.body.setOffset(0, 0);
        }
    }

    executeAIAction(action) {
        // AI is P2
        if (this.gameState.p2_stun > 0 || this.gameState.p2_attacking > 0) return;

        this.lastAIAction = action;
        this.gameState.p2_blocking = false;
        this.gameState.p2_crouching = false;
        let vx = 0;

        if (action === 1) vx = -300; // Left
        else if (action === 2) vx = 300; // Right
        
        if (action === 3 && this.opponent.body.blocked.down) {
            this.opponent.body.setVelocityY(-600); // Jump
        }

        if (action === 4) { // Crouch
            vx = 0;
            this.gameState.p2_crouching = true;
        }

        if (action === 5) { // Block
            vx = 0;
            this.gameState.p2_blocking = true;
        }

        if (action === 6) { // Light Attack
            this.gameState.p2_attacking = 1;
            this.gameState.p2_attack_timer = this.LIGHT_ATTACK_DUR;
            vx = 0;
        } else if (action === 7) { // Heavy Attack
            this.gameState.p2_attacking = 2;
            this.gameState.p2_attack_timer = this.HEAVY_ATTACK_DUR;
            vx = 0;
        } else if (action === 8) { // Special Attack
            this.gameState.p2_attacking = 3;
            this.gameState.p2_attack_timer = this.SPECIAL_ATTACK_DUR;
            vx = 0;
        }

        this.opponent.body.setVelocityX(vx);

        // Handle Visual Crouching for AI
        if (this.gameState.p2_crouching) {
            this.opponent.setDisplaySize(50, this.CROUCH_HEIGHT);
            this.opponent.body.setSize(50, this.CROUCH_HEIGHT);
            this.opponent.body.setOffset(0, this.PLAYER_HEIGHT - this.CROUCH_HEIGHT);
        } else {
            this.opponent.setDisplaySize(50, this.PLAYER_HEIGHT);
            this.opponent.body.setSize(50, this.PLAYER_HEIGHT);
            this.opponent.body.setOffset(0, 0);
        }
    }

    update() {
        if (this.gameState.p1_health <= 0 || this.gameState.p2_health <= 0) {
            if (!this.roundEnded) {
                this.roundEnded = true;
                this.statusText.setText(this.gameState.p1_health <= 0 ? 'AI WINS' : 'PLAYER WINS');
                
                // Trigger Training at end of round
                console.log("MainThread: Round ended. Triggering AI Training...");
                this.aiWorker.postMessage({ type: 'train' });
                
                // Reset round after a delay
                this.time.delayedCall(3000, () => {
                    this.resetRound();
                });
            }
            this.player.body.setVelocityX(0);
            this.opponent.body.setVelocityX(0);
            return;
        }

        // Handle AI Action Queue (Reaction Delay)
        if (this.aiActionQueue.length > this.REACTION_DELAY_FRAMES) {
            const next = this.aiActionQueue.shift();
            this.executeAIAction(next.action);
            
            // Update Debug UI
            this.confidenceText.setText(`AI Confidence: ${(next.confidence).toFixed(2)}`);
            const actions = ['Idle', 'Left', 'Right', 'Jump', 'Crouch', 'Block', 'Light', 'Heavy', 'Spec'];
            this.intentText.setText(`Intent: ${actions[next.action]}`);
            
            // Update probability bars
            if (next.probs) {
                next.probs.forEach((p, i) => {
                    this.probBars[i].width = p * 120; // 120px max width
                });
            }
        }

        const prevState = this.captureGameState();
        const prevH1 = this.gameState.p1_health;
        const prevH2 = this.gameState.p2_health;

        this.handlePlayerInput();
        this.resolveCombat();
        
        // Update timers
        if (this.gameState.p1_stun > 0) this.gameState.p1_stun--;
        if (this.gameState.p2_stun > 0) this.gameState.p2_stun--;
        
        if (this.gameState.p1_attack_timer > 0) {
            this.gameState.p1_attack_timer--;
            if (this.gameState.p1_attack_timer === 0) this.gameState.p1_attacking = 0;
        }
        if (this.gameState.p2_attack_timer > 0) {
            this.gameState.p2_attack_timer--;
            if (this.gameState.p2_attack_timer === 0) this.gameState.p2_attacking = 0;
        }

        // Visual feedback for states
        this.player.setAlpha(this.gameState.p1_stun > 0 ? 0.5 : 1);
        this.opponent.setAlpha(this.gameState.p2_stun > 0 ? 0.5 : 1);
        
        // Attack colors
        if (this.gameState.p1_attacking === 1) this.player.setFillStyle(0xffffff);
        else if (this.gameState.p1_attacking === 2) this.player.setFillStyle(0xffff00);
        else if (this.gameState.p1_attacking === 3) this.player.setFillStyle(0xff00ff);
        else this.player.setFillStyle(0x0088ff);

        if (this.gameState.p2_attacking === 1) this.opponent.setFillStyle(0xffffff);
        else if (this.gameState.p2_attacking === 2) this.opponent.setFillStyle(0xffff00);
        else if (this.gameState.p2_attacking === 3) this.opponent.setFillStyle(0xff00ff);
        else this.opponent.setFillStyle(0xff4444);

        const currentState = this.captureGameState();
        
        if (this.isAiReady) {
            // AI Reward Calculation
            let reward = 10.0 * (prevH1 - this.gameState.p1_health);
            reward -= 10.0 * (prevH2 - this.gameState.p2_health);
            const dist = Math.abs(this.player.x - this.opponent.x) / this.WIDTH;
            reward += 0.005 * (1.0 - dist);

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

            // Predict next action
            if (!this.waitingForPrediction) {
                this.waitingForPrediction = true;
                this.aiWorker.postMessage({ type: 'predict', payload: currentState });
            }
        }
    }

    resolveCombat() {
        const p1_h = this.gameState.p1_crouching ? this.CROUCH_HEIGHT : this.PLAYER_HEIGHT;
        const p2_h = this.gameState.p2_crouching ? this.CROUCH_HEIGHT : this.PLAYER_HEIGHT;

        const p1_rect = { x: this.player.x - 25, y: this.player.y - (p1_h/2), w: 50, h: p1_h };
        const p2_rect = { x: this.opponent.x - 25, y: this.opponent.y - (p2_h/2), w: 50, h: p2_h };

        // P1 Attacks
        if (this.gameState.p1_attack_timer > 0) {
            let reach = this.ATTACK_REACH;
            if (this.gameState.p1_attacking === 2) reach += 20;
            if (this.gameState.p1_attacking === 3) reach += 50;

            let reach_rect = { ...p1_rect };
            if (this.player.x < this.opponent.x) reach_rect.w += reach;
            else { reach_rect.x -= reach; reach_rect.w += reach; }

            if (this.checkOverlap(reach_rect, p2_rect)) {
                if (!this.gameState.p2_blocking) {
                    let damage = 1.0;
                    let stun = this.STUN_DURATION;
                    if (this.gameState.p1_attacking === 2) { damage = 2.5; stun += 15; }
                    if (this.gameState.p1_attacking === 3) { damage = 5.0; stun += 40; }

                    this.gameState.p2_health -= damage;
                    this.gameState.p2_stun = stun;
                    this.gameState.p2_attack_timer = 0;
                    this.gameState.p2_attacking = 0; // Interrupt
                }
            }
        }

        // P2 Attacks
        if (this.gameState.p2_attack_timer > 0) {
            let reach = this.ATTACK_REACH;
            if (this.gameState.p2_attacking === 2) reach += 20;
            if (this.gameState.p2_attacking === 3) reach += 50;

            let reach_rect = { ...p2_rect };
            if (this.opponent.x < this.player.x) reach_rect.w += reach;
            else { reach_rect.x -= reach; reach_rect.w += reach; }

            if (this.checkOverlap(reach_rect, p1_rect)) {
                if (!this.gameState.p1_blocking) {
                    let damage = 1.0;
                    let stun = this.STUN_DURATION;
                    if (this.gameState.p2_attacking === 2) { damage = 2.5; stun += 15; }
                    if (this.gameState.p2_attacking === 3) { damage = 5.0; stun += 40; }

                    this.gameState.p1_health -= damage;
                    this.gameState.p1_stun = stun;
                    this.gameState.p1_attack_timer = 0;
                    this.gameState.p1_attacking = 0; // Interrupt
                }
            }
        }

        this.updateHealthBars();
    }

    resetRound() {
        this.gameState.p1_health = 100;
        this.gameState.p2_health = 100;
        this.gameState.p1_stun = 0;
        this.gameState.p2_stun = 0;
        this.gameState.p1_attacking = 0;
        this.gameState.p1_attack_timer = 0;
        this.gameState.p2_attacking = 0;
        this.gameState.p2_attack_timer = 0;
        this.gameState.p1_blocking = false;
        this.gameState.p2_blocking = false;
        this.gameState.p1_crouching = false;
        this.gameState.p2_crouching = false;
        
        this.player.setPosition(200, 450);
        this.opponent.setPosition(600, 450);
        this.player.body.setVelocity(0, 0);
        this.opponent.body.setVelocity(0, 0);
        
        // Reset Visuals
        this.player.setDisplaySize(50, this.PLAYER_HEIGHT);
        this.player.body.setSize(50, this.PLAYER_HEIGHT);
        this.opponent.setDisplaySize(50, this.PLAYER_HEIGHT);
        this.opponent.body.setSize(50, this.PLAYER_HEIGHT);

        this.statusText.setText('');
        this.roundEnded = false;
        this.updateHealthBars();
        this.aiActionQueue = [];
    }

    checkOverlap(r1, r2) {
        return r1.x < r2.x + r2.w && r1.x + r1.w > r2.x &&
               r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;
    }

    captureGameState() {
        // Mapping AI (this.opponent) to "Self" (p1) 
        // and Human (this.player) to "Opponent" (p2)
        // to match the Python model's perspective.
        
        const dx = (this.player.x - this.opponent.x) / this.WIDTH;
        const dy = (this.player.y - this.opponent.y) / this.HEIGHT;
        
        return [
            dx, dy,
            this.gameState.p2_health / 100, // Self Health (AI)
            this.gameState.p1_health / 100, // Opponent Health (Human)
            this.opponent.body.velocity.x / 300, // Self Vel (AI)
            this.opponent.body.velocity.y / 500,
            this.player.body.velocity.x / 300,   // Opponent Vel (Human)
            this.player.body.velocity.y / 500,
            this.gameState.p2_stun > 0 ? 1 : 0,  // Self Flags
            this.gameState.p2_attack_timer > 0 ? 1 : 0,
            this.gameState.p2_blocking ? 1 : 0,
            this.gameState.p2_crouching ? 1 : 0,
            this.gameState.p1_stun > 0 ? 1 : 0,  // Opponent Flags
            this.gameState.p1_attack_timer > 0 ? 1 : 0,
            this.gameState.p1_blocking ? 1 : 0,
            this.gameState.p1_crouching ? 1 : 0
        ];
    }
}
