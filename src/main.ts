import { registerSW } from "virtual:pwa-register";

import "./styles.css";
import { GameAudioManager, type AudioSettingName } from "./audio/audioManager";
import {
  DEFAULT_STAGE_ID,
  SCHOOL_STAGES,
  getCoursesByStage,
  type SchoolStageId,
} from "./content/courseCatalog";
import {
  DEFAULT_FREQUENCY_BAND,
  FREQUENCY_BANDS,
} from "./content/frequencyVocabulary";
import { isWeaponSelection, WEAPON_OPTIONS } from "./game/arsenal";
import { getBattleMap } from "./game/battleMaps";
import { createGame } from "./game/createGame";
import {
  emitAmmoSelect,
  emitCorrectionConfirm,
  emitDragFire,
  emitStart,
  emitZombieSelect,
  gameEvents,
  type BattleSoundCue,
  type BattleViewState,
  type BattleZombieView,
  type PronunciationCue,
} from "./game/events";
import { LearningController } from "./learning/learningController";

const GAME_WIDTH = 1280;
const GAME_HEIGHT = 800;
const MAX_VISIBLE_AMMO = 6;
const AMMO_DRAG_THRESHOLD_PX = 10;
const AMMO_DROP_PADDING_PX = 16;
const AMMO_DROP_OVERLAP_RATIO = 0.2;

interface AmmoDragState {
  pointerId: number;
  targetId: string;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  sourceButton: HTMLButtonElement;
  dragging: boolean;
  ghost: HTMLElement | null;
}

const isControlledE2E = new URLSearchParams(window.location.search).get("e2e") === "1";
if (!isControlledE2E) registerSW({ immediate: true });

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing #app root");

const stageButtonsMarkup = SCHOOL_STAGES.map(
  (stage) => `<button class="segment-button" type="button" data-stage="${stage.id}" aria-pressed="${stage.id === DEFAULT_STAGE_ID}">${stage.label}</button>`,
).join("");
const weaponOptionsMarkup = WEAPON_OPTIONS.map(
  (weapon) => `<option value="${weapon.id}">${weapon.label}</option>`,
).join("");
const frequencyButtonsMarkup = FREQUENCY_BANDS.map(
  (band) => `<button class="segment-button" type="button" data-frequency-band="${band.id}" aria-pressed="${band.id === DEFAULT_FREQUENCY_BAND}"><strong>${band.label}</strong><small>${band.total.toLocaleString("zh-CN")}词</small></button>`,
).join("");
const audioControlsMarkup = `
  <div class="audio-controls" aria-label="声音设置">
    <button class="audio-toggle" type="button" data-audio-setting="music" aria-pressed="true"><span aria-hidden="true">♫</span><b>音乐</b></button>
    <button class="audio-toggle" type="button" data-audio-setting="sfx" aria-pressed="true"><span aria-hidden="true">✦</span><b>音效</b></button>
    <button class="audio-toggle" type="button" data-audio-setting="pronunciation" aria-pressed="true"><span aria-hidden="true">A</span><b>发音</b></button>
  </div>
`;

