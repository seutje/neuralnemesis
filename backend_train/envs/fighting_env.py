import gymnasium as gym
from gymnasium import spaces
import numpy as np

class FightingGameEnv(gym.Env):
    metadata = {"render_modes": ["human"], "render_fps": 60}

    def __init__(self):
        super(FightingGameEnv, self).__init__()

        # Action Space: 0: Idle, 1: Left, 2: Right, 3: Jump, 4: Crouch, 5: Block, 6: Light_Attack, 7: Heavy_Attack, 8: Special
        self.action_space = spaces.Discrete(9)

        # Observation Space (14 features):
        # dx, dy, h_self, h_opp, vx_self, vy_self, vx_opp, vy_opp, 
        # self_stunned, self_attacking, self_blocking, 
        # opp_stunned, opp_attacking, opp_blocking
        # Normalized to [0, 1] or [-1, 1] where appropriate
        self.observation_space = spaces.Box(low=-1.0, high=1.0, shape=(14,), dtype=np.float32)

        # Game constants
        self.WIDTH = 800
        self.HEIGHT = 600
        self.GROUND_Y = 500
        self.PLAYER_WIDTH = 50
        self.PLAYER_HEIGHT = 100
        self.WALK_SPEED = 5
        self.JUMP_FORCE = -15
        self.GRAVITY = 0.8
        
        self.MAX_HEALTH = 100
        
        # Frame data (simplified)
        self.ATTACK_DURATION = 20
        self.STUN_DURATION = 30
        
        self.reset()

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        
        # Player 1 (AI)
        self.p1_x = 200
        self.p1_y = self.GROUND_Y - self.PLAYER_HEIGHT
        self.p1_vx = 0
        self.p1_vy = 0
        self.p1_health = self.MAX_HEALTH
        self.p1_stun = 0
        self.p1_attacking = 0
        self.p1_blocking = False
        
        # Player 2 (Opponent - Random Bot for now)
        self.p2_x = 600
        self.p2_y = self.GROUND_Y - self.PLAYER_HEIGHT
        self.p2_vx = 0
        self.p2_vy = 0
        self.p2_health = self.MAX_HEALTH
        self.p2_stun = 0
        self.p2_attacking = 0
        self.p2_blocking = False
        
        return self._get_obs(), {}

    def _get_obs(self):
        dx = (self.p2_x - self.p1_x) / self.WIDTH
        dy = (self.p2_y - self.p1_y) / self.HEIGHT
        
        obs = np.array([
            dx, dy,
            self.p1_health / self.MAX_HEALTH,
            self.p2_health / self.MAX_HEALTH,
            self.p1_vx / 10.0,
            self.p1_vy / 15.0,
            self.p2_vx / 10.0,
            self.p2_vy / 15.0,
            1.0 if self.p1_stun > 0 else 0.0,
            1.0 if self.p1_attacking > 0 else 0.0,
            1.0 if self.p1_blocking else 0.0,
            1.0 if self.p2_stun > 0 else 0.0,
            1.0 if self.p2_attacking > 0 else 0.0,
            1.0 if self.p2_blocking else 0.0
        ], dtype=np.float32)
        return obs

    def step(self, action):
        # 1. Handle P1 (AI) Input
        self._apply_action(1, action)
        
        # 2. Handle P2 (Opponent - Simple Random Bot for training)
        p2_action = self.action_space.sample()
        self._apply_action(2, p2_action)
        
        # 3. Apply Physics
        self._apply_physics(1)
        self._apply_physics(2)
        
        # 4. Resolve Combat
        reward = self._resolve_combat()
        
        # 5. Check Termination
        terminated = False
        if self.p1_health <= 0 or self.p2_health <= 0:
            terminated = True
            if self.p2_health <= 0: # P1 wins
                reward += 10.0
            elif self.p1_health <= 0: # P1 loses
                reward -= 5.0 # Extra penalty for losing
        
        truncated = False
        
        return self._get_obs(), reward, terminated, truncated, {}

    def _apply_action(self, player_num, action):
        if player_num == 1:
            stun = self.p1_stun
            attacking = self.p1_attacking
            vx = self.p1_vx
            vy = self.p1_vy
            blocking = self.p1_blocking
        else:
            stun = self.p2_stun
            attacking = self.p2_attacking
            vx = self.p2_vx
            vy = self.p2_vy
            blocking = self.p2_blocking

        # Can't move if stunned or attacking
        if stun > 0:
            vx = 0
        elif attacking > 0:
            pass # Keep momentum but can't change it easily? For now, let's say frozen in place for simplicity
        else:
            blocking = False
            if action == 1: # Left
                vx = -self.WALK_SPEED
            elif action == 2: # Right
                vx = self.WALK_SPEED
            elif action == 3: # Jump
                if player_num == 1:
                    if self.p1_y >= self.GROUND_Y - self.PLAYER_HEIGHT:
                        self.p1_vy = self.JUMP_FORCE
                else:
                    if self.p2_y >= self.GROUND_Y - self.PLAYER_HEIGHT:
                        self.p2_vy = self.JUMP_FORCE
            elif action == 4: # Crouch
                vx = 0
            elif action == 5: # Block
                vx = 0
                blocking = True
            elif action == 6: # Light Attack
                attacking = self.ATTACK_DURATION
                vx = 0
            elif action == 7: # Heavy Attack
                attacking = self.ATTACK_DURATION + 10
                vx = 0
            elif action == 8: # Special
                attacking = self.ATTACK_DURATION + 20
                vx = 0
            else: # Idle
                vx = 0

        if player_num == 1:
            self.p1_vx = vx
            self.p1_stun = max(0, stun - 1)
            self.p1_attacking = max(0, attacking - 1)
            self.p1_blocking = blocking
        else:
            self.p2_vx = vx
            self.p2_stun = max(0, stun - 1)
            self.p2_attacking = max(0, attacking - 1)
            self.p2_blocking = blocking

    def _apply_physics(self, player_num):
        if player_num == 1:
            self.p1_x += self.p1_vx
            self.p1_y += self.p1_vy
            if self.p1_y < self.GROUND_Y - self.PLAYER_HEIGHT:
                self.p1_vy += self.GRAVITY
            else:
                self.p1_y = self.GROUND_Y - self.PLAYER_HEIGHT
                self.p1_vy = 0
            # Boundary checks
            self.p1_x = max(0, min(self.WIDTH - self.PLAYER_WIDTH, self.p1_x))
        else:
            self.p2_x += self.p2_vx
            self.p2_y += self.p2_vy
            if self.p2_y < self.GROUND_Y - self.PLAYER_HEIGHT:
                self.p2_vy += self.GRAVITY
            else:
                self.p2_y = self.GROUND_Y - self.PLAYER_HEIGHT
                self.p2_vy = 0
            # Boundary checks
            self.p2_x = max(0, min(self.WIDTH - self.PLAYER_WIDTH, self.p2_x))

    def _resolve_combat(self):
        reward = 0
        h_opp_prev = self.p2_health
        h_self_prev = self.p1_health
        
        # Simple hitbox check
        p1_rect = (self.p1_x, self.p1_y, self.PLAYER_WIDTH, self.PLAYER_HEIGHT)
        p2_rect = (self.p2_x, self.p2_y, self.PLAYER_WIDTH, self.PLAYER_HEIGHT)
        
        def check_collision(r1, r2):
            return r1[0] < r2[0] + r2[2] and r1[0] + r1[2] > r2[0] and \
                   r1[1] < r2[1] + r2[3] and r1[1] + r1[3] > r2[1]

        # P1 Attacks P2
        if self.p1_attacking > 0 and check_collision(p1_rect, p2_rect):
            if not self.p2_blocking:
                damage = 1
                self.p2_health -= damage
                self.p2_stun = self.STUN_DURATION
                # Only reward once per attack frame or if damage dealt?
                # For simplicity, reward for damage dealt
            else:
                pass # Blocked
                
        # P2 Attacks P1
        if self.p2_attacking > 0 and check_collision(p1_rect, p2_rect):
            if not self.p1_blocking:
                damage = 1
                self.p1_health -= damage
                self.p1_stun = self.STUN_DURATION
            else:
                pass # Blocked

        # Reward Function from DESIGN.md:
        # R = 1.0 * (h_opp_prev - h_opp) - 1.5 * (h_self_prev - h_self)
        reward += 1.0 * (h_opp_prev - self.p2_health)
        reward -= 1.5 * (h_self_prev - self.p1_health)
        
        return reward
