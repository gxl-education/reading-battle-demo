// ============================================================
// 主入口（升级版）
// ------------------------------------------------------------
// 新增：
//   - 卡拉 OK 高亮（语音识别 interim 结果驱动）
//   - 学习报告页
//   - 错字数据收集（recorder）
//   - 读对触发 3D onCorrect / setEnergyFull
// ============================================================

import { LESSONS, getMonsterTheme } from './data.js';
import { evaluate, matchPartial, manualPass, extractMissed } from './matcher.js';
import { Game, CONFIG } from './game.js';
import {
  startRecognition,
  isRecognitionSupported,
  getCapabilities,
  speak
} from './speech.js';
import * as Scene from './scene3d.js';
import {
  recordAttempt,
  getOverview,
  getTopMissedChars,
  getLessonStats,
  getDailyActivity,
  clearAll,
  exportJSON,
  setBackend
} from './recorder.js';

const $ = (id) => document.getElementById(id);

const screens = {
  home: $('screen-home'),
  battle: $('screen-battle'),
  end: $('screen-end'),
  report: $('screen-report')
};

const lessonSelect = $('lesson-select');
const btnStart = $('btn-start');
const btnReport = $('btn-report');

const lessonTitle = $('lesson-title');
const settingsTag = $('battle-settings-tag');
const sentenceProgress = $('sentence-progress');
const sentenceContainer = $('sentence-text');
const karaokeBar = $('karaoke-bar');
const feedback = $('feedback');
const readStatus = $('read-status');
const debugTranscript = $('debug-transcript');

const energyBar = $('energy-bar');
const energyLabel = $('energy-label');
const playerHearts = $('player-hearts');
const monsterHpRow = $('monster-hp');
const monsterName = $('monster-name');

const followBanner = $('follow-banner');
const btnListen = $('btn-listen');

const panelRead = $('panel-read');
const btnRead = $('btn-read');
const btnManualOk = $('btn-manual-ok');
const btnManualFail = $('btn-manual-fail');

const panelAttack = $('panel-attack');
const btnAttack = $('btn-attack');

const demoCorrect = $('demo-correct');
const demoWrong = $('demo-wrong');
const btnSkipAttack = $('btn-skip-attack');
const browserCapabilities = $('browser-capabilities');

const endEmoji = $('end-emoji');
const endTitle = $('end-title');
const endMessage = $('end-message');
const btnRetry = $('btn-retry');

const battleCanvas = $('battle-canvas');

let settings = {
  lessonId: LESSONS[0].id,
  difficulty: 'lenient',
  follow: false,
  inputMode: 'mic'
};

let game = null;
let recognitionHandle = null;
let isListening = false;
let sentenceCharSpans = []; // 当前句子每个字的 span 引用

function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    if (el) el.classList.toggle('active', k === name);
  });
}

function buildLessonOptions() {
  lessonSelect.innerHTML = '';
  LESSONS.forEach((l) => {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = `${l.title}（${l.grade}）`;
    lessonSelect.appendChild(opt);
  });
}

function readSettingsFromForm() {
  settings.lessonId = lessonSelect.value;
  settings.difficulty = document.querySelector('input[name="difficulty"]:checked')?.value || 'lenient';
  settings.follow = $('opt-follow').checked;
  settings.inputMode = document.querySelector('input[name="input-mode"]:checked')?.value || 'mic';
  if (settings.inputMode === 'mic' && !isRecognitionSupported()) {
    settings.inputMode = 'manual';
  }
}

// ----------------- 卡拉 OK 句子渲染 -----------------
function renderSentenceKaraoke() {
  const sentence = game.currentSentence;
  sentenceContainer.innerHTML = '';
  sentenceCharSpans = [];
  for (let i = 0; i < sentence.length; i++) {
    const ch = sentence[i];
    const span = document.createElement('span');
    span.className = 'kch';
    span.textContent = ch;
    span.dataset.idx = String(i);
    sentenceContainer.appendChild(span);
    sentenceCharSpans.push(span);
  }
  // 重置高亮条
  if (karaokeBar) {
    karaokeBar.style.width = '0%';
    karaokeBar.style.opacity = '0';
  }
}

