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
            p1_attack_timer: 0,
            p2_attack_timer: 0,
            p1_has_hit: false,
            p2_has_hit: false,
            p1_blocking: false,
            p2_blocking: false,
        };
        this.MAX_HEALTH = 100;
        
        // Attack Phase Data: [Startup, Active, Recovery]
        this.LIGHT_ATTACK_PHASES = [4, 6, 12];   // Total 22
        this.HEAVY_ATTACK_PHASES = [10, 8, 20];  // Total 38
        this.SPECIAL_ATTACK_PHASES = [15, 10, 35]; // Total 60

        this.LIGHT_ATTACK_DUR = 22;
        this.HEAVY_ATTACK_DUR = 38;
        this.SPECIAL_ATTACK_DUR = 60;
        
        this.LIGHT_STUN = 18;
        this.HEAVY_STUN = 35;
        this.SPECIAL_STUN = 55;

        this.STUN_DURATION = 20; // Default/base
        this.ATTACK_REACH = 90;
        this.KNOCKBACK_VICTIM = 500;
        this.KNOCKBACK_ATTACKER = 250;
        this.WIDTH = 800;
        this.HEIGHT = 600;
        this.GROUND_Y = 500;
        this.PLAYER_HEIGHT = 100;
        this.CROUCH_HEIGHT = 50;
        this.isAiReady = false;
        this.waitingForPrediction = false;
        this.roundEnded = false;
        this.lastDist = 0;
        
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
        this.player.body.setDragX(1500);

        // P2 (AI) - Red
        this.opponent = this.add.rectangle(600, 450, 50, 100, 0xff4444);
        this.physics.add.existing(this.opponent);
        this.opponent.body.setCollideWorldBounds(true);
        this.opponent.body.setDragX(1500);

        // UI
        this.createUI();
        
        // Inputs
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keys = this.input.keyboard.addKeys('A,D,W,S,Q,Z,J,K,L,SPACE');

        // AI Setup
        this.setupAI();

        // Manual Reset Key
        this.input.keyboard.on('keydown-R', () => {
            console.log("MainThread: Requesting AI Reset...");
            this.aiWorker.postMessage({ type: 'reset_weights' });
        });
    }

    createUI() {
        this.p1HealthBar = this.add.graphics();
        this.p2HealthBar = this.add.graphics();
        this.updateHealthBars();

        this.statusText = this.add.text(400, 300, '', { 
            fontSize: '64px', 
            fill: '#fff', 
            fontStyle: '900',
            fontFamily: 'Outfit',
            stroke: '#000',
            strokeThickness: 8
        }).setOrigin(0.5);
        
        // AI Debug UI - Moved to right side
        this.debugContainer = this.add.container(580, 120);
        const bg = this.add.rectangle(0, 0, 200, 240, 0x000000, 0.5).setOrigin(0);
        bg.setStrokeStyle(1, 0x00f2ff, 0.3);

        this.confidenceText = this.add.text(10, 10, 'AI CONFIDENCE: ---', { fontSize: '12px', fill: '#00f2ff', fontFamily: 'Outfit', fontWeight: 'bold' });
        this.intentText = this.add.text(10, 30, 'INTENT: ---', { fontSize: '12px', fill: '#7000ff', fontFamily: 'Outfit', fontWeight: 'bold' });
        this.bufferText = this.add.text(10, 50, 'MEMORIES: 0', { fontSize: '12px', fill: '#ff00c8', fontFamily: 'Outfit', fontWeight: 'bold' });
        
        // Probability bars
        this.probBars = [];
        const actions = ['IDLE', 'LEFT', 'RIGHT', 'JUMP', 'CROUCH', 'BLOCK', 'LIGHT', 'HEAVY', 'SPECIAL'];
        for (let i = 0; i < 9; i++) {
            const label = this.add.text(10, 75 + i * 18, actions[i], { fontSize: '10px', fill: '#fff', fontFamily: 'Outfit' });
            const barBg = this.add.rectangle(60, 80 + i * 18, 120, 8, 0xffffff, 0.1).setOrigin(0, 0.5);
            const bar = this.add.rectangle(60, 80 + i * 18, 0, 8, 0x00f2ff).setOrigin(0, 0.5);
            this.probBars.push(bar);
            this.debugContainer.add([label, barBg, bar]);
        }
        
        this.debugContainer.add([bg, this.confidenceText, this.intentText, this.bufferText]);
    }

    updateHealthBars() {
        const y = 50; // Moved up by 50px to avoid overlap
        this.p1HealthBar.clear();
        // P1 Health (Blue/Cyan)
        this.p1HealthBar.fillStyle(0x000000, 0.5);
        this.p1HealthBar.fillRect(50, y, 300, 30);
        this.p1HealthBar.fillStyle(0x00f2ff, 1);
        this.p1HealthBar.fillRect(50, y, Math.max(0, this.gameState.p1_health) * 3, 30);
        this.p1HealthBar.lineStyle(2, 0x00f2ff, 0.5);
        this.p1HealthBar.strokeRect(50, y, 300, 30);
        
        // Labels
        if (!this.p1Label) {
            this.p1Label = this.add.text(50, y - 20, 'PLAYER', { fontSize: '14px', fill: '#00f2ff', fontWeight: 'bold', fontFamily: 'Outfit' });
        } else {
            this.p1Label.setY(y - 20);
        }

        if (!this.p2Label) {
            this.p2Label = this.add.text(750, y - 20, 'NEMESIS AI', { fontSize: '14px', fill: '#ff00c8', fontWeight: 'bold', fontFamily: 'Outfit' }).setOrigin(1, 0);
        } else {
            this.p2Label.setY(y - 20);
        }

        this.p2HealthBar.clear();
        // P2 Health (Magenta/Purple)
        this.p2HealthBar.fillStyle(0x000000, 0.5);
        this.p2HealthBar.fillRect(450, y, 300, 30);
        this.p2HealthBar.fillStyle(0xff00c8, 1);
        const p2Width = Math.max(0, this.gameState.p2_health) * 3;
        this.p2HealthBar.fillRect(750 - p2Width, y, p2Width, 30);
        this.p2HealthBar.lineStyle(2, 0xff00c8, 0.5);
        this.p2HealthBar.strokeRect(450, y, 300, 30);
    }

    setupAI() {
        this.aiWorker = new Worker(new URL('../ai/ai_worker.js', import.meta.url), { type: 'module' });
        this.aiWorker.postMessage({ type: 'init' });
        this.aiWorker.onmessage = (e) => {
            const { type, payload, confidence, bufferSize, probs } = e.data;
            
            if (type === 'weights_reset') {
                this.statusText.setText('AI RESET');
                this.time.delayedCall(1000, () => this.statusText.setText(''));
            }
            
            if (type === 'ready') {
                console.log("MainThread: AI Worker is READY");
                this.isAiReady = true;
                const statusText = document.getElementById('ai-status');
                const statusDot = document.getElementById('ai-status-dot');
                if (statusText) {
                    statusText.innerText = 'Online';
                    statusText.style.color = '#00f2ff';
                }
                if (statusDot) {
                    statusDot.style.background = '#00f2ff';
                    statusDot.style.boxShadow = '0 0 10px #00f2ff';
                }
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
                this.bufferText.setText(`MEMORIES: ${bufferSize}`);
            }

            if (type === 'error') {
                console.error("MainThread: AI Worker error", payload);
                const statusText = document.getElementById('ai-status');
                const statusDot = document.getElementById('ai-status-dot');
                if (statusText) {
                    statusText.innerText = 'Error';
                    statusText.style.color = '#ff0055';
                }
                if (statusDot) {
                    statusDot.style.background = '#ff0055';
                    statusDot.style.boxShadow = '0 0 10px #ff0055';
                }
            }
        };
    }

    handlePlayerInput() {
        if (this.gameState.p1_stun > 0) {
            return;
        }

        if (this.gameState.p1_attacking > 0) {
            // Can't initiate movement while attacking, but allow existing momentum (knockback)
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
            this.gameState.p1_has_hit = false;
            vx = 0;
        } else if (Phaser.Input.Keyboard.JustDown(this.keys.K)) {
            this.gameState.p1_attacking = 2; // Heavy
            this.gameState.p1_attack_timer = this.HEAVY_ATTACK_DUR;
            this.gameState.p1_has_hit = false;
            vx = 0;
        } else if (Phaser.Input.Keyboard.JustDown(this.keys.L)) {
            this.gameState.p1_attacking = 3; // Special
            this.gameState.p1_attack_timer = this.SPECIAL_ATTACK_DUR;
            this.gameState.p1_has_hit = false;
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
            this.gameState.p2_has_hit = false;
            vx = 0;
        } else if (action === 7) { // Heavy Attack
            this.gameState.p2_attacking = 2;
            this.gameState.p2_attack_timer = this.HEAVY_ATTACK_DUR;
            this.gameState.p2_has_hit = false;
            vx = 0;
        } else if (action === 8) { // Special Attack
            this.gameState.p2_attacking = 3;
            this.gameState.p2_attack_timer = this.SPECIAL_ATTACK_DUR;
            this.gameState.p2_has_hit = false;
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
        
        // Attack colors with phase feedback
        if (this.gameState.p1_attacking > 0) {
            let type = this.gameState.p1_attacking;
            let timer = this.gameState.p1_attack_timer;
            let phases, total_dur, base_color;
            if (type === 1) { phases = this.LIGHT_ATTACK_PHASES; total_dur = this.LIGHT_ATTACK_DUR; base_color = 0xffffff; }
            else if (type === 2) { phases = this.HEAVY_ATTACK_PHASES; total_dur = this.HEAVY_ATTACK_DUR; base_color = 0xffff00; }
            else { phases = this.SPECIAL_ATTACK_PHASES; total_dur = this.SPECIAL_ATTACK_DUR; base_color = 0xff00ff; }

            const elapsed = total_dur - timer;
            if (elapsed < phases[0]) this.player.setFillStyle(0x444444); // Startup (Gray)
            else if (elapsed < phases[0] + phases[1]) this.player.setFillStyle(base_color); // Active
            else this.player.setFillStyle(0x884400); // Recovery (Brown)
        } else {
            this.player.setFillStyle(0x0088ff);
        }

        if (this.gameState.p2_attacking > 0) {
            let type = this.gameState.p2_attacking;
            let timer = this.gameState.p2_attack_timer;
            let phases, total_dur, base_color;
            if (type === 1) { phases = this.LIGHT_ATTACK_PHASES; total_dur = this.LIGHT_ATTACK_DUR; base_color = 0xffffff; }
            else if (type === 2) { phases = this.HEAVY_ATTACK_PHASES; total_dur = this.HEAVY_ATTACK_DUR; base_color = 0xffff00; }
            else { phases = this.SPECIAL_ATTACK_PHASES; total_dur = this.SPECIAL_ATTACK_DUR; base_color = 0xff00ff; }

            const elapsed = total_dur - timer;
            if (elapsed < phases[0]) this.opponent.setFillStyle(0x444444);
            else if (elapsed < phases[0] + phases[1]) this.opponent.setFillStyle(base_color);
            else this.opponent.setFillStyle(0x884400);
        } else {
            this.opponent.setFillStyle(0xff4444);
        }

        const currentState = this.captureGameState();
        
        if (this.isAiReady) {
            // AI Reward Calculation (Synchronized with FightingGameEnv.py)
            // Python: reward += 40.0 * dmg_dealt - 10.0 * dmg_taken
            const dmg_dealt = Math.max(0, prevH1 - this.gameState.p1_health);
            const dmg_taken = Math.max(0, prevH2 - this.gameState.p2_health);
            let reward = 40.0 * dmg_dealt - 10.0 * dmg_taken;
            
            // Delta-Distance Reward: Reward for getting closer
            const currDist = Math.abs(this.player.x - this.opponent.x) / this.WIDTH;
            
            // Note: Since MainScene update happens once per frame
            if (this.lastDist !== undefined) {
                reward += (this.lastDist - currDist) * 10.0;
            }
            this.lastDist = currDist;

            // Efficiency penalty
            reward -= 0.01;

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
        if (this.gameState.p1_attacking > 0 && !this.gameState.p1_has_hit) {
            let type = this.gameState.p1_attacking;
            let timer = this.gameState.p1_attack_timer;
            let phases, total_dur;
            
            if (type === 1) { phases = this.LIGHT_ATTACK_PHASES; total_dur = this.LIGHT_ATTACK_DUR; }
            else if (type === 2) { phases = this.HEAVY_ATTACK_PHASES; total_dur = this.HEAVY_ATTACK_DUR; }
            else { phases = this.SPECIAL_ATTACK_PHASES; total_dur = this.SPECIAL_ATTACK_DUR; }

            const elapsed = total_dur - timer;
            const is_active = elapsed >= phases[0] && elapsed < (phases[0] + phases[1]);

            if (is_active) {
                let reach = this.ATTACK_REACH;
                if (type === 2) reach += 20;
                if (type === 3) reach += 50;

                let reach_rect = { ...p1_rect };
                if (this.player.x < this.opponent.x) reach_rect.w += reach;
                else { reach_rect.x -= reach; reach_rect.w += reach; }

                if (this.checkOverlap(reach_rect, p2_rect)) {
                    if (!this.gameState.p2_blocking) {
                        let damage = 1.5;
                        let stun = this.LIGHT_STUN;
                        if (type === 2) { damage = 4.0; stun = this.HEAVY_STUN; }
                        if (type === 3) { damage = 8.0; stun = this.SPECIAL_STUN; }

                        this.gameState.p2_health -= damage;
                        this.gameState.p2_stun = stun;
                        this.gameState.p2_attack_timer = 0;
                        this.gameState.p2_attacking = 0;
                        this.gameState.p1_has_hit = true;

                        // Knockback
                        const dir = this.player.x < this.opponent.x ? 1 : -1;
                        this.opponent.body.setVelocityX(dir * this.KNOCKBACK_VICTIM);
                        this.player.body.setVelocityX(-dir * this.KNOCKBACK_ATTACKER);
                    }
                }
            }
        }

        // P2 Attacks
        if (this.gameState.p2_attacking > 0 && !this.gameState.p2_has_hit) {
            let type = this.gameState.p2_attacking;
            let timer = this.gameState.p2_attack_timer;
            let phases, total_dur;
            
            if (type === 1) { phases = this.LIGHT_ATTACK_PHASES; total_dur = this.LIGHT_ATTACK_DUR; }
            else if (type === 2) { phases = this.HEAVY_ATTACK_PHASES; total_dur = this.HEAVY_ATTACK_DUR; }
            else { phases = this.SPECIAL_ATTACK_PHASES; total_dur = this.SPECIAL_ATTACK_DUR; }

            const elapsed = total_dur - timer;
            const is_active = elapsed >= phases[0] && elapsed < (phases[0] + phases[1]);

            if (is_active) {
                let reach = this.ATTACK_REACH;
                if (type === 2) reach += 20;
                if (type === 3) reach += 50;

                let reach_rect = { ...p2_rect };
                if (this.opponent.x < this.player.x) reach_rect.w += reach;
                else { reach_rect.x -= reach; reach_rect.w += reach; }

                if (this.checkOverlap(reach_rect, p1_rect)) {
                    if (!this.gameState.p1_blocking) {
                        let damage = 1.5;
                        let stun = this.LIGHT_STUN;
                        if (type === 2) { damage = 4.0; stun = this.HEAVY_STUN; }
                        if (type === 3) { damage = 8.0; stun = this.SPECIAL_STUN; }

                        this.gameState.p1_health -= damage;
                        this.gameState.p1_stun = stun;
                        this.gameState.p1_attack_timer = 0;
                        this.gameState.p1_attacking = 0;
                        this.gameState.p2_has_hit = true;

                        // Knockback
                        const dir = this.opponent.x < this.player.x ? 1 : -1;
                        this.player.body.setVelocityX(dir * this.KNOCKBACK_VICTIM);
                        this.opponent.body.setVelocityX(-dir * this.KNOCKBACK_ATTACKER);
                    }
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
        this.gameState.p1_has_hit = false;
        this.gameState.p2_attacking = 0;
        this.gameState.p2_attack_timer = 0;
        this.gameState.p2_has_hit = false;
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
        
        // CONVERSION: Phaser uses pixels/sec. Python model expects pixels/frame.
        // Divide by 60 to get pixels/frame, then divide by the scale factors used in FightingGameEnv.py
        const self_vx = (this.opponent.body.velocity.x / 60) / 10.0;
        const self_vy = (this.opponent.body.velocity.y / 60) / 15.0;
        const opp_vx = (this.player.body.velocity.x / 60) / 10.0;
        const opp_vy = (this.player.body.velocity.y / 60) / 15.0;

        return [
            dx, dy,
            this.gameState.p2_health / 100, // Self Health (AI)
            this.gameState.p1_health / 100, // Opponent Health (Human)
            self_vx,
            self_vy,
            opp_vx,
            opp_vy,
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