app.innerHTML = `
  <section class="game-app" aria-label="单词大战僵尸">
    <header class="battle-header">
      <div class="brand-block">
        <strong class="brand-name">单词大战僵尸</strong>
        <span class="chapter-name">高中词频训练</span>
      </div>

      <div class="combat-metrics" aria-label="战斗数据">
        <span class="metric"><small>积分</small><strong id="score-value">0</strong></span>
        <span class="metric"><small>连击</small><strong id="streak-value">0</strong></span>
      </div>

      <div class="battle-progress" aria-label="关卡进度">
        <span class="progress-label">关卡 1</span>
        <div class="progress-track"><span id="progress-fill"></span></div>
        <span id="progress-count">0 / 20</span>
      </div>

      <div class="health-block" aria-label="城墙生命值">
        <span>防线</span>
        <strong id="health-value">100</strong>
        <div class="health-track"><span id="health-fill"></span></div>
      </div>
      ${audioControlsMarkup}
    </header>

    <div class="battle-workspace">
      <div id="game-canvas" aria-label="战斗区域">
        <div id="zombie-target-layer" role="group" aria-label="僵尸目标"></div>
      </div>
      <div id="feedback" class="feedback" aria-live="polite"></div>
      <div id="word-toast" class="word-toast" aria-live="polite" hidden>
        <strong id="word-toast-english"></strong>
        <span id="word-toast-phonetic"></span>
        <small id="word-toast-meaning"></small>
      </div>
    </div>

    <section class="ammo-dock" aria-label="单词弹药">
      <div class="loadout-status">
        <div class="loadout-heading">
          <span class="status-label">已装填</span>
          <span id="weapon-status" class="weapon-status">M4A1</span>
        </div>
        <strong id="loaded-ammo">未装填</strong>
        <span id="battle-counts" class="battle-counts">来袭 0 · 已出 0/20</span>
      </div>
      <div class="ammo-rack">
        <div class="ammo-rack-heading">
          <strong>英文单词弹</strong>
          <span>点击装填 · 也可拖到中文词牌</span>
        </div>
        <div id="ammo-grid" class="ammo-grid"></div>
        <span id="ammo-empty" class="ammo-empty">等待下一批弹药</span>
      </div>
    </section>

    <div id="start-screen" class="start-screen" role="dialog" aria-modal="true" aria-labelledby="start-title">
      <div class="start-panel">
        <span id="start-kicker" class="start-kicker">高中词频训练 · 每局20词</span>
        <h1 id="start-title">高频词防线</h1>
        <div class="start-controls">
          <fieldset class="selection-fieldset">
            <legend>学习阶段</legend>
            <div id="stage-switch" class="segmented-control">${stageButtonsMarkup}</div>
          </fieldset>
          <div class="course-summary" aria-live="polite">
            <strong id="course-title">高中英语</strong>
            <span id="course-version">蝶变英语词频分类 · 3,180词</span>
          </div>
          <fieldset class="selection-fieldset frequency-fieldset">
            <legend>词频阶段</legend>
            <div id="frequency-switch" class="segmented-control frequency-control">${frequencyButtonsMarkup}</div>
          </fieldset>
          <div class="profile-row">
            <label for="profile-select">学习档案</label>
            <select id="profile-select" aria-label="当前学习档案"><option>正在读取...</option></select>
            <button id="learning-button" class="secondary-command" type="button">学习进度</button>
          </div>
          <p id="selected-progress" class="selected-progress" aria-live="polite">正在读取本机学习进度...</p>
          <label class="weapon-row" for="weapon-select">
            <span>本局武器</span>
            <select id="weapon-select">
              <option value="random">随机武器</option>
              ${weaponOptionsMarkup}
            </select>
          </label>
          ${audioControlsMarkup}
          <div class="voice-test-row">
            <button id="pronunciation-test" class="voice-test-button" type="button">
              <span aria-hidden="true">▶</span><b>试听发音</b>
            </button>
            <span id="pronunciation-test-status" class="voice-test-status" role="status" aria-live="polite" hidden></span>
          </div>
        </div>
        <p id="course-status">正在安排本局单词...</p>
        <button id="start-button" class="start-button" type="button" disabled>战场部署中</button>
      </div>
    </div>

    <div id="correction-screen" class="correction-screen" role="dialog" aria-modal="true" aria-labelledby="correction-title" hidden>
      <div class="correction-panel">
        <span id="correction-kicker" class="correction-kicker">本关错词回顾</span>
        <p id="correction-reason" class="correction-reason"></p>
        <div class="correction-word">
          <span class="correction-label">正确英文</span>
          <h2 id="correction-title"></h2>
          <span id="correction-phonetic" class="correction-phonetic"></span>
        </div>
        <div class="correction-meaning">
          <span>中文意思</span>
          <strong id="correction-meaning"></strong>
        </div>
        <div class="correction-actions">
          <button id="correction-speak" class="speak-button" type="button"><span aria-hidden="true">▶</span> 再听一次</button>
          <button id="correction-confirm" class="start-button correction-confirm" type="button">知道了，看结果</button>
        </div>
      </div>
    </div>

    <div id="complete-screen" class="complete-screen" role="dialog" aria-modal="true" aria-labelledby="complete-title" hidden>
      <div class="complete-panel">
        <span id="complete-kicker" class="start-kicker">防守完成</span>
        <h2 id="complete-title">高频词防线已守住</h2>
        <strong id="complete-rating" class="complete-rating"></strong>
        <p id="complete-health"></p>
        <p id="complete-detail" class="complete-detail"></p>
        <div class="complete-actions">
          <button id="result-dashboard-button" class="secondary-command" type="button">查看学习进度</button>
          <button id="replay-button" class="start-button" type="button">再守一次</button>
        </div>
      </div>
    </div>

    <div id="learning-screen" class="learning-screen" role="dialog" aria-modal="true" aria-labelledby="learning-title" hidden>
      <section class="learning-panel">
        <header class="learning-header">
          <div>
            <span class="start-kicker">本机学习档案</span>
            <h2 id="learning-title">学习进度</h2>
          </div>
          <button id="learning-close" class="icon-command" type="button" aria-label="关闭学习进度" title="关闭">×</button>
        </header>

        <div class="dashboard-profile-row">
          <label for="dashboard-profile-select">当前档案</label>
          <select id="dashboard-profile-select"><option>正在读取...</option></select>
          <form id="profile-create-form" class="profile-create-form">
            <input id="profile-name-input" type="text" maxlength="20" placeholder="新档案名称" aria-label="新档案名称">
            <button type="submit">新建</button>
          </form>
        </div>

        <div class="progress-table-wrap">
          <table class="progress-table">
            <thead><tr><th>词频</th><th>已接触</th><th>学习中</th><th>稳定</th><th>已掌握</th><th>到期</th></tr></thead>
            <tbody id="dashboard-band-rows"></tbody>
          </table>
        </div>
        <p id="dashboard-summary" class="dashboard-summary" aria-live="polite"></p>

        <section class="weak-words-section">
          <div class="section-heading">
            <h3>近期薄弱词</h3>
            <span>优先进入后续关卡</span>
          </div>
          <ul id="weak-word-list" class="weak-word-list"></ul>
        </section>

        <footer class="learning-footer">
          <div class="backup-actions">
            <button id="backup-export" type="button" title="导出全部学习档案">↓ 导出备份</button>
            <button id="backup-import" type="button" title="恢复学习备份">↑ 导入备份</button>
            <input id="backup-file-input" type="file" accept="application/json,.json" hidden>
          </div>
          <div class="profile-actions">
            <button id="profile-reset" class="danger-command" type="button">清空当前档案</button>
            <button id="profile-delete" class="danger-command" type="button">删除当前档案</button>
          </div>
        </footer>
        <p id="learning-message" class="learning-message" role="status" aria-live="polite"></p>
      </section>
    </div>
  </section>
`;