function updateKaraokeHighlight(matchedIndices) {
  if (!sentenceCharSpans.length) return;
  // 清空所有 .matched
  sentenceCharSpans.forEach((s) => s.classList.remove('matched'));
  matchedIndices.forEach((idx) => {
    if (sentenceCharSpans[idx]) sentenceCharSpans[idx].classList.add('matched');
  });
  // 高亮条：取已匹配的最大索引 → 进度
  if (karaokeBar) {
    if (matchedIndices.length === 0) {
      karaokeBar.style.width = '0%';
      karaokeBar.style.opacity = '0';
    } else {
      const maxIdx = Math.max(...matchedIndices);
      const pct = ((maxIdx + 1) / sentenceCharSpans.length) * 100;
      karaokeBar.style.width = pct + '%';
      karaokeBar.style.opacity = '0.95';
    }
  }
}

function renderEnergy() {
  const pct = (game.energy / CONFIG.ENERGY_MAX) * 100;
  energyBar.style.width = pct + '%';
  energyLabel.textContent = `${game.energy} / ${CONFIG.ENERGY_MAX}`;
  const full = game.energy >= CONFIG.ENERGY_MAX;
  energyBar.classList.toggle('full', full);
  Scene.setEnergyFull(full);
}

function renderHearts() {
  playerHearts.innerHTML = '';
  for (let i = 0; i < CONFIG.PLAYER_HEARTS; i++) {
    const span = document.createElement('span');
    span.className = 'heart';
    span.textContent = i < game.hearts ? '❤️' : '🤍';
    playerHearts.appendChild(span);
  }
}

function renderMonsterHp() {
  monsterHpRow.innerHTML = '';
  for (let i = 0; i < game.monsterHpMax; i++) {
    const span = document.createElement('span');
    span.className = 'heart hp';
    span.textContent = i < game.monsterHp ? '💢' : '·';
    monsterHpRow.appendChild(span);
  }
}

function renderSentence() {
  renderSentenceKaraoke();
  sentenceProgress.textContent = game.progressText;
}

function setFeedback(msg, kind = 'info') {
  feedback.textContent = msg;
  feedback.className = 'feedback ' + kind;
}

function setReadStatus(msg) {
  readStatus.textContent = msg || '';
}

function showAttackPanel(show) {
  panelAttack.classList.toggle('hidden', !show);
  panelRead.classList.toggle('hidden', show);
  btnAttack.disabled = !show;
}

function applyInputModeUI() {
  if (settings.inputMode === 'manual') {
    btnRead.classList.add('hidden');
    btnManualOk.classList.remove('hidden');
    btnManualFail.classList.remove('hidden');
  } else {
    btnRead.classList.remove('hidden');
    btnManualOk.classList.add('hidden');
    btnManualFail.classList.add('hidden');
  }
}

function updateAllHud() {
  renderEnergy(); renderHearts(); renderMonsterHp(); renderSentence();
}

// ----------------- 启动对战 -----------------
function startBattle() {
  readSettingsFromForm();
  const lesson = LESSONS.find((l) => l.id === settings.lessonId) || LESSONS[0];
  game = new Game(lesson);

  lessonTitle.textContent = lesson.title;
  monsterName.textContent = lesson.monster;
  const tags = [
    settings.difficulty === 'strict' ? '严格' : '宽松',
    settings.follow ? '跟读' : null,
    settings.inputMode === 'manual' ? '手动' : '麦克风'
  ].filter(Boolean).join(' · ');
  settingsTag.textContent = tags;

  followBanner.classList.toggle('hidden', !settings.follow);
  applyInputModeUI();
  showAttackPanel(false);
  setFeedback('准备好，开始朗读吧！', 'info');
  setReadStatus('');
  debugTranscript.textContent = '';
  browserCapabilities.textContent = getCapabilities();

  updateAllHud();
  showScreen('battle');

  Scene.dispose();
  setTimeout(() => {
    Scene.init(battleCanvas, { monsterTheme: getMonsterTheme(lesson.monster) });
  }, 50);
}

