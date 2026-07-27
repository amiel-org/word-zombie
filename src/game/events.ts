import type { LevelFailureReason, LevelStars } from "../core/levelEvaluation";
import type { FrequencyBand } from "../content/frequencyTypes";
import type { MatchLevelContent } from "../content/matchContentTypes";
import type { WeaponId, WeaponSelection } from "./arsenal";
import type { BattleMapId } from "./battleMaps";

export type BattlePhase = "ready" | "playing" | "reviewing" | "complete" | "failed";
export type BattleZombieStatus = "approaching" | "charging";

export interface BattleCorrectionView {
  targetId: string;
  english: string;
  phonetic: string;
  meaningZh: string;
  reason: "wrong-charge" | "natural";
  reviewIndex: number;
  reviewTotal: number;
}

export interface PronunciationCue {
  targetId: string;
  english: string;
  phonetic: string;
  meaningZh: string;
  source: "correct" | "correction";
}

export type BattleSoundCue =
  | "start"
  | "load"
  | "shot"
  | "correct"
  | "wrong"
  | "breach"
  | "confirm"
  | "victory"
  | "failure";

export interface BattleZombieView {
  id: string;
  targetId: string;
  prompt: string;
  x: number;
  y: number;
  lane: number;
  status: BattleZombieStatus;
}

export interface AmmoView {
  targetId: string;
  label: string;
}

export interface BattleViewState {
  phase: BattlePhase;
  health: number;
  resolvedCount: number;
  encounterCount: number;
  spawnedCount: number;
  activeZombieCount: number;
  zombies: readonly BattleZombieView[];
  ammo: readonly AmmoView[];
  loadedTargetId: string | null;
  feedback: string;
  score: number;
  streak: number;
  canLoadAmmo: boolean;
  defeatedCount: number;
  wrongAttempts: number;
  breachCount: number;
  firstTryCorrectCount: number;
  targetWordCount: number;
  stars: LevelStars;
  failureReason: LevelFailureReason;
  weaponId: WeaponId;
  mapId: BattleMapId;
  progressSaveFailed: boolean;
  correction: BattleCorrectionView | null;
}

export interface StartEventDetail {
  weaponSelection: WeaponSelection;
  sessionId: string;
  profileId: string;
  band: FrequencyBand;
  mapId: BattleMapId;
  content: MatchLevelContent;
}

export interface AmmoSelectEventDetail {
  targetId: string;
}

export interface ZombieSelectEventDetail {
  zombieId: string;
}

export interface DragFireEventDetail {
  targetId: string;
  zombieId: string;
}

export const gameEvents = new EventTarget();

export function emitBattleState(state: BattleViewState): void {
  gameEvents.dispatchEvent(
    new CustomEvent<BattleViewState>("battle-state", { detail: state }),
  );
}

export function emitStart(detail: StartEventDetail): void {
  gameEvents.dispatchEvent(
    new CustomEvent<StartEventDetail>("battle-start", {
      detail,
    }),
  );
}

export function emitAmmoSelect(targetId: string): void {
  gameEvents.dispatchEvent(
    new CustomEvent<AmmoSelectEventDetail>("battle-ammo-select", {
      detail: { targetId },
    }),
  );
}

export function emitZombieSelect(zombieId: string): void {
  gameEvents.dispatchEvent(
    new CustomEvent<ZombieSelectEventDetail>("battle-zombie-select", {
      detail: { zombieId },
    }),
  );
}

export function emitDragFire(targetId: string, zombieId: string): void {
  gameEvents.dispatchEvent(
    new CustomEvent<DragFireEventDetail>("battle-drag-fire", {
      detail: { targetId, zombieId },
    }),
  );
}

export function emitCorrectionConfirm(): void {
  gameEvents.dispatchEvent(new Event("battle-correction-confirm"));
}

export function emitPronunciationCue(cue: PronunciationCue): void {
  gameEvents.dispatchEvent(
    new CustomEvent<PronunciationCue>("battle-pronunciation", { detail: cue }),
  );
}

export function emitBattleSound(cue: BattleSoundCue): void {
  gameEvents.dispatchEvent(
    new CustomEvent<BattleSoundCue>("battle-sound", { detail: cue }),
  );
}

export function emitLearningProgressChanged(): void {
  gameEvents.dispatchEvent(new Event("learning-progress-changed"));
}