const progressFill = document.querySelector<HTMLElement>("#progress-fill");
const progressCount = document.querySelector<HTMLElement>("#progress-count");
const healthFill = document.querySelector<HTMLElement>("#health-fill");
const healthValue = document.querySelector<HTMLElement>("#health-value");
const gameApp = document.querySelector<HTMLElement>(".game-app");
const scoreValue = document.querySelector<HTMLElement>("#score-value");
const streakValue = document.querySelector<HTMLElement>("#streak-value");
const weaponStatus = document.querySelector<HTMLElement>("#weapon-status");
const loadedAmmo = document.querySelector<HTMLElement>("#loaded-ammo");
const battleCounts = document.querySelector<HTMLElement>("#battle-counts");
const ammoGrid = document.querySelector<HTMLElement>("#ammo-grid");
const ammoEmpty = document.querySelector<HTMLElement>("#ammo-empty");
const gameCanvas = document.querySelector<HTMLElement>("#game-canvas");
const battleWorkspace = document.querySelector<HTMLElement>(".battle-workspace");
const zombieTargetLayer = document.querySelector<HTMLElement>("#zombie-target-layer");
const feedback = document.querySelector<HTMLElement>("#feedback");
const startScreen = document.querySelector<HTMLElement>("#start-screen");
const startKicker = document.querySelector<HTMLElement>("#start-kicker");
const startTitle = document.querySelector<HTMLElement>("#start-title");
const chapterName = document.querySelector<HTMLElement>(".chapter-name");
const stageButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-stage]")];
const courseTitle = document.querySelector<HTMLElement>("#course-title");
const courseVersion = document.querySelector<HTMLElement>("#course-version");
const courseStatus = document.querySelector<HTMLElement>("#course-status");
const weaponSelect = document.querySelector<HTMLSelectElement>("#weapon-select");
const completeScreen = document.querySelector<HTMLElement>("#complete-screen");
const completeKicker = document.querySelector<HTMLElement>("#complete-kicker");
const completeTitle = document.querySelector<HTMLElement>("#complete-title");
const completeRating = document.querySelector<HTMLElement>("#complete-rating");
const completeHealth = document.querySelector<HTMLElement>("#complete-health");
const completeDetail = document.querySelector<HTMLElement>("#complete-detail");
const startButton = document.querySelector<HTMLButtonElement>("#start-button");
const replayButton = document.querySelector<HTMLButtonElement>("#replay-button");
const resultDashboardButton = document.querySelector<HTMLButtonElement>(
  "#result-dashboard-button",
);
const audioButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-audio-setting]")];
const wordToast = document.querySelector<HTMLElement>("#word-toast");
const wordToastEnglish = document.querySelector<HTMLElement>("#word-toast-english");
const wordToastPhonetic = document.querySelector<HTMLElement>("#word-toast-phonetic");
const wordToastMeaning = document.querySelector<HTMLElement>("#word-toast-meaning");
const correctionScreen = document.querySelector<HTMLElement>("#correction-screen");
const correctionKicker = document.querySelector<HTMLElement>("#correction-kicker");
const correctionReason = document.querySelector<HTMLElement>("#correction-reason");
const correctionTitle = document.querySelector<HTMLElement>("#correction-title");
const correctionPhonetic = document.querySelector<HTMLElement>("#correction-phonetic");
const correctionMeaning = document.querySelector<HTMLElement>("#correction-meaning");
const correctionSpeak = document.querySelector<HTMLButtonElement>("#correction-speak");
const correctionConfirm = document.querySelector<HTMLButtonElement>("#correction-confirm");
const pronunciationTest = document.querySelector<HTMLButtonElement>("#pronunciation-test");
const pronunciationTestStatus = document.querySelector<HTMLElement>("#pronunciation-test-status");

const ammoButtons = new Map<string, HTMLButtonElement>();
const zombieButtons = new Map<string, HTMLButtonElement>();
const numberFormatter = new Intl.NumberFormat("zh-CN");
let battleReady = false;
let selectedStage: SchoolStageId = DEFAULT_STAGE_ID;
let latestState: BattleViewState | null = null;
let positionFrame: number | null = null;
let game: ReturnType<typeof createGame>;
let previousCorrectionReviewKey: string | null = null;
let wordToastTimer: number | undefined;
let ammoDragState: AmmoDragState | null = null;
let dragOverZombieButton: HTMLButtonElement | null = null;
let suppressClickButton: HTMLButtonElement | null = null;
let pronunciationTestRun = 0;
let startInProgress = false;
const audioManager = new GameAudioManager("/assets/audio/faster.mp3");
const learningController = new LearningController({
  onSelectionChange: () => renderCourseSelection(),
});

async function startBattle(): Promise<void> {
  const course = getCoursesByStage(selectedStage)[0];
  if (
    startInProgress
    || !battleReady
    || !learningController.selection.ready
    || !learningController.selection.profileId
    || !course
    || course.availability !== "available"
  ) return;
  startInProgress = true;
  if (startButton) {
    startButton.disabled = true;
    startButton.textContent = "正在编排本局";
  }
  game.sound.unlock();
  void audioManager.unlockAndStart();
  try {
    const plan = await learningController.createRound();
    const map = getBattleMap(plan.mapId);
    const weaponSelection = isWeaponSelection(weaponSelect?.value)
      ? weaponSelect.value
      : "random";
    battleWorkspace?.style.setProperty("--battle-map-image", `url("${map.assetPath}")`);
    if (chapterName) chapterName.textContent = `${map.name} · ${learningController.selection.bandLabel}词`;
    startScreen?.setAttribute("hidden", "");
    completeScreen?.setAttribute("hidden", "");
    correctionScreen?.setAttribute("hidden", "");
    emitStart({
      weaponSelection,
      sessionId: plan.sessionId,
      profileId: plan.profileId,
      band: plan.band,
      mapId: plan.mapId,
      content: plan.content,
    });
  } catch (error) {
    console.error("Unable to prepare the training round.", error);
    if (courseStatus) {
      courseStatus.textContent = error instanceof Error
        ? error.message
        : "本局单词编排失败，请重试";
    }
    startInProgress = false;
    renderCourseSelection();
  }
}