// ----------------- 朗读结果处理 -----------------
async function handleReadResult(heard) {
  const target = game.currentSentence;
  const result = settings.inputMode === 'manual'
    ? manualPass()
    : evaluate(heard, target, settings.difficulty);

  // 记录到 recorder
  const missedChars = settings.inputMode === 'manual'
    ? []
    : (result.missedChars || extractMissed(heard, target, settings.difficulty));
  recordAttempt({
    lessonId: game.lesson.id,
    sentence: target,
    heard: settings.inputMode === 'manual' ? '__manual__' : heard,
    pass: result.pass,
    score: result.score,
    missedChars
  });

  if (result.pass) {
    await handleCorrect(result);
  } else {
    await handleWrong(result);
  }
}

async function handleCorrect(result) {
  const ev = game.onRead(true);
  setFeedback(`✓ ${result.hint}${ev.streakBonus ? '  连读 +1 能量！' : ''}`, 'good');
  Scene.onCorrect();
  renderEnergy();

  if (ev.canAttack) {
    showAttackPanel(true);
    setReadStatus('能量满了，去打怪兽！');
  } else {
    renderSentence();
  }
}

async function handleWrong(result) {
  const ev = game.onRead(false);
  if (ev.type === 'retaliate') {
    setFeedback('怪兽反击！但别灰心，下一句再来！', 'bad');
    renderHearts();
    await Scene.monsterAttack();
    if (ev.gameOver) { finishBattle(false); return; }
    renderSentence();
  } else {
    setFeedback(`× ${result.hint}（再错 ${ev.failsToRetaliate} 次怪兽就要反击啦）`, 'warn');
  }
}

async function doAttack() {
  if (!game.canAttack) return;
  btnAttack.disabled = true;
  setFeedback('⚡ 出招！', 'good');
  await Scene.playerAttack();
  const ev = game.attack();
  await Scene.monsterHurt(game.monsterHp / game.monsterHpMax);
  renderEnergy(); renderMonsterHp();
  if (ev.won) { finishBattle(true); return; }
  showAttackPanel(false);
  setFeedback('继续朗读，攒下一发能量！', 'info');
  renderSentence();
}

async function finishBattle(win) {
  if (win) {
    await Scene.monsterDefeat();
    await Scene.playerCelebrate();
    endEmoji.textContent = '🏆';
    endTitle.textContent = '胜利！';
    endMessage.textContent = `你打败了${game.lesson.monster}！课文越读越棒～`;
  } else {
    endEmoji.textContent = '💪';
    endTitle.textContent = '差一点点！';
    endMessage.textContent = '没关系，多读几遍课文，下次一定行！';
  }
  showScreen('end');
}

// ----------------- 麦克风（带实时高亮） -----------------
function toggleMic() {
  if (isListening) {
    recognitionHandle && recognitionHandle.stop();
    return;
  }
  setReadStatus('🎤 正在听...');
  debugTranscript.textContent = '';
  isListening = true;
  btnRead.classList.add('listening');
  btnRead.innerHTML = '<span class="mic-icon">⏸</span> 停止';

  let finalText = '';

  recognitionHandle = startRecognition({
    onResult: ({ text, isFinal }) => {
      debugTranscript.textContent = '识别中：' + text;
      // 实时高亮
      const target = game.currentSentence;
      const partial = matchPartial(text, target, settings.difficulty);
      updateKaraokeHighlight(partial.matched);
      if (isFinal) finalText = text;
    },
    onError: ({ message }) => {
      setReadStatus('');
      setFeedback(message, 'warn');
    },
    onEnd: ({ lastText } = {}) => {
      isListening = false;
      btnRead.classList.remove('listening');
      btnRead.innerHTML = '<span class="mic-icon">🎤</span> 开始朗读';
      const heard = finalText || lastText || '';
      setReadStatus('');
      if (heard) {
        debugTranscript.textContent = '你读的：' + heard;
        handleReadResult(heard);
      }
    }
  });
}

