import {
  DEFAULT_FREQUENCY_BAND,
  FREQUENCY_BANDS,
  getFrequencyBandDefinition,
  getWordsByFrequencyBand,
  isFrequencyBand,
} from "../content/frequencyVocabulary";
import type { FrequencyBand, FrequencyWord } from "../content/frequencyTypes";
import {
  getBattleMapForSessionCount,
  type BattleMapId,
} from "../game/battleMaps";
import {
  createProfile,
  deleteProfile,
  ensureDefaultProfile,
  exportProgress,
  getBandProgressSummary,
  getProfileSessionCount,
  getWordProgress,
  importProgress,
  listProfiles,
  resetProfileProgress,
  startSession,
} from "../storage/progressDb";
import type {
  BandProgressSummary,
  ProfileRecord,
  WordProgressRecord,
} from "../storage/types";
import { buildTrainingPlan, type TrainingPlan } from "./trainingPlanner";

const BAND_STORAGE_KEY = "word-zombie.frequency-band.v1";
const PROFILE_STORAGE_KEY = "word-zombie.active-profile.v2";

export interface LearningSelectionView {
  readonly ready: boolean;
  readonly band: FrequencyBand;
  readonly bandLabel: string;
  readonly profileId: string | null;
  readonly profileName: string;
  readonly summary: BandProgressSummary | null;
}

export interface LearningControllerOptions {
  readonly onSelectionChange: (view: LearningSelectionView) => void;
}

export interface PreparedTrainingRound extends TrainingPlan {
  readonly sessionId: string;
  readonly profileId: string;
  readonly band: FrequencyBand;
  readonly mapId: BattleMapId;
}