startButton?.addEventListener("click", () => void startBattle());
replayButton?.addEventListener("click", () => window.location.reload());
resultDashboardButton?.addEventListener("click", () => {
  void learningController.openDashboard();
});
correctionConfirm?.addEventListener("click", () => emitCorrectionConfirm());
correctionSpeak?.addEventListener("click", () => {
  const english = latestState?.correction?.english;
  if (english) void audioManager.pronounce(english);
});
pronunciationTest?.addEventListener("click", () => {
  void testPronunciation();
});
for (const button of audioButtons) {
  button.addEventListener("click", () => {
    const name = button.dataset.audioSetting;
    if (!isAudioSettingName(name)) return;
    audioManager.toggle(name);
    renderAudioSettings();
  });
}
for (const button of stageButtons) {
  button.addEventListener("click", () => {
    const stageId = button.dataset.stage;
    if (!SCHOOL_STAGES.some((stage) => stage.id === stageId)) return;
    selectedStage = stageId as SchoolStageId;
    renderCourseSelection();
  });
}

gameEvents.addEventListener("battle-state", (event) => {
  const state = (event as CustomEvent<unknown>).detail;
  if (isBattleViewState(state)) renderState(state);
});
gameEvents.addEventListener("battle-sound", (event) => {
  audioManager.playSfx((event as CustomEvent<BattleSoundCue>).detail);
});
gameEvents.addEventListener("battle-pronunciation", (event) => {
  const cue = (event as CustomEvent<PronunciationCue>).detail;
  if (cue.source === "correct") showWordToast(cue);
  void audioManager.pronounce(cue.english);
});
gameEvents.addEventListener("learning-progress-changed", () => {
  void learningController.refreshAfterBattle();
});

game = createGame("game-canvas");
renderCourseSelection();
renderAudioSettings();
void learningController.initialize();

const resizeObserver = new ResizeObserver(() => scheduleZombiePositioning());
if (gameCanvas) resizeObserver.observe(gameCanvas);

function isBattleViewState(value: unknown): value is BattleViewState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BattleViewState>;
  return Array.isArray(candidate.zombies)
    && Array.isArray(candidate.ammo)
    && typeof candidate.resolvedCount === "number"
    && typeof candidate.spawnedCount === "number"
    && typeof candidate.score === "number";
}

