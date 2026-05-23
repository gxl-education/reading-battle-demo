// ============================================================
// 朗读评测（升级版）
// ------------------------------------------------------------
// 提供 3 个能力：
//   1. evaluate()        最终评测：pass / 分数 / 提示
//   2. matchPartial()    实时评测：返回 target 里哪些位置已经匹配
//                        用于"卡拉 OK"高亮
//   3. extractMissed()   提取没读对的字，给 recorder 用
// ============================================================

const PUNCT_REGEX = /[\s,.!?;:'"，。！？；：、""''（）()《》<>·…—\-]/g;

const HOMOPHONES = {
  '的': ['得', '地'],
  '在': ['再'],
  '做': ['作'],
  '他': ['她', '它'],
  '那': ['哪'],
  '已经': ['以经'],
  '声音': ['生音']
};

function normalize(text) {
  if (!text) return '';
  return text.replace(PUNCT_REGEX, '').toLowerCase();
}

function charsEqual(a, b, lenient) {
  if (a === b) return true;
  if (!lenient) return false;
  const alts = HOMOPHONES[a];
  if (alts && alts.includes(b)) return true;
  const altsB = HOMOPHONES[b];
  if (altsB && altsB.includes(a)) return true;
  return false;
}

// 朴素 LCS，返回长度
function lcsLength(a, b, lenient) {
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (charsEqual(a[i - 1], b[j - 1], lenient)) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[n];
}

// LCS 回溯，返回 target 里"被命中"的位置集合（按原 target 索引，含标点位置偏移修正）
function lcsMatchedTargetIndices(heard, target, lenient) {
  // 先做 normalize 但记下每个 normalize 后字符对应的原 target 索引
  const targetMap = []; // 每个 normalize 后字符 -> 原 target 中的位置
  let normTarget = '';
  for (let i = 0; i < target.length; i++) {
    const ch = target[i];
    if (!PUNCT_REGEX.test(ch)) {
      normTarget += ch.toLowerCase();
      targetMap.push(i);
    }
  }
  const normHeard = normalize(heard);
  const m = normHeard.length, n = normTarget.length;
  if (m === 0 || n === 0) return new Set();

  // 标准 LCS DP，再回溯
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (charsEqual(normHeard[i - 1], normTarget[j - 1], lenient)) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯找出哪些 target 位置参与了 LCS
  // 当 dp[i-1][j] == dp[i][j-1] 时优先走 i-- 而不是 j--
  // 这样匹配会更倾向于发生在 target 的前段（孩子从前往后读时更自然）
  const matched = new Set();
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (charsEqual(normHeard[i - 1], normTarget[j - 1], lenient)) {
      matched.add(targetMap[j - 1]); // 转回原 target 的索引
      i--; j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return matched;
}

/**
 * 实时部分评测（用于卡拉 OK 高亮）
 * 用"贪婪从前匹配"而不是 LCS：孩子从前往后读，前面的字应该先亮。
 * 容忍偶尔识别错一两个字（小窗口跳过）。
 *
 * @param {string} heard   当前已识别到的（可能不完整）
 * @param {string} target  目标句子（原句，带标点）
 * @param {string} mode    lenient/strict
 * @returns {{ matched: number[], progress: number }}
 */
export function matchPartial(heard, target, mode = 'lenient') {
  const lenient = mode === 'lenient';

  // 建立 normalize 后位置 -> 原 target 索引的映射
  const targetMap = [];
  let normTarget = '';
  for (let i = 0; i < target.length; i++) {
    if (!PUNCT_REGEX.test(target[i])) {
      normTarget += target[i].toLowerCase();
      targetMap.push(i);
    }
  }
  const normHeard = normalize(heard);

  const matched = [];
  let ti = 0; // target 指针
  const SKIP_WINDOW = lenient ? 2 : 1; // 允许识别多/漏几个字
  for (let hi = 0; hi < normHeard.length && ti < normTarget.length; hi++) {
    const hc = normHeard[hi];
    // 在 target 当前位置附近的小窗口里找匹配
    let found = -1;
    for (let k = 0; k <= SKIP_WINDOW && ti + k < normTarget.length; k++) {
      if (charsEqual(hc, normTarget[ti + k], lenient)) {
        found = ti + k;
        break;
      }
    }
    if (found >= 0) {
      matched.push(targetMap[found]);
      ti = found + 1;
    }
    // 没找到就跳过这个 heard 字符（识别错字 / 多读字）
  }

  return {
    matched,
    progress: normTarget.length > 0 ? matched.length / normTarget.length : 0
  };
}

/**
 * 最终评测
 */
export function evaluate(heard, target, mode = 'lenient') {
  const h = normalize(heard);
  const t = normalize(target);

  if (t.length === 0) return { pass: true, score: 100, hint: '空句子', missedChars: [] };
  if (h.length === 0) return { pass: false, score: 0, hint: '没听到你读，再试一次～', missedChars: extractMissed('', target) };

  if (h.length < t.length * 0.4) {
    return {
      pass: false,
      score: Math.round((h.length / t.length) * 100),
      hint: '好像只读了一半，完整地再读一遍吧',
      missedChars: extractMissed(heard, target)
    };
  }

  const lenient = mode === 'lenient';
  const matched = lcsLength(h, t, lenient);
  const score = Math.round((matched / t.length) * 100);
  const missing = t.length - matched;

  const threshold = lenient ? 55 : 82;
  let pass = score >= threshold;
  if (!lenient && missing > 1) pass = false;

  let hint;
  if (pass) {
    if (score >= 95) hint = '太棒了，几乎完美！';
    else if (score >= 80) hint = '读得很好！';
    else hint = '不错，过关啦～';
  } else {
    if (score >= 40) hint = '差一点点，再读一次！';
    else if (score >= 20) hint = '慢一点，看清每个字～';
    else hint = '别紧张，跟着字一个一个读';
  }

  return {
    pass,
    score,
    hint,
    missedChars: extractMissed(heard, target, mode)
  };
}

/**
 * 提取"没读对的字"（target 里没被 LCS 命中的中文字符，去重）
 */
export function extractMissed(heard, target, mode = 'lenient') {
  const lenient = mode === 'lenient';
  const matchedSet = lcsMatchedTargetIndices(heard, target, lenient);
  const missed = new Set();
  for (let i = 0; i < target.length; i++) {
    const ch = target[i];
    // 只统计中文字符
    if (!/[\u4e00-\u9fff]/.test(ch)) continue;
    if (!matchedSet.has(i)) missed.add(ch);
  }
  return [...missed];
}

export function manualPass() {
  return { pass: true, score: 100, hint: '加油，继续！', missedChars: [] };
}