function queryRequired<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing learning UI element: ${selector}`);
  return element;
}

export class LearningController {
  private readonly onSelectionChange: LearningControllerOptions["onSelectionChange"];
  private readonly bandButtons = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-frequency-band]"),
  ];
  private readonly profileSelect = queryRequired<HTMLSelectElement>("#profile-select");
  private readonly dashboardProfileSelect = queryRequired<HTMLSelectElement>(
    "#dashboard-profile-select",
  );
  private readonly selectedProgress = queryRequired<HTMLElement>("#selected-progress");
  private readonly courseStatus = queryRequired<HTMLElement>("#course-status");
  private readonly learningScreen = queryRequired<HTMLElement>("#learning-screen");
  private readonly learningClose = queryRequired<HTMLButtonElement>("#learning-close");
  private readonly learningButton = queryRequired<HTMLButtonElement>("#learning-button");
  private readonly dashboardRows = queryRequired<HTMLElement>("#dashboard-band-rows");
  private readonly dashboardSummary = queryRequired<HTMLElement>("#dashboard-summary");
  private readonly weakWordList = queryRequired<HTMLElement>("#weak-word-list");
  private readonly createForm = queryRequired<HTMLFormElement>("#profile-create-form");
  private readonly profileNameInput = queryRequired<HTMLInputElement>("#profile-name-input");
  private readonly exportButton = queryRequired<HTMLButtonElement>("#backup-export");
  private readonly importButton = queryRequired<HTMLButtonElement>("#backup-import");
  private readonly importInput = queryRequired<HTMLInputElement>("#backup-file-input");
  private readonly resetButton = queryRequired<HTMLButtonElement>("#profile-reset");
  private readonly deleteButton = queryRequired<HTMLButtonElement>("#profile-delete");
  private readonly message = queryRequired<HTMLElement>("#learning-message");
  private profiles: ProfileRecord[] = [];
  private selectedBand: FrequencyBand = DEFAULT_FREQUENCY_BAND;
  private selectedProfileId: string | null = null;
  private selectedSummary: BandProgressSummary | null = null;
  private ready = false;
  private courseAvailable = true;
  private refreshVersion = 0;

  constructor(options: LearningControllerOptions) {
    this.onSelectionChange = options.onSelectionChange;
    const storedBand = localStorage.getItem(BAND_STORAGE_KEY);
    if (isFrequencyBand(storedBand)) this.selectedBand = storedBand;
    this.bindEvents();
    this.renderBandButtons();
  }

  get selection(): LearningSelectionView {
    const profile = this.profiles.find((candidate) => candidate.id === this.selectedProfileId);
    return {
      ready: this.ready,
      band: this.selectedBand,
      bandLabel: getFrequencyBandDefinition(this.selectedBand).label,
      profileId: this.selectedProfileId,
      profileName: profile?.name ?? "学习档案不可用",
      summary: this.selectedSummary,
    };
  }

  async initialize(): Promise<void> {
    try {
      const fallback = await ensureDefaultProfile();
      this.profiles = await listProfiles();
      const storedProfileId = localStorage.getItem(PROFILE_STORAGE_KEY);
      this.selectedProfileId = this.profiles.some((profile) => profile.id === storedProfileId)
        ? storedProfileId
        : fallback.id;
      this.ready = true;
      this.setStorageControlsEnabled(true);
      this.renderProfileOptions();
      await this.refreshSelection();
    } catch (error) {
      this.handleStorageFailure(error);
    }
  }

  setCourseAvailable(available: boolean): void {
    const becameAvailable = available && !this.courseAvailable;
    this.courseAvailable = available;
    for (const button of this.bandButtons) button.disabled = !available || !this.ready;
    if (becameAvailable && this.ready) void this.refreshSelection();
  }

  async createRound(): Promise<PreparedTrainingRound> {
    if (!this.ready || !this.selectedProfileId) {
      throw new Error("学习档案不可用，无法创建会保存进度的关卡");
    }
    const profileId = this.selectedProfileId;
    const band = this.selectedBand;
    const [progress, sessionCount] = await Promise.all([
      getWordProgress(profileId, band),
      getProfileSessionCount(profileId),
    ]);
    const plan = buildTrainingPlan(
      getWordsByFrequencyBand(band),
      progress,
      { band },
    );
    const map = getBattleMapForSessionCount(sessionCount);
    const session = await startSession({
      profileId,
      band,
      levelId: plan.content.id,
    });
    return {
      ...plan,
      sessionId: session.id,
      profileId,
      band,
      mapId: map.id,
    };
  }

  async refreshAfterBattle(): Promise<void> {
    if (!this.ready || !this.selectedProfileId) return;
    await this.refreshSelection();
    if (!this.learningScreen.hidden) await this.renderDashboard();
  }

  async openDashboard(): Promise<void> {
    this.learningScreen.hidden = false;
    this.learningClose.focus();
    await this.renderDashboard();
  }

  closeDashboard(): void {
    this.learningScreen.hidden = true;
    this.learningButton.focus();
  }

  private bindEvents(): void {
    for (const button of this.bandButtons) {
      button.addEventListener("click", () => {
        const band = button.dataset.frequencyBand;
        if (!this.courseAvailable || !isFrequencyBand(band)) return;
        this.selectedBand = band;
        localStorage.setItem(BAND_STORAGE_KEY, band);
        this.renderBandButtons();
        void this.refreshSelection();
      });
    }
    this.profileSelect.addEventListener("change", () => {
      void this.selectProfile(this.profileSelect.value);
    });
    this.dashboardProfileSelect.addEventListener("change", () => {
      void this.selectProfile(this.dashboardProfileSelect.value, true);
    });
    this.learningButton.addEventListener("click", () => void this.openDashboard());
    this.learningClose.addEventListener("click", () => this.closeDashboard());
    this.learningScreen.addEventListener("click", (event) => {
      if (event.target === this.learningScreen) this.closeDashboard();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.learningScreen.hidden) this.closeDashboard();
    });
    this.createForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.handleCreateProfile();
    });
    this.exportButton.addEventListener("click", () => void this.handleExport());
    this.importButton.addEventListener("click", () => this.importInput.click());
    this.importInput.addEventListener("change", () => void this.handleImport());
    this.resetButton.addEventListener("click", () => void this.handleReset());
    this.deleteButton.addEventListener("click", () => void this.handleDelete());
  }

  private async selectProfile(value: string, keepDashboardOpen = false): Promise<void> {
    if (!this.profiles.some((profile) => profile.id === value)) return;
    this.selectedProfileId = value;
    localStorage.setItem(PROFILE_STORAGE_KEY, value);
    this.renderProfileOptions();
    await this.refreshSelection();
    if (keepDashboardOpen) await this.renderDashboard();
  }

  private renderBandButtons(): void {
    for (const button of this.bandButtons) {
      const active = button.dataset.frequencyBand === this.selectedBand;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  private renderProfileOptions(): void {
    const fill = (select: HTMLSelectElement): void => {
      select.replaceChildren();
      for (const profile of this.profiles) {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = profile.name;
        select.append(option);
      }
      if (this.profiles.length === 0) {
        const unavailable = document.createElement("option");
        unavailable.value = "";
        unavailable.textContent = "学习记录不可用";
        select.append(unavailable);
      }
      select.value = this.selectedProfileId ?? "";
    };
    fill(this.profileSelect);
    fill(this.dashboardProfileSelect);
  }

  private async refreshSelection(): Promise<void> {
    const version = ++this.refreshVersion;
    if (!this.ready || !this.selectedProfileId) {
      this.selectedSummary = null;
      this.selectedProgress.textContent = "学习记录不可用，已停止开局以避免进度丢失";
      this.courseStatus.textContent = "请退出无痕模式，允许网站保存数据后刷新页面";
      this.onSelectionChange(this.selection);
      return;
    }
    const definition = getFrequencyBandDefinition(this.selectedBand);
    try {
      const [summary, progress] = await Promise.all([
        getBandProgressSummary(
          this.selectedProfileId,
          this.selectedBand,
          definition.total,
        ),
        getWordProgress(this.selectedProfileId, this.selectedBand),
      ]);
      if (version !== this.refreshVersion) return;
      this.selectedSummary = summary;
      this.renderSelectedSummary(progress);
      this.onSelectionChange(this.selection);
    } catch (error) {
      if (version === this.refreshVersion) this.handleStorageFailure(error);
    }
  }

  private renderSelectedSummary(progress: readonly WordProgressRecord[]): void {
    const summary = this.selectedSummary;
    if (!summary) return;
    this.selectedProgress.textContent = [
      `已掌握 ${summary.masteredWords}`,
      `稳定 ${summary.stableWords}`,
      `待复习 ${summary.dueWords}`,
      `未接触 ${summary.unseenWords}`,
    ].join(" · ");
    const preview = buildTrainingPlan(
      getWordsByFrequencyBand(this.selectedBand),
      progress,
      { band: this.selectedBand, random: () => 0.5 },
    );
    const parts = [
      preview.composition.dueWeak > 0 ? `错词 ${preview.composition.dueWeak}` : "",
      preview.composition.dueReview > 0 ? `到期 ${preview.composition.dueReview}` : "",
      preview.composition.masteredAudit > 0
        ? `抽查 ${preview.composition.masteredAudit}`
        : "",
      preview.composition.unseen > 0 ? `新词 ${preview.composition.unseen}` : "",
      preview.composition.practice > 0 ? `巩固 ${preview.composition.practice}` : "",
    ].filter(Boolean);
    this.courseStatus.textContent = `本局 ${parts.join(" · ")}｜首答正确 14/20 且防线未破可过关`;
  }

  private async renderDashboard(): Promise<void> {
    this.dashboardRows.replaceChildren();
    if (!this.ready || !this.selectedProfileId) {
      this.dashboardSummary.textContent = "本机学习记录不可用，无法显示进度";
      this.weakWordList.replaceChildren();
      this.appendEmptyWeakMessage("请允许浏览器保存网站数据后刷新页面");
      this.resetButton.disabled = true;
      this.deleteButton.disabled = true;
      return;
    }
    const profileId = this.selectedProfileId;
    const rows = await Promise.all(FREQUENCY_BANDS.map(async (definition) => {
      return getBandProgressSummary(
        profileId,
        definition.id,
        definition.total,
      );
    }));

    for (const row of rows) {
      const definition = getFrequencyBandDefinition(row.band);
      const tr = document.createElement("tr");
      tr.classList.toggle("is-active", row.band === this.selectedBand);
      const cells = [
        `${definition.label} ${definition.total.toLocaleString("zh-CN")}`,
        String(row.wordsSeen),
        String(row.reinforcingWords),
        String(row.stableWords),
        String(row.masteredWords),
        String(row.dueWords),
      ];
      cells.forEach((value, index) => {
        const cell = document.createElement(index === 0 ? "th" : "td");
        cell.textContent = value;
        if (index === 0) {
          cell.setAttribute("scope", "row");
          tr.addEventListener("click", () => {
            this.selectedBand = row.band;
            localStorage.setItem(BAND_STORAGE_KEY, row.band);
            this.renderBandButtons();
            void this.refreshSelection().then(() => this.renderDashboard());
          });
        }
        tr.append(cell);
      });
      this.dashboardRows.append(tr);
    }

    const summary = rows.find((row) => row.band === this.selectedBand)!;
    const accuracy = summary.firstTryAccuracy === null
      ? "暂无"
      : `${Math.round(summary.firstTryAccuracy * 100)}%`;
    this.dashboardSummary.textContent = [
      `${getFrequencyBandDefinition(this.selectedBand).label}词`,
      `首答正确率 ${accuracy}`,
      `已练 ${summary.sessions} 局`,
      `待复习 ${summary.dueWords} 词`,
    ].join(" · ");
    await this.renderWeakWords();
    this.resetButton.disabled = false;
    this.deleteButton.disabled = this.profiles.length <= 1;
  }

  private async renderWeakWords(): Promise<void> {
    this.weakWordList.replaceChildren();
    if (!this.selectedProfileId) return;
    const records = await getWordProgress(this.selectedProfileId, this.selectedBand);
    const vocabulary = getWordsByFrequencyBand(this.selectedBand);
    const wordsById = new Map(vocabulary.map((word) => [word.id, word]));
    const weak = records
      .filter((record) => record.needsReview || record.wrong > 0)
      .sort((left, right) => Number(right.needsReview) - Number(left.needsReview)
        || right.wrong - left.wrong
        || right.lastSeenAt - left.lastSeenAt)
      .slice(0, 8);
    if (weak.length === 0) {
      this.appendEmptyWeakMessage("暂时没有待复习单词");
      return;
    }
    for (const record of weak) {
      const word = wordsById.get(record.wordId);
      if (!word) continue;
      this.weakWordList.append(this.createWeakWordRow(word, record));
    }
  }

  private createWeakWordRow(
    word: FrequencyWord,
    record: WordProgressRecord,
  ): HTMLLIElement {
    const item = document.createElement("li");
    const english = document.createElement("strong");
    const meaning = document.createElement("span");
    const status = document.createElement("em");
    english.textContent = word.english;
    meaning.textContent = word.meaningZh;
    status.textContent = record.needsReview ? "待复习" : `误击 ${record.wrong}`;
    item.append(english, meaning, status);
    return item;
  }

  private appendEmptyWeakMessage(text: string): void {
    const item = document.createElement("li");
    item.className = "is-empty";
    item.textContent = text;
    this.weakWordList.append(item);
  }

  private async handleCreateProfile(): Promise<void> {
    const name = this.profileNameInput.value.trim();
    if (!name) return;
    try {
      const profile = await createProfile(name);
      this.profiles = await listProfiles();
      this.selectedProfileId = profile.id;
      localStorage.setItem(PROFILE_STORAGE_KEY, profile.id);
      this.profileNameInput.value = "";
      this.renderProfileOptions();
      await this.refreshSelection();
      await this.renderDashboard();
      this.notify(`已新建档案：${profile.name}`, "success");
    } catch (error) {
      this.notify(error instanceof Error ? error.message : "新建档案失败", "error");
    }
  }

  private async handleExport(): Promise<void> {
    try {
      const backup = await exportProgress();
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `word-zombie-learning-${date}.json`;
      link.click();
      URL.revokeObjectURL(url);
      this.notify("学习备份已导出", "success");
    } catch (error) {
      this.notify(error instanceof Error ? error.message : "导出失败", "error");
    }
  }

  private async handleImport(): Promise<void> {
    const file = this.importInput.files?.[0];
    this.importInput.value = "";
    if (!file) return;
    if (!window.confirm("导入会替换当前设备上的全部学习档案和进度，确定继续吗？")) return;
    try {
      const result = await importProgress(await file.text());
      this.profiles = await listProfiles();
      this.selectedProfileId = this.profiles[0]?.id ?? null;
      if (!this.selectedProfileId) throw new Error("备份中没有可用学习档案");
      localStorage.setItem(PROFILE_STORAGE_KEY, this.selectedProfileId);
      this.renderProfileOptions();
      await this.refreshSelection();
      await this.renderDashboard();
      this.notify(`已恢复 ${result.profiles} 个档案、${result.wordProgress} 个单词进度`, "success");
    } catch (error) {
      this.notify(error instanceof Error ? error.message : "导入失败", "error");
    }
  }

  private async handleReset(): Promise<void> {
    if (!this.selectedProfileId) return;
    const profileName = this.selection.profileName;
    if (!window.confirm(`确定清空“${profileName}”的全部学习进度吗？此操作不可撤销。`)) return;
    await resetProfileProgress(this.selectedProfileId);
    await this.refreshSelection();
    await this.renderDashboard();
    this.notify(`已清空“${profileName}”的学习进度`, "success");
  }

  private async handleDelete(): Promise<void> {
    if (!this.selectedProfileId || this.profiles.length <= 1) return;
    const profileId = this.selectedProfileId;
    const profileName = this.selection.profileName;
    if (!window.confirm(`确定删除“${profileName}”及其全部学习记录吗？此操作不可撤销。`)) return;
    try {
      await deleteProfile(profileId);
      this.profiles = await listProfiles();
      const nextProfile = this.profiles[0];
      if (!nextProfile) throw new Error("至少需要一个学习档案");
      this.selectedProfileId = nextProfile.id;
      localStorage.setItem(PROFILE_STORAGE_KEY, nextProfile.id);
      this.renderProfileOptions();
      await this.refreshSelection();
      await this.renderDashboard();
      this.notify(`已删除“${profileName}”`, "success");
    } catch (error) {
      this.notify(error instanceof Error ? error.message : "删除档案失败", "error");
    }
  }

  private setStorageControlsEnabled(enabled: boolean): void {
    this.profileSelect.disabled = !enabled;
    this.dashboardProfileSelect.disabled = !enabled;
    this.profileNameInput.disabled = !enabled;
    this.createForm.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled = !enabled;
    this.exportButton.disabled = !enabled;
    this.importButton.disabled = !enabled;
    this.resetButton.disabled = !enabled;
    this.deleteButton.disabled = !enabled || this.profiles.length <= 1;
  }

  private handleStorageFailure(error: unknown): void {
    console.error("Learning storage is unavailable; battle start is disabled.", error);
    this.ready = false;
    this.selectedProfileId = null;
    this.selectedSummary = null;
    this.profiles = [];
    this.setStorageControlsEnabled(false);
    this.renderProfileOptions();
    this.selectedProgress.textContent = "学习记录不可用，已停止开局以避免进度丢失";
    this.courseStatus.textContent = "请退出无痕模式，允许网站保存数据后刷新页面";
    this.notify("无法打开本机学习记录，游戏不会以无保存模式运行", "error");
    this.onSelectionChange(this.selection);
  }

  private notify(text: string, state: "success" | "error"): void {
    this.message.textContent = text;
    this.message.dataset.state = state;
  }
}