function renderCourseSelection(): void {
  const course = getCoursesByStage(selectedStage)[0];
  const available = course?.availability === "available";
  const learning = learningController.selection;
  learningController.setCourseAvailable(available);

  for (const button of stageButtons) {
    const active = button.dataset.stage === selectedStage;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  if (!course) return;
  if (courseTitle) courseTitle.textContent = course.title;
  if (courseVersion) {
    courseVersion.textContent = available
      ? `${course.edition} · ${course.volume}`
      : "教材版本待导入";
  }
  if (startKicker) {
    startKicker.textContent = available
      ? `${learning.profileName} · 高中词频训练 · 每局20词`
      : "初中英语";
  }
  if (startTitle) {
    startTitle.textContent = available ? `${learning.bandLabel}词防线` : "词库待导入";
  }
  if (chapterName) {
    chapterName.textContent = available ? `${learning.bandLabel}词训练` : "初中词库待导入";
  }
  if (courseStatus && !available) courseStatus.textContent = course.statusMessage;
  if (weaponSelect) weaponSelect.disabled = !available;
  if (startButton) {
    startButton.disabled = startInProgress
      || !battleReady
      || !learning.ready
      || !learning.profileId
      || !available;
    startButton.textContent = !battleReady || !learning.ready
      ? "战场部署中"
      : available
        ? startInProgress ? "正在编排本局" : "开始防守"
        : "等待初中词库";
  }
}

function renderState(state: BattleViewState): void {
  const previousPhase = latestState?.phase;
  audioManager.setReviewMode(state.phase === "reviewing");
  if (state.phase !== "playing") cancelAmmoDrag();
  latestState = state;
  const encounterCount = Math.max(1, state.encounterCount);
  const resolvedCount = Math.min(encounterCount, Math.max(0, state.resolvedCount));
  const health = Math.min(100, Math.max(0, state.health));

  if (progressFill) progressFill.style.width = `${(resolvedCount / encounterCount) * 100}%`;
  if (progressCount) progressCount.textContent = `${resolvedCount} / ${state.encounterCount}`;
  if (healthFill) healthFill.style.width = `${health}%`;
  if (healthValue) healthValue.textContent = String(state.health);
  if (scoreValue) scoreValue.textContent = numberFormatter.format(state.score);
  if (streakValue) streakValue.textContent = String(state.streak);
  if (battleCounts) {
    battleCounts.textContent = `来袭 ${state.activeZombieCount} · 已出 ${state.spawnedCount}/${state.encounterCount}`;
  }
  if (weaponStatus) {
    weaponStatus.textContent = WEAPON_OPTIONS.find((weapon) => weapon.id === state.weaponId)?.label
      ?? state.weaponId.toUpperCase();
  }
  if (gameApp) gameApp.dataset.weaponId = state.weaponId;
  if (gameCanvas) gameCanvas.dataset.weaponId = state.weaponId;
  const battleMap = getBattleMap(state.mapId);
  battleWorkspace?.style.setProperty("--battle-map-image", `url("${battleMap.assetPath}")`);
  if (gameCanvas) {
    gameCanvas.dataset.mapId = battleMap.id;
    gameCanvas.dataset.mapName = battleMap.name;
  }
  if (chapterName && state.phase !== "ready") {
    chapterName.textContent = `${battleMap.name} · ${learningController.selection.bandLabel}词`;
  }
  if (feedback) feedback.textContent = state.feedback;
  if (gameApp) gameApp.dataset.paused = String(state.correction !== null);

  syncAmmoButtons(state);
  syncZombieButtons(state);
  renderCorrection(state);

  if (state.phase === "ready") {
    battleReady = true;
    renderCourseSelection();
  }

  if (state.phase === "complete" || state.phase === "failed") {
    const failed = state.phase === "failed";
    const healthFailure = state.failureReason === "health";
    if (completeKicker) {
      completeKicker.textContent = failed
        ? healthFailure ? "本次防守结束" : "未达到晋级标准"
        : "防守完成";
    }
    if (completeTitle) {
      completeTitle.textContent = failed
        ? healthFailure ? "防线失守，重新部署" : "本局首答正确不足，重新挑战"
        : `${learningController.selection.bandLabel}词防线已守住`;
    }
    if (completeRating) {
      const stars = "★".repeat(state.stars) + "☆".repeat(3 - state.stars);
      completeRating.textContent = state.stars > 0
        ? `${stars} ${state.stars} 星`
        : `${stars} 本关未晋级`;
    }
    if (completeHealth) completeHealth.textContent = `防线剩余 ${state.health} 点生命`;
    if (completeDetail) {
      const saveStatus = state.progressSaveFailed ? " · 学习记录保存失败" : "";
      completeDetail.textContent = `本局首答正确 ${state.firstTryCorrectCount}/${state.targetWordCount} · 分数 ${numberFormatter.format(state.score)} · 消灭 ${state.defeatedCount} · 漏过 ${state.breachCount} · 误击 ${state.wrongAttempts}${saveStatus}`;
    }
    if (replayButton) replayButton.textContent = failed ? "重新部署" : "再守一次";
    completeScreen?.removeAttribute("hidden");
    if (previousPhase !== state.phase) replayButton?.focus();
  }
}

function renderCorrection(state: BattleViewState): void {
  const correction = state.correction;
  if (!correction) {
    correctionScreen?.setAttribute("hidden", "");
    previousCorrectionReviewKey = null;
    return;
  }

  if (correctionKicker) {
    correctionKicker.textContent = `本关错词回顾 · ${correction.reviewIndex}/${correction.reviewTotal}`;
  }
  if (correctionReason) {
    correctionReason.textContent = correction.reason === "wrong-charge"
      ? "本关中这道题发生了错配，现在集中复习正确答案。"
      : "本关中这道题没有及时作答，现在集中复习正确答案。";
  }
  if (correctionTitle) correctionTitle.textContent = correction.english;
  if (correctionPhonetic) {
    correctionPhonetic.textContent = correction.phonetic || "跟随发音朗读一遍";
  }
  if (correctionMeaning) correctionMeaning.textContent = correction.meaningZh;
  if (correctionConfirm) {
    correctionConfirm.textContent = correction.reviewIndex < correction.reviewTotal
      ? "知道了，下一个"
      : "知道了，看结果";
  }
  correctionScreen?.removeAttribute("hidden");
  const reviewKey = `${correction.targetId}:${correction.reviewIndex}`;
  if (previousCorrectionReviewKey !== reviewKey) {
    previousCorrectionReviewKey = reviewKey;
    correctionConfirm?.focus();
  }
}

function showWordToast(cue: PronunciationCue): void {
  if (wordToastEnglish) wordToastEnglish.textContent = cue.english;
  if (wordToastPhonetic) wordToastPhonetic.textContent = cue.phonetic;
  if (wordToastMeaning) wordToastMeaning.textContent = cue.meaningZh;
  wordToast?.removeAttribute("hidden");
  wordToast?.classList.remove("is-showing");
  requestAnimationFrame(() => wordToast?.classList.add("is-showing"));
  if (wordToastTimer !== undefined) window.clearTimeout(wordToastTimer);
  wordToastTimer = window.setTimeout(() => {
    wordToast?.classList.remove("is-showing");
    window.setTimeout(() => wordToast?.setAttribute("hidden", ""), 180);
  }, 1_900);
}

function isAudioSettingName(value: unknown): value is AudioSettingName {
  return value === "music" || value === "sfx" || value === "pronunciation";
}

function renderAudioSettings(): void {
  const settings = audioManager.currentSettings;
  for (const button of audioButtons) {
    const name = button.dataset.audioSetting;
    if (!isAudioSettingName(name)) continue;
    const enabled = settings[name];
    button.dataset.enabled = String(enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.title = `${button.textContent?.trim() ?? "声音"}${enabled ? "已开启" : "已关闭"}`;
  }
  if (correctionSpeak) correctionSpeak.disabled = !settings.pronunciation;
  if (pronunciationTest) {
    pronunciationTest.disabled = !settings.pronunciation || !audioManager.pronunciationSupported;
  }
  if (!audioManager.pronunciationSupported) {
    showPronunciationTestStatus("当前浏览器不支持网页发音", "error");
  } else if (!settings.pronunciation) {
    showPronunciationTestStatus("发音已关闭", "idle");
  } else if (pronunciationTestStatus?.dataset.state === "idle") {
    pronunciationTestStatus.setAttribute("hidden", "");
  }
}

async function testPronunciation(): Promise<void> {
  if (!pronunciationTest || !audioManager.currentSettings.pronunciation) return;
  const run = ++pronunciationTestRun;
  pronunciationTest.disabled = true;
  showPronunciationTestStatus("正在试听...", "testing");
  const spoken = await audioManager.pronounce("heritage");
  if (run !== pronunciationTestRun) return;

  pronunciationTest.disabled = !audioManager.currentSettings.pronunciation
    || !audioManager.pronunciationSupported;
  if (!audioManager.currentSettings.pronunciation) {
    showPronunciationTestStatus("发音已关闭", "idle");
    return;
  }
  showPronunciationTestStatus(
    spoken ? "英文发音正常" : getPronunciationFailureMessage(),
    spoken ? "success" : "error",
  );
}

function showPronunciationTestStatus(
  message: string,
  state: "idle" | "testing" | "success" | "error",
): void {
  if (!pronunciationTestStatus) return;
  pronunciationTestStatus.textContent = message;
  pronunciationTestStatus.dataset.state = state;
  pronunciationTestStatus.removeAttribute("hidden");
}

function getPronunciationFailureMessage(): string {
  const userAgent = navigator.userAgent.toLowerCase();
  const isIPad = userAgent.includes("ipad")
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIPad) return "未检测到英文发音，请在 iPad 设置中下载英语声音";
  if (userAgent.includes("android")) {
    return "未检测到英文发音，请在系统文字转语音中安装英语语音数据";
  }
  return "未检测到英文发音，请检查系统英文文字转语音";
}

function syncAmmoButtons(state: BattleViewState): void {
  if (!ammoGrid) return;
  const visibleAmmo = state.ammo.slice(0, MAX_VISIBLE_AMMO);
  const activeTargetIds = new Set(visibleAmmo.map((ammo) => ammo.targetId));

  for (const [targetId, button] of ammoButtons) {
    if (!activeTargetIds.has(targetId)) {
      button.remove();
      ammoButtons.delete(targetId);
    }
  }

  visibleAmmo.forEach((ammo, index) => {
    let button = ammoButtons.get(ammo.targetId);
    if (!button) {
      button = createAmmoButton(ammo.targetId);
      ammoButtons.set(ammo.targetId, button);
    }

    const loaded = state.loadedTargetId === ammo.targetId;
    button.dataset.loaded = String(loaded);
    button.dataset.ammoIndex = String(index + 1);
    button.classList.toggle("is-loaded", loaded);
    button.disabled = state.phase !== "playing" || !state.canLoadAmmo;
    button.setAttribute("aria-pressed", String(loaded));
    button.setAttribute("aria-keyshortcuts", String(index + 1));
    button.setAttribute(
      "aria-label",
      `${index + 1}，${ammo.label}，点击装填或拖到僵尸中文词牌`,
    );
    button.title = `${ammo.label}：点击装填，或拖到对应的中文词牌`;
    const key = button.querySelector<HTMLElement>(".ammo-key");
    const label = button.querySelector<HTMLElement>(".ammo-label");
    if (key) key.textContent = String(index + 1);
    if (label) label.textContent = ammo.label;
    placeChildAt(ammoGrid, button, index);
  });

  const loadedLabel = state.loadedTargetId === null
    ? "未装填"
    : state.ammo.find((ammo) => ammo.targetId === state.loadedTargetId)?.label ?? "已装填";
  if (loadedAmmo) loadedAmmo.textContent = loadedLabel;
  if (ammoEmpty) ammoEmpty.hidden = visibleAmmo.length > 0;
}

function createAmmoButton(targetId: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ammo-button";
  button.dataset.targetId = targetId;
  button.innerHTML = `<span class="ammo-key"></span><span class="ammo-label"></span>`;
  button.addEventListener("click", (event) => {
    if (suppressClickButton === button) {
      event.preventDefault();
      suppressClickButton = null;
      return;
    }
    const currentTargetId = button.dataset.targetId;
    if (currentTargetId) emitAmmoSelect(currentTargetId);
  });
  button.addEventListener("pointerdown", (event) => beginAmmoDrag(event, button));
  button.addEventListener("pointermove", moveAmmoDrag);
  button.addEventListener("pointerup", finishAmmoDrag);
  button.addEventListener("pointercancel", cancelAmmoDragFromEvent);
  button.addEventListener("lostpointercapture", cancelAmmoDragFromEvent);
  return button;
}

function beginAmmoDrag(event: PointerEvent, button: HTMLButtonElement): void {
  if (button.disabled || event.isPrimary === false) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const targetId = button.dataset.targetId;
  if (!targetId || latestState?.phase !== "playing" || !latestState.canLoadAmmo) return;

  cancelAmmoDrag();
  ammoDragState = {
    pointerId: event.pointerId,
    targetId,
    startX: event.clientX,
    startY: event.clientY,
    clientX: event.clientX,
    clientY: event.clientY,
    sourceButton: button,
    dragging: false,
    ghost: null,
  };
  try {
    button.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic accessibility tests may not register an OS-level active pointer.
  }
}

function moveAmmoDrag(event: PointerEvent): void {
  const drag = ammoDragState;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.dragging && distance < AMMO_DRAG_THRESHOLD_PX) return;

  if (!drag.dragging) {
    drag.dragging = true;
    drag.sourceButton.classList.add("is-dragging");
    drag.ghost = createAmmoDragGhost(drag.sourceButton);
  }

  event.preventDefault();
  drag.clientX = event.clientX;
  drag.clientY = event.clientY;
  updateAmmoDragGhost(drag.ghost, event.clientX, event.clientY);
  refreshAmmoDragTarget();
}