// ----------------- 学习报告 -----------------
function renderReport() {
  const overview = getOverview();
  const top = getTopMissedChars(15);
  const lessonStats = getLessonStats();
  const daily = getDailyActivity(7);

  $('report-total').textContent = overview.totalAttempts;
  $('report-passes').textContent = overview.passes;
  $('report-rate').textContent = overview.totalAttempts > 0
    ? Math.round(overview.passRate * 100) + '%'
    : '—';
  $('report-wrong-unique').textContent = overview.uniqueWrongChars;

  // 错字 top
  const wrongList = $('report-wrong-list');
  wrongList.innerHTML = '';
  if (top.length === 0) {
    wrongList.innerHTML = '<li class="empty">还没有读错的字～继续保持！</li>';
  } else {
    top.forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="wrong-char">${item.char}</span>
        <span class="wrong-meta">错 ${item.wrong} 次 · 出现 ${item.total} 次</span>
        <span class="wrong-rate" style="--rate:${Math.round(item.errorRate * 100)}%">
          ${Math.round(item.errorRate * 100)}%
        </span>
      `;
      wrongList.appendChild(li);
    });
  }

  // 课文统计
  const lessonList = $('report-lesson-list');
  lessonList.innerHTML = '';
  if (lessonStats.length === 0) {
    lessonList.innerHTML = '<li class="empty">还没练过课文～</li>';
  } else {
    lessonStats.forEach((s) => {
      const l = LESSONS.find((x) => x.id === s.lessonId);
      const li = document.createElement('li');
      li.innerHTML = `
        <span>${l ? l.title : s.lessonId}</span>
        <span class="lesson-meta">${s.passes}/${s.attempts}（${Math.round(s.rate * 100)}%）</span>
      `;
      lessonList.appendChild(li);
    });
  }

  // 7 天活跃
  const activity = $('report-activity');
  activity.innerHTML = '';
  const maxCount = Math.max(1, ...daily.map((d) => d.count));
  daily.forEach((d) => {
    const col = document.createElement('div');
    col.className = 'act-col';
    const barH = (d.count / maxCount) * 100;
    col.innerHTML = `
      <div class="act-num">${d.count || ''}</div>
      <div class="act-bar" style="height:${barH}%"></div>
      <div class="act-label">${d.label}</div>
    `;
    activity.appendChild(col);
  });
}

function bindReport() {
  if (!btnReport) return;
  btnReport.addEventListener('click', () => {
    renderReport();
    showScreen('report');
  });
  const btnClear = $('btn-clear-data');
  const btnExport = $('btn-export-data');
  const btnReportHome = $('btn-report-home');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (confirm('确定要清空所有学习记录吗？这个操作不能撤销。')) {
        clearAll();
        renderReport();
      }
    });
  }
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      const json = exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reading-report-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
  if (btnReportHome) {
    btnReportHome.addEventListener('click', () => showScreen('home'));
  }
}

// ----------------- 事件 -----------------
function bindEvents() {
  btnStart.addEventListener('click', startBattle);

  document.querySelectorAll('[data-action="home"]').forEach((b) =>
    b.addEventListener('click', () => {
      if (recognitionHandle) recognitionHandle.stop();
      Scene.dispose();
      showScreen('home');
    })
  );

  btnRead.addEventListener('click', toggleMic);
  btnManualOk.addEventListener('click', () => handleReadResult(game.currentSentence));
  btnManualFail.addEventListener('click', () => handleReadResult(''));

  btnAttack.addEventListener('click', doAttack);
  btnListen.addEventListener('click', () => speak(game.currentSentence));

  demoCorrect.addEventListener('click', () => handleReadResult(game.currentSentence));
  demoWrong.addEventListener('click', () => handleReadResult('哼哼'));
  btnSkipAttack.addEventListener('click', () => {
    game.forceEnergyFull();
    renderEnergy();
    showAttackPanel(true);
    setReadStatus('能量已加满（演示）');
  });

  btnRetry.addEventListener('click', () => startBattle());

  bindReport();
}

function init() {
  buildLessonOptions();
  bindEvents();
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
  if (!isRecognitionSupported()) {
    const manual = document.querySelector('input[name="input-mode"][value="manual"]');
    if (manual) manual.checked = true;
  }
  // 后端 API 预留：以后接入时取消注释并填 URL
  // setBackend({ url: 'https://your-api.com/reading-battle', userId: 'kid-001' });
}

init();
