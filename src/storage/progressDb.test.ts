import "fake-indexeddb/auto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  completeSession,
  createProfile,
  deleteProfile,
  ensureDefaultProfile,
  getBandProgressSummary,
  getProfileSessionCount,
  listProfiles,
  progressDb,
  recordEncounter,
  startSession,
} from "./progressDb";

describe("learning profile storage", () => {
  beforeEach(async () => {
    await progressDb.delete();
    await progressDb.open();
  });

  afterAll(async () => {
    await progressDb.delete();
  });

  it("counts only completed rounds in the learning dashboard", async () => {
    const profile = await ensureDefaultProfile(1_000);
    const session = await startSession({
      profileId: profile.id,
      band: "high",
      levelId: "round-1",
      startedAt: 2_000,
    });

    expect((await getBandProgressSummary(profile.id, "high", 660, 2_500)).sessions).toBe(0);
    await completeSession(session.id, 3_000);
    expect((await getBandProgressSummary(profile.id, "high", 660, 3_500)).sessions).toBe(1);
  });

  it("deletes one profile with all dependent records without touching another", async () => {
    const child = await ensureDefaultProfile(1_000);
    const friend = await createProfile("朋友", 1_100);
    const childSession = await startSession({
      profileId: child.id,
      band: "high",
      levelId: "child-round",
      startedAt: 2_000,
    });
    const friendSession = await startSession({
      profileId: friend.id,
      band: "high",
      levelId: "friend-round",
      startedAt: 2_100,
    });
    await recordEncounter({
      sessionId: childSession.id,
      profileId: child.id,
      band: "high",
      wordId: "child-word",
      encounterId: "child-encounter",
      attempts: 1,
      correct: true,
      responseMs: 800,
      createdAt: 2_200,
    });
    await recordEncounter({
      sessionId: friendSession.id,
      profileId: friend.id,
      band: "high",
      wordId: "friend-word",
      encounterId: "friend-encounter",
      attempts: 1,
      correct: true,
      responseMs: 900,
      createdAt: 2_300,
    });

    await deleteProfile(friend.id);

    expect((await listProfiles()).map((profile) => profile.id)).toEqual([child.id]);
    expect(await getProfileSessionCount(friend.id)).toBe(0);
    expect(await getProfileSessionCount(child.id)).toBe(1);
    expect(await progressDb.encounterLogs.where("profileId").equals(friend.id).count()).toBe(0);
    expect(await progressDb.wordProgress.where("profileId").equals(friend.id).count()).toBe(0);
    expect(await progressDb.encounterLogs.where("profileId").equals(child.id).count()).toBe(1);
  });

  it("never deletes the last learning profile", async () => {
    const profile = await ensureDefaultProfile(1_000);
    await expect(deleteProfile(profile.id)).rejects.toThrow("至少保留一个学习档案");
    expect(await listProfiles()).toHaveLength(1);
  });
});
