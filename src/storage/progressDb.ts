import Dexie, { type Table } from "dexie";

import type { FrequencyBand } from "../content/frequencyTypes";
import {
  applyMasteryOutcome,
  isDueForReview,
  isMastered,
} from "../learning/mastery";
import {
  assertAttemptCount,
  countWrongAttempts,
  validateEncounterOutcome,
} from "./encounterOutcome";
import {
  PROGRESS_EXPORT_FORMAT,
  PROGRESS_EXPORT_VERSION,
  type BandProgressSummary,
  type EncounterLogRecord,
  type ExportedEncounterLog,
  type ImportProgressResult,
  type LastEncounterResult,
  type MasteryStage,
  type ProfileRecord,
  type ProgressExportV2,
  type ProgressSummary,
  type RecordEncounterInput,
  type RecordEncounterResult,
  type SessionRecord,
  type StartSessionInput,
  type WordProgressRecord,
} from "./types";

export const PROGRESS_DB_NAME = "word-zombie-learning-v2";
export const DEFAULT_PROFILE_ID = "profile-child";

export class ProgressDatabase extends Dexie {
  profiles!: Table<ProfileRecord, string>;
  sessions!: Table<SessionRecord, string>;
  encounterLogs!: Table<EncounterLogRecord, number>;
  wordProgress!: Table<WordProgressRecord, string>;

  constructor(name = PROGRESS_DB_NAME) {
    super(name);
    this.version(1).stores({
      profiles: "&id, &name, createdAt, updatedAt",
      sessions:
        "&id, profileId, band, levelId, status, startedAt, completedAt, [profileId+band]",
      encounterLogs:
        "++id, profileId, sessionId, band, wordId, encounterId, createdAt, &[sessionId+encounterId], [profileId+band], [profileId+wordId]",
      wordProgress:
        "&id, profileId, wordId, band, masteryStage, lastSeenAt, nextReviewAt, [profileId+band], [profileId+wordId], [profileId+band+nextReviewAt]",
    });
  }
}

export const progressDb = new ProgressDatabase();

