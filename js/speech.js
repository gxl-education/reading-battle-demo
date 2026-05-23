// ============================================================
// 语音 API 封装
// ------------------------------------------------------------
// 1. SpeechRecognition 用于听孩子朗读
//    国内常见报错：network（连不上 Google 服务器）
// 2. speechSynthesis 用于"听标准朗读"（跟读模式）
// ============================================================

const SR =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export function isRecognitionSupported() {
  return !!SR;
}

export function getCapabilities() {
  const parts = [];
  parts.push('语音识别: ' + (isRecognitionSupported() ? '✓' : '✗（请用 Chrome）'));
  parts.push('语音合成: ' + (window.speechSynthesis ? '✓' : '✗'));
  parts.push('UA: ' + navigator.userAgent.slice(0, 60) + '...');
  return parts.join(' | ');
}

/**
 * 启动一次识别
 * @param {object} opts
 *   - onResult({ text, isFinal })
 *   - onError({ code, message })
 *   - onEnd()
 *   - lang 默认 'zh-CN'
 * @returns 一个 { stop() } 句柄
 */
export function startRecognition({ onResult, onError, onEnd, lang = 'zh-CN' } = {}) {
  if (!SR) {
    onError && onError({ code: 'unsupported', message: '此浏览器不支持语音识别，请用 Chrome 或选「手动确认」' });
    onEnd && onEnd();
    return { stop() {} };
  }

  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let lastText = '';
  let stopped = false;

  rec.onresult = (event) => {
    let txt = '';
    let isFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      txt += r[0].transcript;
      if (r.isFinal) isFinal = true;
    }
    lastText = txt;
    onResult && onResult({ text: txt, isFinal });
  };

  rec.onerror = (e) => {
    if (stopped) return;
    let msg = e.error || '识别失败';
    if (msg === 'network') {
      msg = '联网失败：Chrome 语音识别需访问 Google 服务器，国内常无法连通。请改用「手动确认」。';
    } else if (msg === 'not-allowed' || msg === 'service-not-allowed') {
      msg = '麦克风权限被拒绝，请在浏览器地址栏允许麦克风权限。';
    } else if (msg === 'no-speech') {
      msg = '没听到你说话，再试一次～';
    } else if (msg === 'audio-capture') {
      msg = '找不到麦克风设备。';
    }
    onError && onError({ code: e.error, message: msg, lastText });
  };

  rec.onend = () => {
    onEnd && onEnd({ lastText });
  };

  try {
    rec.start();
  } catch (err) {
    onError && onError({ code: 'start-failed', message: '启动失败：' + err.message });
    onEnd && onEnd();
    return { stop() {} };
  }

  return {
    stop() {
      stopped = true;
      try { rec.stop(); } catch (_) {}
    }
  };
}

/**
 * 让浏览器朗读一句中文
 */
export function speak(text, { rate = 0.85, pitch = 1.05 } = {}) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = rate;
  u.pitch = pitch;
  // 找一个中文嗓音
  const voices = window.speechSynthesis.getVoices();
  const zh = voices.find((v) => /zh|chinese/i.test(v.lang) || /chinese/i.test(v.name));
  if (zh) u.voice = zh;
  window.speechSynthesis.speak(u);
}
