// ============================================================
// 对战状态机
// ------------------------------------------------------------
// 规则：
//   - 读对一句 +1 能量；连对 3 句额外 +1
//   - 同一句错 2 次 → 怪兽反击，玩家 -1 心
//   - 能量满 5 → 可攻击
//   - 攻击 → 怪兽 -1 血 + 能量清零
//   - 玩家 0 心 = 输；怪兽 0 血 = 赢
// ============================================================

const ENERGY_MAX = 5;
const PLAYER_HEARTS = 3;
const ENERGY_PER_HIT = 1;
const STREAK_BONUS_AT = 3;       // 连对 3 次给额外能量
const FAILS_PER_RETALIATION = 2; // 同句错几次怪兽反击

export class Game {
  constructor(lesson) {
    this.lesson = lesson;
    this.sentences = lesson.sentences;
    this.idx = 0;
    this.energy = 0;
    this.hearts = PLAYER_HEARTS;
    this.monsterHpMax = Math.max(1, Math.ceil(this.sentences.length / 2));
    this.monsterHp = this.monsterHpMax;
    this.streak = 0;
    this.failsOnCurrent = 0;
    this.canAttack = false;
    this.finished = false;
    this.outcome = null; // 'win' | 'lose'
  }

  get currentSentence() {
    return this.sentences[this.idx] || '';
  }

  get progressText() {
    return `第 ${Math.min(this.idx + 1, this.sentences.length)} / ${this.sentences.length} 句`;
  }

  /**
   * 处理一次朗读结果
   * @returns {object} 事件描述，给 UI 用
   */
  onRead(pass) {
    if (this.finished) return { type: 'noop' };

    if (pass) {
      this.streak += 1;
      let gain = ENERGY_PER_HIT;
      let bonus = false;
      if (this.streak > 0 && this.streak % STREAK_BONUS_AT === 0) {
        gain += 1;
        bonus = true;
      }
      this.energy = Math.min(ENERGY_MAX, this.energy + gain);
      this.failsOnCurrent = 0;
      this.advanceSentence();
      this.canAttack = this.energy >= ENERGY_MAX;

      return {
        type: 'correct',
        energyGain: gain,
        streakBonus: bonus,
        canAttack: this.canAttack,
        streak: this.streak
      };
    }

    // 读错
    this.streak = 0;
    this.failsOnCurrent += 1;
    if (this.failsOnCurrent >= FAILS_PER_RETALIATION) {
      this.failsOnCurrent = 0;
      this.hearts -= 1;
      const lost = this.hearts <= 0;
      if (lost) {
        this.finished = true;
        this.outcome = 'lose';
      }
      // 反击后换下一句，避免一直卡同一句
      this.advanceSentence();
      return {
        type: 'retaliate',
        heartsLeft: this.hearts,
        gameOver: lost
      };
    }
    return {
      type: 'wrong',
      failsOnCurrent: this.failsOnCurrent,
      failsToRetaliate: FAILS_PER_RETALIATION - this.failsOnCurrent
    };
  }

  advanceSentence() {
    this.idx += 1;
    // 课文读完了循环回开头，让对战继续
    if (this.idx >= this.sentences.length) {
      this.idx = 0;
    }
  }

  attack() {
    if (this.finished || !this.canAttack) return { type: 'noop' };
    this.monsterHp -= 1;
    this.energy = 0;
    this.canAttack = false;
    const won = this.monsterHp <= 0;
    if (won) {
      this.finished = true;
      this.outcome = 'win';
    }
    return { type: 'attack', monsterHp: Math.max(0, this.monsterHp), won };
  }

  forceEnergyFull() {
    this.energy = ENERGY_MAX;
    this.canAttack = true;
  }
}

export const CONFIG = {
  ENERGY_MAX,
  PLAYER_HEARTS
};