function finishAmmoDrag(event: PointerEvent): void {
  const drag = ammoDragState;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.dragging) {
    cancelAmmoDrag();
    return;
  }

  event.preventDefault();
  drag.clientX = event.clientX;
  drag.clientY = event.clientY;
  updateAmmoDragGhost(drag.ghost, event.clientX, event.clientY);
  const targetButton = findZombieDropTarget(event.clientX, event.clientY, drag.ghost);
  const zombieId = targetButton?.dataset.zombieId;
  suppressClickButton = drag.sourceButton;
  window.setTimeout(() => {
    if (suppressClickButton === drag.sourceButton) suppressClickButton = null;
  }, 250);
  cancelAmmoDrag();
  if (zombieId) emitDragFire(drag.targetId, zombieId);
}

function cancelAmmoDragFromEvent(event: PointerEvent): void {
  if (ammoDragState?.pointerId === event.pointerId) cancelAmmoDrag();
}

function cancelAmmoDrag(): void {
  const drag = ammoDragState;
  if (!drag) {
    setDragOverZombie(null);
    return;
  }
  ammoDragState = null;
  drag.sourceButton.classList.remove("is-dragging");
  drag.ghost?.remove();
  setDragOverZombie(null);
  try {
    if (drag.sourceButton.hasPointerCapture(drag.pointerId)) {
      drag.sourceButton.releasePointerCapture(drag.pointerId);
    }
  } catch {
    // The button may disappear if its matching zombie crosses the line mid-drag.
  }
}

