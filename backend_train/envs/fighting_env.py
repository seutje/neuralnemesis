import gymnasium as gym
from gymnasium import spaces
import numpy as np

class FightingGameEnv(gym.Env):
    metadata = {"render_modes": ["human"], "render_fps": 60}

    def __init__(self):
        super(FightingGameEnv, self).__init__()

        # Action Space: 0: Idle, 1: Left, 2: Right, 3: Jump, 4: Crouch, 5: Block, 6: Light_Attack, 7: Heavy_Attack, 8: Special
        self.action_space = spaces.Discrete(9)

        # Observation Space (16 features)
        self.observation_space = spaces.Box(low=-2.0, high=2.0, shape=(16,), dtype=np.float32)

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
        self.MAX_STEPS = 800 # Short episodes for faster feedback
        
        # Frame data
        self.LIGHT_ATTACK_DUR = 22
        self.HEAVY_ATTACK_DUR = 38
        self.SPECIAL_ATTACK_DUR = 60
        
        self.LIGHT_PHASES = [4, 6, 12]
        self.HEAVY_PHASES = [10, 8, 20]
        self.SPECIAL_PHASES = [15, 10, 35]
        
        self.LIGHT_STUN = 18
        self.HEAVY_STUN = 35
        self.SPECIAL_STUN = 55

        self.STUN_DURATION = 20
        self.ATTACK_REACH = 90
        self.KNOCKBACK_VICTIM = 10.0
        self.KNOCKBACK_ATTACKER = 5.0
        self.DRAG = 0.8
        
        self.reset()

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.current_step = 0
        
        # Bot Personality: 0: Aggressive, 1: Defensive, 2: Random, 3: Passive (Wait)
        # 50% chance of Passive to encourage AI to initiate
        self.p2_personality = self.np_random.choice([0, 1, 2, 3], p=[0.3, 0.1, 0.1, 0.5])
        self.p2_action_timer = 0
        self.p2_current_action = 0
        
        # Randomize starting positions
        side = self.np_random.choice([0, 1])
        if side == 0:
            self.p1_x, self.p2_x = 150, 650
        else:
            self.p1_x, self.p2_x = 650, 150

        self.p1_y = self.p2_y = self.GROUND_Y - self.PLAYER_HEIGHT
        self.p1_vx = self.p1_vy = self.p2_vx = self.p2_vy = 0
        self.p1_health = self.p2_health = self.MAX_HEALTH
        self.p1_stun = self.p2_stun = 0
        self.p1_attacking = self.p2_attacking = 0
        self.p1_attack_timer = self.p2_attack_timer = 0
        self.p1_has_hit = self.p2_has_hit = False
        self.p1_blocking = self.p1_crouching = self.p2_blocking = self.p2_crouching = False
        
        self.prev_dist = abs(self.p1_x - self.p2_x) / self.WIDTH
        
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
        self._apply_action(1, action)
        
        if self.p2_action_timer <= 0:
            if self.p2_personality == 0: # Aggressive
                if self.p2_x > self.p1_x + 70: self.p2_current_action = 1
                elif self.p2_x < self.p1_x - 70: self.p2_current_action = 2
                else: self.p2_current_action = self.np_random.choice([5, 6, 7, 8])
            elif self.p2_personality == 1: # Defensive
                self.p2_current_action = 2 if self.p2_x < self.p1_x else 1
            elif self.p2_personality == 3: self.p2_current_action = 0
            else: self.p2_current_action = self.action_space.sample()
            self.p2_action_timer = self.np_random.integers(10, 30)
        else: self.p2_action_timer -= 1
            
        self._apply_action(2, self.p2_current_action)
        self._apply_physics(1)
        self._apply_physics(2)
        
        reward = self._resolve_combat()
        
        # Delta-Distance Reward: Reward for getting closer
        curr_dist = abs(self.p1_x - self.p2_x) / self.WIDTH
        reward += (self.prev_dist - curr_dist) * 10.0 
        self.prev_dist = curr_dist

        # Efficiency penalty
        reward -= 0.01

        self.current_step += 1
        terminated = False
        if self.p1_health <= 0 or self.p2_health <= 0:
            terminated = True
            if self.p2_health <= 0: reward += 100.0 
            elif self.p1_health <= 0: reward -= 50.0 
        
        truncated = self.current_step >= self.MAX_STEPS
        return self._get_obs(), reward, terminated, truncated, {}

    def _apply_action(self, player_num, action):
        if player_num == 1:
            stun, atk, tmr = self.p1_stun, self.p1_attacking, self.p1_attack_timer
            vx, vy, blk, crch = self.p1_vx, self.p1_vy, self.p1_blocking, self.p1_crouching
        else:
            stun, atk, tmr = self.p2_stun, self.p2_attacking, self.p2_attack_timer
            vx, vy, blk, crch = self.p2_vx, self.p2_vy, self.p2_blocking, self.p2_crouching

        if stun > 0: blk = crch = False
        elif tmr > 0: pass 
        else:
            blk = crch = False
            if action == 1: vx = -self.WALK_SPEED
            elif action == 2: vx = self.WALK_SPEED
            elif action == 3:
                y = self.p1_y if player_num == 1 else self.p2_y
                if y >= self.GROUND_Y - self.PLAYER_HEIGHT:
                    if player_num == 1: self.p1_vy = self.JUMP_FORCE
                    else: self.p2_vy = self.JUMP_FORCE
            elif action == 4: vx = 0; crch = True
            elif action == 5: vx = 0; blk = True
            elif action == 6: atk = 1; tmr = self.LIGHT_ATTACK_DUR; vx = 0
            elif action == 7: atk = 2; tmr = self.HEAVY_ATTACK_DUR; vx = 0
            elif action == 8: atk = 3; tmr = self.SPECIAL_ATTACK_DUR; vx = 0

        if player_num == 1:
            self.p1_vx, self.p1_stun = vx, max(0, stun - 1)
            self.p1_attacking = atk if tmr > 0 else 0
            self.p1_attack_timer = max(0, tmr - 1)
            self.p1_blocking, self.p1_crouching = blk, crch
        else:
            self.p2_vx, self.p2_stun = vx, max(0, stun - 1)
            self.p2_attacking = atk if tmr > 0 else 0
            self.p2_attack_timer = max(0, tmr - 1)
            self.p2_blocking, self.p2_crouching = blk, crch

    def _apply_physics(self, player_num):
        if player_num == 1:
            h = self.CROUCH_HEIGHT if self.p1_crouching else self.PLAYER_HEIGHT
            self.p1_x += self.p1_vx; self.p1_y += self.p1_vy; self.p1_vx *= self.DRAG
            gy = self.GROUND_Y - h
            if self.p1_y < gy: self.p1_vy += self.GRAVITY
            else: self.p1_y, self.p1_vy = gy, 0
            self.p1_x = max(0, min(self.WIDTH - self.PLAYER_WIDTH, self.p1_x))
        else:
            h = self.CROUCH_HEIGHT if self.p2_crouching else self.PLAYER_HEIGHT
            self.p2_x += self.p2_vx; self.p2_y += self.p2_vy; self.p2_vx *= self.DRAG
            gy = self.GROUND_Y - h
            if self.p2_y < gy: self.p2_vy += self.GRAVITY
            else: self.p2_y, self.p2_vy = gy, 0
            self.p2_x = max(0, min(self.WIDTH - self.PLAYER_WIDTH, self.p2_x))

    def _resolve_combat(self):
        reward = 0
        h_opp_prev, h_self_prev = self.p2_health, self.p1_health
        p1_h = self.CROUCH_HEIGHT if self.p1_crouching else self.PLAYER_HEIGHT
        p2_h = self.CROUCH_HEIGHT if self.p2_crouching else self.PLAYER_HEIGHT
        p1_rect = [self.p1_x, self.p1_y, self.PLAYER_WIDTH, p1_h]
        p2_rect = [self.p2_x, self.p2_y, self.PLAYER_WIDTH, p2_h]
        
        def check_collision(r1, r2):
            return r1[0] < r2[0] + r2[2] and r1[0] + r1[2] > r2[0] and \
                   r1[1] < r2[1] + r2[3] and r1[1] + r1[3] > r2[1]

        for p in [1, 2]:
            atk = self.p1_attacking if p == 1 else self.p2_attacking
            tmr = self.p1_attack_timer if p == 1 else self.p2_attack_timer
            hit = self.p1_has_hit if p == 1 else self.p2_has_hit
            if atk > 0 and not hit:
                if atk == 1: ph, dur = self.LIGHT_PHASES, self.LIGHT_ATTACK_DUR
                elif atk == 2: ph, dur = self.HEAVY_PHASES, self.HEAVY_ATTACK_DUR
                else: ph, dur = self.SPECIAL_PHASES, self.SPECIAL_ATTACK_DUR
                elapsed = dur - tmr
                if elapsed >= ph[0] and elapsed < (ph[0] + ph[1]):
                    reach = self.ATTACK_REACH + (20 if atk == 2 else 50 if atk == 3 else 0)
                    rect = (p1_rect if p == 1 else p2_rect).copy()
                    if (p == 1 and self.p1_x < self.p2_x) or (p == 2 and self.p2_x < self.p1_x): rect[2] += reach
                    else: rect[0] -= reach; rect[2] += reach
                    if check_collision(rect, p2_rect if p == 1 else p1_rect):
                        if not (self.p2_blocking if p == 1 else self.p1_blocking):
                            dmg = 3.0 if atk == 1 else 7.0 if atk == 2 else 12.0
                            stun = self.LIGHT_STUN if atk == 1 else self.HEAVY_STUN if atk == 2 else self.SPECIAL_STUN
                            if p == 1: self.p2_health -= dmg; self.p2_stun = stun; self.p2_attack_timer = self.p2_attacking = 0; self.p1_has_hit = True
                            else: self.p1_health -= dmg; self.p1_stun = stun; self.p1_attack_timer = self.p1_attacking = 0; self.p2_has_hit = True
                            dir = 1 if (p == 1 and self.p1_x < self.p2_x) or (p == 2 and self.p2_x < self.p1_x) else -1
                            if p == 1: self.p2_vx, self.p1_vx = dir * self.KNOCKBACK_VICTIM, -dir * self.KNOCKBACK_ATTACKER
                            else: self.p1_vx, self.p2_vx = dir * self.KNOCKBACK_VICTIM, -dir * self.KNOCKBACK_ATTACKER

        # Combat Reward Scaling (Aggressive 3:1)
        dmg_dealt, dmg_taken = max(0, h_opp_prev - self.p2_health), max(0, h_self_prev - self.p1_health)
        reward += 40.0 * dmg_dealt - 10.0 * dmg_taken
            
        return reward
