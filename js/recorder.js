// ============================================================
// 学习数据收集
// ------------------------------------------------------------
// 记录什么：
//   - 每次朗读尝试（句子、识别结果、是否通过、错字数）
//   - 每个字单独的错字次数（用于"哪些字最容易读错"统计）
//   - 每个课文的练习次数和正确率
//
// 存哪里：
//   - 现在：localStorage（key = 'reading-battle-v1'）
//   - 以后：调用 flushToServer() 把累计数据 POST 到后端
//
// 数据结构（version 1）：
// {
//   v: 1,
//   sessionStart: 时间戳,
//   attempts: [{ ts, lessonId, sentence, heard, pass, score, missedChars }],
//   charStats: { '字': { wrong: N, total: N } },
//   lessonStats: { 'lesson-id': { attempts: N, passes: N } }
// }
// ============================================================

const STORAGE_KEY = 'reading-battle-v1';
const VERSION = 1;
const MAX_ATTEMPTS_KEEP = 500; // 最多保留多少条原始记录，防止 localStorage 爆掉

function emptyData() {
  return {
    v: VERSION,
    sessionStart: Date.now(),
    attempts: [],
    charStats: {},
    lessonStats: {}
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw);
    if (parsed.v !== VERSION) return emptyData(); // 版本不匹配丢弃旧数据
    return parsed;
  } catch (e) {
    console.warn('[recorder] load failed:', e);
    return emptyData();
  }
}

function save(data) {
  try {
    // 控制大小
    if (data.attempts.length > MAX_ATTEMPTS_KEEP) {
      data.attempts = data.attempts.slice(-MAX_ATTEMPTS_KEEP);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[recorder] save failed:', e);
  }
}

let memory = load();

/**
 * 记录一次朗读尝试
 * @param {object} payload
 *   - lessonId: 课文 id
 *   - sentence: 课文原句
 *   - heard:    识别到的文本（手动模式可传 '__manual__'）
 *   - pass:     是否通过
 *   - score:    评分 0-100
 *   - missedChars: string[]  没读对的字（去重后）
 */
export function recordAttempt({ lessonId, sentence, heard, pass, score, missedChars = [] }) {
  const ts = Date.now();
  memory.attempts.push({ ts, lessonId, sentence, heard, pass, score, missedChars });

  // 累加每个字的统计
  // 这里把"出现过的字"算到 total，"没读对的字"算到 wrong
  // 中文字符按 unicode 切分（Array.from 能正确处理 surrogate pair）
  const seen = new Set(Array.from(sentence).filter((c) => /[\u4e00-\u9fff]/.test(c)));
  seen.forEach((ch) => {
    if (!memory.charStats[ch]) memory.charStats[ch] = { wrong: 0, total: 0 };
    memory.charStats[ch].total += 1;
  });
  missedChars.forEach((ch) => {
    if (!/[\u4e00-\u9fff]/.test(ch)) return;
    if (!memory.charStats[ch]) memory.charStats[ch] = { wrong: 0, total: 0 };
    memory.charStats[ch].wrong += 1;
  });

  // 课文统计
  if (!memory.lessonStats[lessonId]) memory.lessonStats[lessonId] = { attempts: 0, passes: 0 };
  memory.lessonStats[lessonId].attempts += 1;
  if (pass) memory.lessonStats[lessonId].passes += 1;

  save(memory);
}

/** 拿到全部统计 */
export function getStats() {
  // 返回深拷贝，避免外部改坏内部状态
  return JSON.parse(JSON.stringify(memory));
}

/** 错字 Top N（按出错次数排序） */
export function getTopMissedChars(n = 10) {
  return Object.entries(memory.charStats)
    .filter(([, v]) => v.wrong > 0)
    .sort((a, b) => b[1].wrong - a[1].wrong)
    .slice(0, n)
    .map(([ch, v]) => ({
      char: ch,
      wrong: v.wrong,
      total: v.total,
      errorRate: v.total > 0 ? v.wrong / v.total : 0
    }));
}

/** 每个课文的正确率 */
export function getLessonStats() {
  return Object.entries(memory.lessonStats).map(([id, v]) => ({
    lessonId: id,
    attempts: v.attempts,
    passes: v.passes,
    rate: v.attempts > 0 ? v.passes / v.attempts : 0
  }));
}

/** 最近 N 天每天的练习句数 */
export function getDailyActivity(days = 7) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = now - (i + 1) * dayMs + dayMs;
    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = dayStart.getTime() + dayMs;
    const date = new Date(dayStart);
    const label = `${date.getMonth() + 1}/${date.getDate()}`;
    const count = memory.attempts.filter(
      (a) => a.ts >= dayStart.getTime() && a.ts < dayEnd
    ).length;
    buckets.push({ label, count });
  }
  return buckets;
}

/** 总体概览 */
export function getOverview() {
  const total = memory.attempts.length;
  const passes = memory.attempts.filter((a) => a.pass).length;
  const uniqueWrongChars = Object.values(memory.charStats).filter((s) => s.wrong > 0).length;
  return {
    totalAttempts: total,
    passes,
    passRate: total > 0 ? passes / total : 0,
    uniqueWrongChars,
    sessionStart: memory.sessionStart
  };
}

/** 清空所有学习数据（带二次确认建议在调用方做） */
export function clearAll() {
  memory = emptyData();
  save(memory);
}

/** 导出 JSON 供下载 */
export function exportJSON() {
  return JSON.stringify(memory, null, 2);
}

// ----------------- 后端 API 预留 -----------------
// 用法（以后接入时）：
//   import { setBackend, flushToServer } from './recorder.js';
//   setBackend({ url: 'https://api.example.com/reading-battle', userId: 'kid-001' });
//   // 之后定时或在合适时机调用：
//   await flushToServer();
let backendConfig = null;

export function setBackend(cfg) {
  // cfg: { url: string, userId?: string, headers?: object }
  backendConfig = cfg;
}

/**
 * 把累计数据 POST 到后端
 * 注意：现在只是预留，后端不存在时会静默失败
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function flushToServer() {
  if (!backendConfig) {
    return { ok: false, error: 'no backend configured' };
  }
  try {
    const res = await fetch(backendConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(backendConfig.headers || {})
      },
      body: JSON.stringify({
        userId: backendConfig.userId || 'anonymous',
        clientTs: Date.now(),
        data: memory
      })
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