function createAmmoDragGhost(button: HTMLButtonElement): HTMLElement {
  const ghost = document.createElement("div");
  ghost.className = "ammo-drag-ghost";
  const kicker = document.createElement("span");
  kicker.textContent = "单词弹";
  const label = document.createElement("strong");
  label.textContent = button.querySelector<HTMLElement>(".ammo-label")?.textContent ?? "";
  ghost.append(kicker, label);
  document.body.append(ghost);
  return ghost;
}

function updateAmmoDragGhost(ghost: HTMLElement | null, clientX: number, clientY: number): void {
  if (!ghost) return;
  ghost.style.left = `${clientX}px`;
  ghost.style.top = `${clientY}px`;
}

function refreshAmmoDragTarget(): void {
  const drag = ammoDragState;
  if (!drag?.dragging || !drag.ghost) return;
  setDragOverZombie(findZombieDropTarget(drag.clientX, drag.clientY, drag.ghost));
}

function findZombieDropTarget(
  clientX: number,
  clientY: number,
  ghost: HTMLElement | null,
): HTMLButtonElement | null {
  const ghostRect = ghost?.getBoundingClientRect();
  let bestCollision: { button: HTMLButtonElement; overlapArea: number; distance: number } | null = null;

  if (ghostRect && ghostRect.width > 0 && ghostRect.height > 0) {
    const ghostArea = ghostRect.width * ghostRect.height;
    const ghostCenterX = ghostRect.left + ghostRect.width / 2;
    const ghostCenterY = ghostRect.top + ghostRect.height / 2;

    for (const button of zombieButtons.values()) {
      if (!isTargetableZombieButton(button)) continue;
      const targetRect = button.getBoundingClientRect();
      const expandedLeft = targetRect.left - AMMO_DROP_PADDING_PX;
      const expandedTop = targetRect.top - AMMO_DROP_PADDING_PX;
      const expandedRight = targetRect.right + AMMO_DROP_PADDING_PX;
      const expandedBottom = targetRect.bottom + AMMO_DROP_PADDING_PX;
      const overlapWidth = Math.max(
        0,
        Math.min(ghostRect.right, expandedRight) - Math.max(ghostRect.left, expandedLeft),
      );
      const overlapHeight = Math.max(
        0,
        Math.min(ghostRect.bottom, expandedBottom) - Math.max(ghostRect.top, expandedTop),
      );
      const overlapArea = overlapWidth * overlapHeight;
      const targetArea = Math.max(1, targetRect.width * targetRect.height);
      const overlapRatio = overlapArea / Math.min(ghostArea, targetArea);
      if (overlapRatio < AMMO_DROP_OVERLAP_RATIO) continue;

      const targetCenterX = targetRect.left + targetRect.width / 2;
      const targetCenterY = targetRect.top + targetRect.height / 2;
      const distance = Math.hypot(ghostCenterX - targetCenterX, ghostCenterY - targetCenterY);
      if (
        !bestCollision
        || overlapArea > bestCollision.overlapArea
        || (overlapArea === bestCollision.overlapArea && distance < bestCollision.distance)
      ) {
        bestCollision = { button, overlapArea, distance };
      }
    }
  }

  if (bestCollision) return bestCollision.button;

  const element = document.elementFromPoint(clientX, clientY);
  const pointerButton = element?.closest<HTMLButtonElement>(".zombie-target-button") ?? null;
  return pointerButton && isTargetableZombieButton(pointerButton) ? pointerButton : null;
}

function isTargetableZombieButton(button: HTMLButtonElement): boolean {
  return !button.disabled && button.dataset.status === "approaching";
}

function setDragOverZombie(button: HTMLButtonElement | null): void {
  ammoDragState?.ghost?.classList.toggle("is-locked", button !== null);
  if (dragOverZombieButton === button) return;
  dragOverZombieButton?.classList.remove("is-drag-over");
  dragOverZombieButton = button;
  dragOverZombieButton?.classList.add("is-drag-over");
}