function assertObject(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function assertTimestamp(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite non-negative timestamp`);
  }
}

function assertNullableTimestamp(
  value: unknown,
  field: string,
): asserts value is number | null {
  if (value !== null) assertTimestamp(value, field);
}

function assertNonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
}

function assertBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new TypeError(`${field} must be a boolean`);
}

function assertBand(value: unknown, field: string): asserts value is FrequencyBand {
  if (value !== "high" && value !== "medium" && value !== "low") {
    throw new TypeError(`${field} must be high, medium, or low`);
  }
}

function assertMasteryStage(value: unknown, field: string): asserts value is MasteryStage {
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3 && value !== 4) {
    throw new TypeError(`${field} must be between 0 and 4`);
  }
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid
    ? `${prefix}-${uuid}`
    : `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function progressKey(profileId: string, wordId: string): string {
  return `${profileId}::${wordId}`;
}

export async function ensureDefaultProfile(now = Date.now()): Promise<ProfileRecord> {
  assertTimestamp(now, "now");
  const existing = await progressDb.profiles.get(DEFAULT_PROFILE_ID);
  if (existing) return existing;

  const first = await progressDb.profiles.orderBy("createdAt").first();
  if (first) return first;

  const profile: ProfileRecord = {
    id: DEFAULT_PROFILE_ID,
    name: "孩子",
    createdAt: now,
    updatedAt: now,
  };
  await progressDb.profiles.add(profile);
  return profile;
}

export async function listProfiles(): Promise<ProfileRecord[]> {
  return progressDb.profiles.orderBy("createdAt").toArray();
}

export async function createProfile(
  name: string,
  now = Date.now(),
): Promise<ProfileRecord> {
  assertNonEmptyString(name, "name");
  assertTimestamp(now, "now");
  const normalizedName = name.trim().slice(0, 20);
  const duplicate = await progressDb.profiles.where("name").equals(normalizedName).first();
  if (duplicate) throw new Error("已有同名学习档案");

  const profile: ProfileRecord = {
    id: createId("profile"),
    name: normalizedName,
    createdAt: now,
    updatedAt: now,
  };
  await progressDb.profiles.add(profile);
  return profile;
}

export async function deleteProfile(profileId: string): Promise<void> {
  assertNonEmptyString(profileId, "profileId");
  await progressDb.transaction(
    "rw",
    progressDb.profiles,
    progressDb.sessions,
    progressDb.encounterLogs,
    progressDb.wordProgress,
    async () => {
      const profile = await progressDb.profiles.get(profileId);
      if (!profile) throw new Error("学习档案不存在");
      if (await progressDb.profiles.count() <= 1) {
        throw new Error("至少保留一个学习档案");
      }
      await Promise.all([
        progressDb.sessions.where("profileId").equals(profileId).delete(),
        progressDb.encounterLogs.where("profileId").equals(profileId).delete(),
        progressDb.wordProgress.where("profileId").equals(profileId).delete(),
      ]);
      await progressDb.profiles.delete(profileId);
    },
  );
}

export async function renameProfile(
  profileId: string,
  name: string,
  now = Date.now(),
): Promise<ProfileRecord> {
  assertNonEmptyString(profileId, "profileId");
  assertNonEmptyString(name, "name");
  const profile = await progressDb.profiles.get(profileId);
  if (!profile) throw new Error("学习档案不存在");
  const normalizedName = name.trim().slice(0, 20);
  const duplicate = await progressDb.profiles.where("name").equals(normalizedName).first();
  if (duplicate && duplicate.id !== profileId) throw new Error("已有同名学习档案");
  const updated = { ...profile, name: normalizedName, updatedAt: now };
  await progressDb.profiles.put(updated);
  return updated;
}

export async function startSession(input: StartSessionInput): Promise<SessionRecord> {
  assertNonEmptyString(input.profileId, "profileId");
  assertBand(input.band, "band");
  assertNonEmptyString(input.levelId, "levelId");
  const startedAt = input.startedAt ?? Date.now();
  assertTimestamp(startedAt, "startedAt");
  if (!await progressDb.profiles.get(input.profileId)) {
    throw new Error(`Profile not found: ${input.profileId}`);
  }

  const session: SessionRecord = {
    id: createId("session"),
    profileId: input.profileId.trim(),
    band: input.band,
    levelId: input.levelId.trim(),
    status: "active",
    startedAt,
    completedAt: null,
  };
  await progressDb.sessions.add(session);
  return session;
}

function sameEncounterLog(
  existing: EncounterLogRecord,
  input: RecordEncounterInput,
): boolean {
  return existing.sessionId === input.sessionId
    && existing.profileId === input.profileId
    && existing.band === input.band
    && existing.wordId === input.wordId
    && existing.encounterId === input.encounterId
    && existing.attempts === input.attempts
    && existing.correct === input.correct
    && existing.responseMs === input.responseMs
    && (input.createdAt === undefined || existing.createdAt === input.createdAt);
}

export async function recordEncounter(
  input: RecordEncounterInput,
): Promise<RecordEncounterResult> {
  assertNonEmptyString(input.sessionId, "sessionId");
  assertNonEmptyString(input.profileId, "profileId");
  assertBand(input.band, "band");
  assertNonEmptyString(input.wordId, "wordId");
  assertNonEmptyString(input.encounterId, "encounterId");
  assertAttemptCount(input.attempts, "attempts");
  assertBoolean(input.correct, "correct");
  assertTimestamp(input.responseMs, "responseMs");
  validateEncounterOutcome(input);
  const createdAt = input.createdAt ?? Date.now();
  assertTimestamp(createdAt, "createdAt");

  return progressDb.transaction(
    "rw",
    progressDb.sessions,
    progressDb.encounterLogs,
    progressDb.wordProgress,
    async () => {
      const session = await progressDb.sessions.get(input.sessionId);
      if (!session) throw new Error(`Session not found: ${input.sessionId}`);
      if (session.status !== "active") throw new Error("Session is already completed");
      if (session.profileId !== input.profileId || session.band !== input.band) {
        throw new Error("Encounter does not match its session profile or band");
      }
      if (createdAt < session.startedAt) {
        throw new RangeError("createdAt cannot be before the session started");
      }

      const existingLog = await progressDb.encounterLogs
        .where("[sessionId+encounterId]")
        .equals([input.sessionId, input.encounterId])
        .first();
      if (existingLog) {
        if (!sameEncounterLog(existingLog, input)) {
          throw new Error("Encounter was already recorded with different data");
        }
        const existingProgress = await progressDb.wordProgress.get(
          progressKey(input.profileId, input.wordId),
        );
        if (!existingProgress) throw new Error("Word progress is missing");
        return { log: existingLog, wordProgress: existingProgress };
      }

      const id = progressKey(input.profileId, input.wordId);
      const current = await progressDb.wordProgress.get(id);
      if (current && createdAt < current.lastSeenAt) {
        throw new RangeError("createdAt cannot be before the word was last seen");
      }
      const firstTryCorrect = input.correct && input.attempts === 1;
      const transition = applyMasteryOutcome(current ?? null, {
        correct: input.correct,
        firstTry: firstTryCorrect,
        occurredAt: createdAt,
      });
      const lastResult: LastEncounterResult = input.correct
        ? "correct"
        : input.attempts === 0
          ? "missed"
          : "wrong";
      const wordProgress: WordProgressRecord = {
        id,
        profileId: input.profileId.trim(),
        wordId: input.wordId.trim(),
        band: input.band,
        seen: (current?.seen ?? 0) + 1,
        firstTryCorrect: (current?.firstTryCorrect ?? 0) + (firstTryCorrect ? 1 : 0),
        wrong: (current?.wrong ?? 0) + countWrongAttempts(input),
        masteryStage: transition.masteryStage,
        needsReview: transition.needsReview,
        lastResult,
        lastSeenAt: createdAt,
        nextReviewAt: transition.nextReviewAt,
        lastAdvancedAt: transition.lastAdvancedAt,
      };
      const log: EncounterLogRecord = {
        profileId: input.profileId.trim(),
        sessionId: input.sessionId.trim(),
        band: input.band,
        wordId: input.wordId.trim(),
        encounterId: input.encounterId.trim(),
        attempts: input.attempts,
        correct: input.correct,
        firstTryCorrect,
        masteryCredit: transition.reviewCredited,
        responseMs: input.responseMs,
        createdAt,
      };
      const logId = await progressDb.encounterLogs.add(log);
      await progressDb.wordProgress.put(wordProgress);
      return { log: { ...log, id: logId }, wordProgress };
    },
  );
}

export async function completeSession(
  sessionId: string,
  completedAt = Date.now(),
): Promise<SessionRecord> {
  assertNonEmptyString(sessionId, "sessionId");
  assertTimestamp(completedAt, "completedAt");
  return progressDb.transaction("rw", progressDb.sessions, async () => {
    const session = await progressDb.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.status === "completed") return session;
    if (completedAt < session.startedAt) {
      throw new RangeError("completedAt cannot be before the session started");
    }
    const completed: SessionRecord = {
      ...session,
      status: "completed",
      completedAt,
    };
    await progressDb.sessions.put(completed);
    return completed;
  });
}

export async function getWordProgress(
  profileId: string,
  band?: FrequencyBand,
): Promise<WordProgressRecord[]> {
  assertNonEmptyString(profileId, "profileId");
  return band
    ? progressDb.wordProgress.where("[profileId+band]").equals([profileId, band]).toArray()
    : progressDb.wordProgress.where("profileId").equals(profileId).toArray();
}

export async function getProfileSessionCount(profileId: string): Promise<number> {
  assertNonEmptyString(profileId, "profileId");
  return progressDb.sessions.where("profileId").equals(profileId).count();
}

export async function getBandProgressSummary(
  profileId: string,
  band: FrequencyBand,
  totalWords: number,
  now = Date.now(),
): Promise<BandProgressSummary> {
  assertNonEmptyString(profileId, "profileId");
  assertBand(band, "band");
  assertNonNegativeInteger(totalWords, "totalWords");
  assertTimestamp(now, "now");
  const [words, logs, sessions] = await Promise.all([
    getWordProgress(profileId, band),
    progressDb.encounterLogs.where("[profileId+band]").equals([profileId, band]).toArray(),
    progressDb.sessions.where("[profileId+band]").equals([profileId, band]).toArray(),
  ]);
  const firstTryCorrect = logs.filter((log) => log.firstTryCorrect).length;
  const completedSessions = sessions.filter((session) => session.status === "completed");
  const lastTimes = [
    ...logs.map((log) => log.createdAt),
    ...sessions.map((session) => session.completedAt ?? session.startedAt),
  ];
  return {
    profileId,
    band,
    totalWords,
    wordsSeen: words.length,
    unseenWords: Math.max(0, totalWords - words.length),
    reinforcingWords: words.filter(
      (word) => !word.needsReview && (word.masteryStage === 1 || word.masteryStage === 2),
    ).length,
    stableWords: words.filter(
      (word) => !word.needsReview && word.masteryStage === 3,
    ).length,
    masteredWords: words.filter(isMastered).length,
    needsReviewWords: words.filter((word) => word.needsReview).length,
    dueWords: words.filter((word) => isDueForReview(word, now)).length,
    encounters: logs.length,
    firstTryCorrect,
    firstTryAccuracy: logs.length > 0 ? firstTryCorrect / logs.length : null,
    sessions: completedSessions.length,
    lastPlayedAt: lastTimes.length > 0 ? Math.max(...lastTimes) : null,
  };
}

export async function getProgressSummary(now = Date.now()): Promise<ProgressSummary> {
  const [profiles, sessions, logs, words] = await Promise.all([
    progressDb.profiles.count(),
    progressDb.sessions.toArray(),
    progressDb.encounterLogs.toArray(),
    progressDb.wordProgress.toArray(),
  ]);
  const lastTimes = [
    ...logs.map((log) => log.createdAt),
    ...sessions.map((session) => session.completedAt ?? session.startedAt),
  ];
  return {
    profiles,
    sessions: sessions.length,
    encounters: logs.length,
    wordsSeen: words.length,
    masteredWords: words.filter(isMastered).length,
    dueWords: words.filter((word) => isDueForReview(word, now)).length,
    lastPlayedAt: lastTimes.length > 0 ? Math.max(...lastTimes) : null,
  };
}

export async function resetProfileProgress(profileId: string): Promise<void> {
  assertNonEmptyString(profileId, "profileId");
  await progressDb.transaction(
    "rw",
    progressDb.sessions,
    progressDb.encounterLogs,
    progressDb.wordProgress,
    async () => {
      await Promise.all([
        progressDb.sessions.where("profileId").equals(profileId).delete(),
        progressDb.encounterLogs.where("profileId").equals(profileId).delete(),
        progressDb.wordProgress.where("profileId").equals(profileId).delete(),
      ]);
    },
  );
}

export async function exportProgress(): Promise<ProgressExportV2> {
  const [profiles, sessions, storedLogs, words] = await Promise.all([
    progressDb.profiles.toArray(),
    progressDb.sessions.toArray(),
    progressDb.encounterLogs.toArray(),
    progressDb.wordProgress.toArray(),
  ]);
  profiles.sort((left, right) => left.createdAt - right.createdAt);
  sessions.sort((left, right) => left.startedAt - right.startedAt);
  storedLogs.sort((left, right) => left.createdAt - right.createdAt);
  words.sort((left, right) => left.id.localeCompare(right.id));
  const encounterLogs: ExportedEncounterLog[] = storedLogs.map(({ id: _id, ...log }) => log);
  return {
    format: PROGRESS_EXPORT_FORMAT,
    version: PROGRESS_EXPORT_VERSION,
    exportedAt: Date.now(),
    profiles,
    sessions,
    encounterLogs,
    wordProgress: words,
  };
}

function readProfile(value: unknown, index: number): ProfileRecord {
  const field = `profiles[${index}]`;
  assertObject(value, field);
  assertNonEmptyString(value.id, `${field}.id`);
  assertNonEmptyString(value.name, `${field}.name`);
  assertTimestamp(value.createdAt, `${field}.createdAt`);
  assertTimestamp(value.updatedAt, `${field}.updatedAt`);
  return {
    id: value.id.trim(),
    name: value.name.trim().slice(0, 20),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function readSession(value: unknown, index: number): SessionRecord {
  const field = `sessions[${index}]`;
  assertObject(value, field);
  assertNonEmptyString(value.id, `${field}.id`);
  assertNonEmptyString(value.profileId, `${field}.profileId`);
  assertBand(value.band, `${field}.band`);
  assertNonEmptyString(value.levelId, `${field}.levelId`);
  if (value.status !== "active" && value.status !== "completed") {
    throw new TypeError(`${field}.status is invalid`);
  }
  assertTimestamp(value.startedAt, `${field}.startedAt`);
  assertNullableTimestamp(value.completedAt, `${field}.completedAt`);
  return {
    id: value.id.trim(),
    profileId: value.profileId.trim(),
    band: value.band,
    levelId: value.levelId.trim(),
    status: value.status,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
  };
}

function readLog(value: unknown, index: number): ExportedEncounterLog {
  const field = `encounterLogs[${index}]`;
  assertObject(value, field);
  assertNonEmptyString(value.profileId, `${field}.profileId`);
  assertNonEmptyString(value.sessionId, `${field}.sessionId`);
  assertBand(value.band, `${field}.band`);
  assertNonEmptyString(value.wordId, `${field}.wordId`);
  assertNonEmptyString(value.encounterId, `${field}.encounterId`);
  assertAttemptCount(value.attempts, `${field}.attempts`);
  assertBoolean(value.correct, `${field}.correct`);
  assertBoolean(value.firstTryCorrect, `${field}.firstTryCorrect`);
  assertBoolean(value.masteryCredit, `${field}.masteryCredit`);
  assertTimestamp(value.responseMs, `${field}.responseMs`);
  assertTimestamp(value.createdAt, `${field}.createdAt`);
  validateEncounterOutcome({ attempts: value.attempts, correct: value.correct });
  return {
    profileId: value.profileId.trim(),
    sessionId: value.sessionId.trim(),
    band: value.band,
    wordId: value.wordId.trim(),
    encounterId: value.encounterId.trim(),
    attempts: value.attempts,
    correct: value.correct,
    firstTryCorrect: value.firstTryCorrect,
    masteryCredit: value.masteryCredit,
    responseMs: value.responseMs,
    createdAt: value.createdAt,
  };
}

function readWord(value: unknown, index: number): WordProgressRecord {
  const field = `wordProgress[${index}]`;
  assertObject(value, field);
  assertNonEmptyString(value.id, `${field}.id`);
  assertNonEmptyString(value.profileId, `${field}.profileId`);
  assertNonEmptyString(value.wordId, `${field}.wordId`);
  assertBand(value.band, `${field}.band`);
  assertNonNegativeInteger(value.seen, `${field}.seen`);
  assertNonNegativeInteger(value.firstTryCorrect, `${field}.firstTryCorrect`);
  assertNonNegativeInteger(value.wrong, `${field}.wrong`);
  assertMasteryStage(value.masteryStage, `${field}.masteryStage`);
  assertBoolean(value.needsReview, `${field}.needsReview`);
  if (value.lastResult !== "correct" && value.lastResult !== "wrong" && value.lastResult !== "missed") {
    throw new TypeError(`${field}.lastResult is invalid`);
  }
  assertTimestamp(value.lastSeenAt, `${field}.lastSeenAt`);
  assertTimestamp(value.nextReviewAt, `${field}.nextReviewAt`);
  assertNullableTimestamp(value.lastAdvancedAt, `${field}.lastAdvancedAt`);
  return {
    id: value.id.trim(),
    profileId: value.profileId.trim(),
    wordId: value.wordId.trim(),
    band: value.band,
    seen: value.seen,
    firstTryCorrect: value.firstTryCorrect,
    wrong: value.wrong,
    masteryStage: value.masteryStage,
    needsReview: value.needsReview,
    lastResult: value.lastResult,
    lastSeenAt: value.lastSeenAt,
    nextReviewAt: value.nextReviewAt,
    lastAdvancedAt: value.lastAdvancedAt,
  };
}

function parseProgressExport(payload: unknown): ProgressExportV2 {
  let parsed = payload;
  if (typeof payload === "string") {
    try {
      parsed = JSON.parse(payload) as unknown;
    } catch {
      throw new TypeError("学习备份不是有效 JSON 文件");
    }
  }
  assertObject(parsed, "progress import");
  if (parsed.format !== PROGRESS_EXPORT_FORMAT || parsed.version !== PROGRESS_EXPORT_VERSION) {
    throw new TypeError("这不是当前版本的单词大战僵尸学习备份");
  }
  if (!Array.isArray(parsed.profiles)
    || !Array.isArray(parsed.sessions)
    || !Array.isArray(parsed.encounterLogs)
    || !Array.isArray(parsed.wordProgress)) {
    throw new TypeError("学习备份结构不完整");
  }
  assertTimestamp(parsed.exportedAt, "exportedAt");
  const profiles = parsed.profiles.map(readProfile);
  const sessions = parsed.sessions.map(readSession);
  const encounterLogs = parsed.encounterLogs.map(readLog);
  const wordProgress = parsed.wordProgress.map(readWord);
  if (profiles.length === 0) throw new RangeError("学习备份至少要有一个档案");
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const sessionIds = new Set(sessions.map((session) => session.id));
  const wordIds = new Set(wordProgress.map((word) => word.id));
  if (profileIds.size !== profiles.length || sessionIds.size !== sessions.length || wordIds.size !== wordProgress.length) {
    throw new RangeError("学习备份包含重复记录");
  }
  for (const session of sessions) {
    if (!profileIds.has(session.profileId)) throw new RangeError("学习局引用了不存在的档案");
  }
  for (const log of encounterLogs) {
    if (!profileIds.has(log.profileId) || !sessionIds.has(log.sessionId)) {
      throw new RangeError("答题记录引用了不存在的档案或学习局");
    }
  }
  for (const word of wordProgress) {
    if (!profileIds.has(word.profileId)) throw new RangeError("单词进度引用了不存在的档案");
    if (word.id !== progressKey(word.profileId, word.wordId)) {
      throw new RangeError("单词进度主键不匹配");
    }
  }
  return {
    format: PROGRESS_EXPORT_FORMAT,
    version: PROGRESS_EXPORT_VERSION,
    exportedAt: parsed.exportedAt,
    profiles,
    sessions,
    encounterLogs,
    wordProgress,
  };
}

export async function importProgress(payload: unknown): Promise<ImportProgressResult> {
  const imported = parseProgressExport(payload);
  await progressDb.transaction(
    "rw",
    progressDb.profiles,
    progressDb.sessions,
    progressDb.encounterLogs,
    progressDb.wordProgress,
    async () => {
      await Promise.all([
        progressDb.profiles.clear(),
        progressDb.sessions.clear(),
        progressDb.encounterLogs.clear(),
        progressDb.wordProgress.clear(),
      ]);
      await progressDb.profiles.bulkAdd(imported.profiles);
      if (imported.sessions.length) await progressDb.sessions.bulkAdd(imported.sessions);
      if (imported.encounterLogs.length) await progressDb.encounterLogs.bulkAdd(imported.encounterLogs);
      if (imported.wordProgress.length) await progressDb.wordProgress.bulkAdd(imported.wordProgress);
    },
  );
  return {
    profiles: imported.profiles.length,
    sessions: imported.sessions.length,
    encounterLogs: imported.encounterLogs.length,
    wordProgress: imported.wordProgress.length,
  };
}

export async function resetProgress(): Promise<void> {
  await progressDb.delete();
  await progressDb.open();
  await ensureDefaultProfile();
}
