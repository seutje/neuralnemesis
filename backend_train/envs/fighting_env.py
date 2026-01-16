import gymnasium as gym
from gymnasium import spaces
import numpy as np

class FightingGameEnv(gym.Env):
    metadata = {"render_modes": ["human"], "render_fps": 60}

    def __init__(self):
        super(FightingGameEnv, self).__init__()

        # Action Space: 0: Idle, 1: Left, 2: Right, 3: Jump, 4: Crouch, 5: Block, 6: Light_Attack, 7: Heavy_Attack, 8: Special
        self.action_space = spaces.Discrete(9)

        # Observation Space (16 features):
        # dx, dy, h_self, h_opp, vx_self, vy_self, vx_opp, vy_opp, 
        # self_stunned, self_attacking, self_blocking, self_crouching,
        # opp_stunned, opp_attacking, opp_blocking, opp_crouching
        # Normalized to [0, 1] or [-1, 1] where appropriate
        self.observation_space = spaces.Box(low=-1.0, high=1.0, shape=(16,), dtype=np.float32)

        # Game constants
        self.WIDTH = 800
        self.HEIGHT = 600
        self.GROUND_Y = 500
        self.PLAYER_WIDTH = 50
        self.PLAYER_HEIGHT = 100
        self.CROUCH_HEIGHT = 50
        self.WALK_SPEED = 5
        self.JUMP_FORCE = -15
        self.GRAVITY = 0.8
        
        self.MAX_HEALTH = 100
        self.MAX_STEPS = 2000 # 2000 frames is about 33 seconds at 60fps
        
        # Frame data (Updated to match frontend)
        self.LIGHT_ATTACK_DUR = 22
        self.HEAVY_ATTACK_DUR = 38
        self.SPECIAL_ATTACK_DUR = 60
        
        self.LIGHT_PHASES = [4, 6, 12]   # Startup, Active, Recovery
        self.HEAVY_PHASES = [10, 8, 20]
        self.SPECIAL_PHASES = [15, 10, 35]
        
        self.LIGHT_STUN = 18
        self.HEAVY_STUN = 35
        self.SPECIAL_STUN = 55

        self.STUN_DURATION = 20 # Base
        self.ATTACK_REACH = 90
        self.KNOCKBACK_VICTIM = 10.0
        self.KNOCKBACK_ATTACKER = 5.0
        self.DRAG = 0.8
        
        self.reset()

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.current_step = 0
        
        # Seeded random number generator is now in self.np_random from super().reset()
        
        # Opponent (P2) Action Persistence
        self.p2_action_timer = 0
        self.p2_current_action = 0
        
        # Randomize starting positions to prevent directional bias
        side = self.np_random.choice([0, 1])
        if side == 0:
            self.p1_x = 200
            self.p2_x = 600
        else:
            self.p1_x = 600
            self.p2_x = 200

        self.p1_y = self.GROUND_Y - self.PLAYER_HEIGHT
        self.p1_vx = 0
        self.p1_vy = 0
        self.p1_health = self.MAX_HEALTH
        self.p1_stun = 0
        self.p1_attacking = 0 # 0: none, 1: light, 2: heavy, 3: special
        self.p1_attack_timer = 0
        self.p1_has_hit = False
        self.p1_blocking = False
        self.p1_crouching = False
        
        self.p2_y = self.GROUND_Y - self.PLAYER_HEIGHT
        self.p2_vx = 0
        self.p2_vy = 0
        self.p2_health = self.MAX_HEALTH
        self.p2_stun = 0
        self.p2_attacking = 0 # 0: none, 1: light, 2: heavy, 3: special
        self.p2_attack_timer = 0
        self.p2_has_hit = False
        self.p2_blocking = False
        self.p2_crouching = False
        
        return self._get_obs(), {}

    def _get_obs(self):
        # dx, dy: Relative distance between players (normalized to [-1, 1])
        dx = (self.p2_x - self.p1_x) / self.WIDTH
        dy = (self.p2_y - self.p1_y) / self.HEIGHT
        
        obs = np.array([
            dx, dy,
            self.p1_health / self.MAX_HEALTH,
            self.p2_health / self.MAX_HEALTH,
            self.p1_vx / 5.0,  # Max walk speed is 5
            self.p1_vy / 15.0, # Max jump force is 15
            self.p2_vx / 5.0,
            self.p2_vy / 15.0,
            1.0 if self.p1_stun > 0 else 0.0,
            1.0 if self.p1_attack_timer > 0 else 0.0,
            1.0 if self.p1_blocking else 0.0,
            1.0 if self.p1_crouching else 0.0,
            1.0 if self.p2_stun > 0 else 0.0,
            1.0 if self.p2_attack_timer > 0 else 0.0,
            1.0 if self.p2_blocking else 0.0,
            1.0 if self.p2_crouching else 0.0
        ], dtype=np.float32)
        return obs

    def step(self, action):
        # 1. Handle P1 (AI) Input
        self._apply_action(1, action)
        
        # 2. Handle P2 (Opponent - Aggressive Random Bot)
        if self.p2_action_timer <= 0:
            # 70% chance to move towards P1, 30% chance for random action
            if self.np_random.random() < 0.7:
                if self.p2_x > self.p1_x + self.PLAYER_WIDTH + 20:
                    self.p2_current_action = 1 # Left
                elif self.p2_x < self.p1_x - self.PLAYER_WIDTH - 20:
                    self.p2_current_action = 2 # Right
                else:
                    self.p2_current_action = self.np_random.choice([5, 6, 7, 8]) # Block or Attack
            else:
                self.p2_current_action = self.action_space.sample()
            self.p2_action_timer = 15
        else:
            self.p2_action_timer -= 1
            
        self._apply_action(2, self.p2_current_action)
        
        # 3. Apply Physics
        self._apply_physics(1)
        self._apply_physics(2)
        
        # 4. Resolve Combat
        reward = self._resolve_combat()
        
        # 5. Check Termination
        self.current_step += 1
        terminated = False
        if self.p1_health <= 0 or self.p2_health <= 0:
            terminated = True
            if self.p2_health <= 0: # P1 wins
                reward += 100.0 # Massive win bonus
            elif self.p1_health <= 0: # P1 loses
                reward -= 50.0 # Significant loss penalty
        
        truncated = self.current_step >= self.MAX_STEPS
        
        return self._get_obs(), reward, terminated, truncated, {}

    def _apply_action(self, player_num, action):
        if player_num == 1:
            stun = self.p1_stun
            attacking = self.p1_attacking
            attack_timer = self.p1_attack_timer
            vx = self.p1_vx
            vy = self.p1_vy
            blocking = self.p1_blocking
            crouching = self.p1_crouching
        else:
            stun = self.p2_stun
            attacking = self.p2_attacking
            attack_timer = self.p2_attack_timer
            vx = self.p2_vx
            vy = self.p2_vy
            blocking = self.p2_blocking
            crouching = self.p2_crouching

        # Can't move if stunned or attacking
        if stun > 0:
            blocking = False
            crouching = False
        elif attack_timer > 0:
            pass # Keep momentum
        else:
            blocking = False
            crouching = False
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
                crouching = True
            elif action == 5: # Block
                vx = 0
                blocking = True
            elif action == 6: # Light Attack
                attacking = 1
                attack_timer = self.LIGHT_ATTACK_DUR
                if player_num == 1: self.p1_has_hit = False
                else: self.p2_has_hit = False
                vx = 0 # Initial stop
            elif action == 7: # Heavy Attack
                attacking = 2
                attack_timer = self.HEAVY_ATTACK_DUR
                if player_num == 1: self.p1_has_hit = False
                else: self.p2_has_hit = False
                vx = 0 # Initial stop
            elif action == 8: # Special
                attacking = 3
                attack_timer = self.SPECIAL_ATTACK_DUR
                if player_num == 1: self.p1_has_hit = False
                else: self.p2_has_hit = False
                vx = 0 # Initial stop
            else: # Idle
                pass # Don't reset vx, let it decay

        if player_num == 1:
            self.p1_vx = vx
            self.p1_stun = max(0, stun - 1)
            self.p1_attacking = attacking if attack_timer > 0 else 0
            self.p1_attack_timer = max(0, attack_timer - 1)
            self.p1_blocking = blocking
            self.p1_crouching = crouching
        else:
            self.p2_vx = vx
            self.p2_stun = max(0, stun - 1)
            self.p2_attacking = attacking if attack_timer > 0 else 0
            self.p2_attack_timer = max(0, attack_timer - 1)
            self.p2_blocking = blocking
            self.p2_crouching = crouching

    def _apply_physics(self, player_num):
        if player_num == 1:
            h = self.CROUCH_HEIGHT if self.p1_crouching else self.PLAYER_HEIGHT
            self.p1_x += self.p1_vx
            self.p1_y += self.p1_vy
            
            # Apply horizontal drag
            self.p1_vx *= self.DRAG
            if abs(self.p1_vx) < 0.1: self.p1_vx = 0
            
            ground_y = self.GROUND_Y - h
            if self.p1_y < ground_y:
                self.p1_vy += self.GRAVITY
            else:
                self.p1_y = ground_y
                self.p1_vy = 0
            # Boundary checks
            self.p1_x = max(0, min(self.WIDTH - self.PLAYER_WIDTH, self.p1_x))
        else:
            h = self.CROUCH_HEIGHT if self.p2_crouching else self.PLAYER_HEIGHT
            self.p2_x += self.p2_vx
            self.p2_y += self.p2_vy
            
            # Apply horizontal drag
            self.p2_vx *= self.DRAG
            if abs(self.p2_vx) < 0.1: self.p2_vx = 0
            
            ground_y = self.GROUND_Y - h
            if self.p2_y < ground_y:
                self.p2_vy += self.GRAVITY
            else:
                self.p2_y = ground_y
                self.p2_vy = 0
            # Boundary checks
            self.p2_x = max(0, min(self.WIDTH - self.PLAYER_WIDTH, self.p2_x))

    def _resolve_combat(self):
        reward = 0
        h_opp_prev = self.p2_health
        h_self_prev = self.p1_health
        
        # Current heights
        p1_h = self.CROUCH_HEIGHT if self.p1_crouching else self.PLAYER_HEIGHT
        p2_h = self.CROUCH_HEIGHT if self.p2_crouching else self.PLAYER_HEIGHT
        
        # Simple hitbox check
        p1_rect = [self.p1_x, self.p1_y, self.PLAYER_WIDTH, p1_h]
        p2_rect = [self.p2_x, self.p2_y, self.PLAYER_WIDTH, p2_h]
        
        def check_collision(r1, r2):
            return r1[0] < r2[0] + r2[2] and r1[0] + r1[2] > r2[0] and \
                   r1[1] < r2[1] + r2[3] and r1[1] + r1[3] > r2[1]

        # P1 Attacks P2
        if self.p1_attacking > 0 and not self.p1_has_hit:
            type_idx = self.p1_attacking
            timer = self.p1_attack_timer
            if type_idx == 1: phases, total_dur = self.LIGHT_PHASES, self.LIGHT_ATTACK_DUR
            elif type_idx == 2: phases, total_dur = self.HEAVY_PHASES, self.HEAVY_ATTACK_DUR
            else: phases, total_dur = self.SPECIAL_PHASES, self.SPECIAL_ATTACK_DUR
            
            elapsed = total_dur - timer
            is_active = elapsed >= phases[0] and elapsed < (phases[0] + phases[1])
            
            if is_active:
                reach = self.ATTACK_REACH
                if type_idx == 2: reach += 20
                if type_idx == 3: reach += 50
                
                p1_attack_rect = p1_rect.copy()
                if self.p1_x < self.p2_x: p1_attack_rect[2] += reach
                else: p1_attack_rect[0] -= reach; p1_attack_rect[2] += reach
                
                if check_collision(p1_attack_rect, p2_rect):
                    if not self.p2_blocking:
                        damage = 1.5
                        stun = self.LIGHT_STUN
                        if type_idx == 2: damage, stun = 4.0, self.HEAVY_STUN
                        elif type_idx == 3: damage, stun = 8.0, self.SPECIAL_STUN
                        
                        self.p2_health -= damage
                        self.p2_stun = stun
                        self.p2_attack_timer = 0
                        self.p2_attacking = 0
                        self.p1_has_hit = True

                        # Knockback
                        direction = 1 if self.p1_x < self.p2_x else -1
                        self.p2_vx = direction * self.KNOCKBACK_VICTIM
                        self.p1_vx = -direction * self.KNOCKBACK_ATTACKER

        # P2 Attacks P1
        if self.p2_attacking > 0 and not self.p2_has_hit:
            type_idx = self.p2_attacking
            timer = self.p2_attack_timer
            if type_idx == 1: phases, total_dur = self.LIGHT_PHASES, self.LIGHT_ATTACK_DUR
            elif type_idx == 2: phases, total_dur = self.HEAVY_PHASES, self.HEAVY_ATTACK_DUR
            else: phases, total_dur = self.SPECIAL_PHASES, self.SPECIAL_ATTACK_DUR
            
            elapsed = total_dur - timer
            is_active = elapsed >= phases[0] and elapsed < (phases[0] + phases[1])
            
            if is_active:
                reach = self.ATTACK_REACH
                if type_idx == 2: reach += 20
                if type_idx == 3: reach += 50
                
                p2_attack_rect = p2_rect.copy()
                if self.p2_x < self.p1_x: p2_attack_rect[2] += reach
                else: p2_attack_rect[0] -= reach; p2_attack_rect[2] += reach
                
                if check_collision(p2_attack_rect, p1_rect):
                    if not self.p1_blocking:
                        damage = 1.5
                        stun = self.LIGHT_STUN
                        if type_idx == 2: damage, stun = 4.0, self.HEAVY_STUN
                        elif type_idx == 3: damage, stun = 8.0, self.SPECIAL_STUN
                        
                        self.p1_health -= damage
                        self.p1_stun = stun
                        self.p1_attack_timer = 0
                        self.p1_attacking = 0
                        self.p2_has_hit = True

                        # Knockback
                        direction = 1 if self.p2_x < self.p1_x else -1
                        self.p1_vx = direction * self.KNOCKBACK_VICTIM
                        self.p2_vx = -direction * self.KNOCKBACK_ATTACKER

        # Reward Function (Design.md Section 3.3)
        # alpha=10, beta=15 (Higher penalty for taking damage)
        damage_dealt = max(0, h_opp_prev - self.p2_health)
        damage_taken = max(0, h_self_prev - self.p1_health)
        
        reward += 10.0 * damage_dealt
        reward -= 15.0 * damage_taken
        
        # Proximity reward to encourage engagement
        dist = abs(self.p1_x - self.p2_x) / self.WIDTH
        reward += 0.01 * (1.0 - dist)
        
        # Corner penalty: Negative reward for being trapped at boundaries
        if self.p1_x < 50 or self.p1_x > self.WIDTH - 100:
            reward -= 0.05
            
        return reward