function syncZombieButtons(state: BattleViewState): void {
  if (!zombieTargetLayer) return;
  const activeZombieIds = new Set(state.zombies.map((zombie) => zombie.id));

  for (const [zombieId, button] of zombieButtons) {
    if (!activeZombieIds.has(zombieId)) {
      button.remove();
      zombieButtons.delete(zombieId);
    }
  }

  state.zombies.forEach((zombie, index) => {
    let button = zombieButtons.get(zombie.id);
    if (!button) {
      button = createZombieButton(zombie.id);
      zombieButtons.set(zombie.id, button);
    }

    button.dataset.targetId = zombie.targetId;
    button.dataset.status = zombie.status;
    button.dataset.lane = String(zombie.lane);
    button.dataset.worldX = String(zombie.x);
    button.dataset.worldY = String(zombie.y);
    button.classList.toggle("is-charging", zombie.status === "charging");
    button.disabled = state.phase !== "playing" || zombie.status === "charging";
    button.title = zombie.prompt;
    button.setAttribute(
      "aria-label",
      `${zombie.prompt}，${zombie.status === "charging" ? "正在冲锋" : "正在接近"}`,
    );
    const prompt = button.querySelector<HTMLElement>(".zombie-target-prompt");
    const danger = button.querySelector<HTMLElement>(".zombie-danger");
    if (prompt) prompt.textContent = zombie.prompt;
    if (danger) danger.hidden = zombie.status !== "charging";
    placeChildAt(zombieTargetLayer, button, index);
  });

  scheduleZombiePositioning();
}

function createZombieButton(zombieId: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "zombie-target-button";
  button.dataset.zombieId = zombieId;
  button.innerHTML = `<span class="zombie-danger" hidden>冲锋</span><span class="zombie-target-prompt"></span>`;
  button.addEventListener("click", () => {
    const currentZombieId = button.dataset.zombieId;
    if (currentZombieId) emitZombieSelect(currentZombieId);
  });
  return button;
}

function placeChildAt(parent: HTMLElement, child: HTMLElement, index: number): void {
  const current = parent.children.item(index);
  if (current !== child) parent.insertBefore(child, current);
}

function scheduleZombiePositioning(): void {
  if (positionFrame !== null) return;
  positionFrame = requestAnimationFrame(() => {
    positionFrame = null;
    positionZombieButtons();
  });
}

function positionZombieButtons(): void {
  if (!latestState || !gameCanvas) return;
  const canvas = gameCanvas.querySelector<HTMLCanvasElement>("canvas");
  if (!canvas) return;
  const parentRect = gameCanvas.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return;
  const offsetX = canvasRect.left - parentRect.left;
  const offsetY = canvasRect.top - parentRect.top;
  const scaleX = canvasRect.width / GAME_WIDTH;
  const scaleY = canvasRect.height / GAME_HEIGHT;
  const canvasLeft = offsetX;
  const canvasRight = offsetX + canvasRect.width;
  const laneGroups = new Map<number, Array<{
    zombie: BattleZombieView;
    button: HTMLButtonElement;
    centerX: number;
    halfWidth: number;
  }>>();

  for (const zombie of latestState.zombies) {
    const button = zombieButtons.get(zombie.id);
    if (!button) continue;
    const halfWidth = Math.max(22, button.offsetWidth / 2);
    const buttonHeight = Math.max(44, button.offsetHeight);
    const laneOffset = scaleY < 0.5 ? zombie.lane * 14 : 0;
    const rawBottom = offsetY + zombie.y * scaleY + laneOffset;
    const localBottom = clamp(
      rawBottom,
      offsetY + buttonHeight + 4,
      offsetY + canvasRect.height - 4,
    );
    button.style.top = `${localBottom}px`;
    button.style.zIndex = String(10 + zombie.lane);

    const laneGroup = laneGroups.get(zombie.lane) ?? [];
    laneGroup.push({
      zombie,
      button,
      centerX: offsetX + zombie.x * scaleX,
      halfWidth,
    });
    laneGroups.set(zombie.lane, laneGroup);
  }

  const horizontalGap = 8;
  for (const laneGroup of laneGroups.values()) {
    laneGroup.sort((left, right) => left.centerX - right.centerX);
    laneGroup.forEach((item, index) => {
      item.centerX = clamp(
        item.centerX,
        canvasLeft + item.halfWidth + 4,
        canvasRight - item.halfWidth - 4,
      );
      if (index === 0) return;
      const previous = laneGroup[index - 1];
      item.centerX = Math.max(
        item.centerX,
        previous.centerX + previous.halfWidth + item.halfWidth + horizontalGap,
      );
    });

    const finalItem = laneGroup.at(-1);
    if (finalItem) {
      const overflow = finalItem.centerX + finalItem.halfWidth + 4 - canvasRight;
      if (overflow > 0) {
        for (const item of laneGroup) item.centerX -= overflow;
      }
    }

    const firstItem = laneGroup[0];
    if (firstItem) {
      const underflow = canvasLeft + 4 - (firstItem.centerX - firstItem.halfWidth);
      if (underflow > 0) {
        for (const item of laneGroup) item.centerX += underflow;
      }
    }

    for (const item of laneGroup) {
      item.button.style.left = `${item.centerX}px`;
    }
  }
  refreshAmmoDragTarget();
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return (minimum + maximum) / 2;
  return Math.min(maximum, Math.max(minimum, value));
}

window.addEventListener("pagehide", () => {
  resizeObserver.disconnect();
  if (positionFrame !== null) cancelAnimationFrame(positionFrame);
  if (wordToastTimer !== undefined) window.clearTimeout(wordToastTimer);
  audioManager.destroy();
});
