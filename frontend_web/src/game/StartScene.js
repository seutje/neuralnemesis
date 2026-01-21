import Phaser from 'phaser';

export default class StartScene extends Phaser.Scene {
    constructor() {
        super('StartScene');
    }

    create() {
        const { width, height } = this.scale;

        // Background
        this.add.rectangle(width / 2, height / 2, width, height, 0x050505);
        
        // Add some decorative elements
        for (let i = 0; i < 10; i++) {
            const x = Phaser.Math.Between(0, width);
            const y = Phaser.Math.Between(0, height);
            const size = Phaser.Math.Between(50, 200);
            const rect = this.add.rectangle(x, y, size, size, 0x7000ff, 0.05);
            this.tweens.add({
                targets: rect,
                alpha: 0.1,
                duration: Phaser.Math.Between(2000, 5000),
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
        }

        // Title
        const title = this.add.text(width / 2, height / 5, 'NEURAL NEMESIS', {
            fontSize: '64px',
            fontWeight: '900',
            fontFamily: 'Outfit',
            fill: '#00f2ff',
        }).setOrigin(0.5);
        
        title.setStroke('#00f2ff', 2);
        title.setShadow(0, 0, '#00f2ff', 10, true, true);

        // Subtitle / Instructions
        const instructions = [
            "An Adaptive AI Combat Experience",
            "",
            "The AI observes your movement and combat patterns.",
            "It trains in the background to exploit your habits.",
            "The longer you fight, the more dangerous it becomes.",
            "",
            "Controls:",
            "WASD / Arrows - Move, Crouch & Jump",
            "J, K, L - Light, Heavy, Special Attacks",
            "SPACE - Block",
            "",
            "PRESS SPACE TO INITIATE COMBAT"
        ];

        const text = this.add.text(width / 2, height / 2 + 50, instructions, {
            fontSize: '18px',
            fontFamily: 'Outfit',
            fill: '#ffffff',
            align: 'center',
            lineSpacing: 10
        }).setOrigin(0.5);

        // Pulsing "Press Space"
        this.tweens.add({
            targets: text,
            alpha: 0.5,
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: 'Cubic.easeInOut'
        });

        // Input to start
        this.input.keyboard.once('keydown-SPACE', () => {
            this.scene.start('MainScene');
        });
        
        // Also allow clicking to start
        this.input.once('pointerdown', () => {
            this.scene.start('MainScene');
        });
    }
}
