import type { FrequencyBand } from "../content/frequencyTypes";
import type { MasteryStage } from "../learning/mastery";

export const PROGRESS_EXPORT_FORMAT = "word-zombie-learning" as const;
export const PROGRESS_EXPORT_VERSION = 2 as const;

export type AttemptCount = 0 | 1 | 2 | 3;
export type SessionStatus = "active" | "completed";
export type LastEncounterResult = "correct" | "wrong" | "missed";

export interface ProfileRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionRecord {
  id: string;
  profileId: string;
  band: FrequencyBand;
  levelId: string;
  status: SessionStatus;
  startedAt: number;
  completedAt: number | null;
}

export interface EncounterLogRecord {
  id?: number;
  profileId: string;
  sessionId: string;
  band: FrequencyBand;
  wordId: string;
  encounterId: string;
  attempts: AttemptCount;
  correct: boolean;
  firstTryCorrect: boolean;
  masteryCredit: boolean;
  responseMs: number;
  createdAt: number;
}

export interface WordProgressRecord {
  id: string;
  profileId: string;
  wordId: string;
  band: FrequencyBand;
  seen: number;
  firstTryCorrect: number;
  /** Total incorrect shots. A missed word has zero shots but still needs review. */
  wrong: number;
  masteryStage: MasteryStage;
  needsReview: boolean;
  lastResult: LastEncounterResult;
  lastSeenAt: number;
  nextReviewAt: number;
  lastAdvancedAt: number | null;
}

export interface StartSessionInput {
  profileId: string;
  band: FrequencyBand;
  levelId: string;
  startedAt?: number;
}

export interface RecordEncounterInput {
  sessionId: string;
  profileId: string;
  band: FrequencyBand;
  wordId: string;
  encounterId: string;
  attempts: AttemptCount;
  correct: boolean;
  responseMs: number;
  createdAt?: number;
}

export interface RecordEncounterResult {
  log: EncounterLogRecord;
  wordProgress: WordProgressRecord;
}

export interface BandProgressSummary {
  profileId: string;
  band: FrequencyBand;
  totalWords: number;
  wordsSeen: number;
  unseenWords: number;
  reinforcingWords: number;
  stableWords: number;
  masteredWords: number;
  needsReviewWords: number;
  dueWords: number;
  encounters: number;
  firstTryCorrect: number;
  firstTryAccuracy: number | null;
  sessions: number;
  lastPlayedAt: number | null;
}

export interface ProgressSummary {
  profiles: number;
  sessions: number;
  encounters: number;
  wordsSeen: number;
  masteredWords: number;
  dueWords: number;
  lastPlayedAt: number | null;
}

export type ExportedEncounterLog = Omit<EncounterLogRecord, "id">;

export interface ProgressExportV2 {
  format: typeof PROGRESS_EXPORT_FORMAT;
  version: typeof PROGRESS_EXPORT_VERSION;
  exportedAt: number;
  profiles: ProfileRecord[];
  sessions: SessionRecord[];
  encounterLogs: ExportedEncounterLog[];
  wordProgress: WordProgressRecord[];
}

export interface ImportProgressResult {
  profiles: number;
  sessions: number;
  encounterLogs: number;
  wordProgress: number;
}

export type { FrequencyBand, MasteryStage };
