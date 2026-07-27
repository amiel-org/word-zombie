import { describe, expect, it } from "vitest";

import {
  createMatchBattleState,
  fireAtZombie,
  loadAmmo,
  MATCH_BREACH_DAMAGE,
  resolveBreach,
  spawnZombie,
  spawnZombies,
} from "./matchBattleEngine";

function spawnThree() {
  return spawnZombies(createMatchBattleState(), [
    { zombieId: "zombie-a", targetId: "heritage" },
    { zombieId: "zombie-b", targetId: "preserve" },
    { zombieId: "zombie-c", targetId: "balance" },
  ]);
}

describe("matchBattleEngine", () => {
  it("starts with a 100 HP wall and empty counters", () => {
    expect(createMatchBattleState()).toEqual({
      wallHp: 100,
      zombies: [],
      loadedTargetId: null,
      resolved: 0,
      correct: 0,
      wrong: 0,
      breach: 0,
      streak: 0,
      score: 0,
    });
  });

  it("spawns multiple approaching zombies in one immutable update", () => {
    const initial = createMatchBattleState();
    const state = spawnZombies(initial, [
      { zombieId: "zombie-a", targetId: "heritage" },
      { zombieId: "zombie-b", targetId: "preserve" },
    ]);

    expect(initial.zombies).toEqual([]);
    expect(state.zombies).toEqual([
      {
        id: "zombie-a",
        targetId: "heritage",
        status: "approaching",
        attempts: 0,
        breachReason: null,
      },
      {
        id: "zombie-b",
        targetId: "preserve",
        status: "approaching",
        attempts: 0,
        breachReason: null,
      },
    ]);
  });

  it("rejects duplicate zombie and target ids, including within one batch", () => {
    const current = spawnZombie(createMatchBattleState(), {
      zombieId: "zombie-a",
      targetId: "heritage",
    });

    expect(() =>
      spawnZombie(current, {
        zombieId: "zombie-a",
        targetId: "preserve",
      }),
    ).toThrow("Duplicate zombieId");
    expect(() =>
      spawnZombie(current, {
        zombieId: "zombie-b",
        targetId: "heritage",
      }),
    ).toThrow("Duplicate targetId");
    expect(() =>
      spawnZombies(createMatchBattleState(), [
        { zombieId: "zombie-a", targetId: "heritage" },
        { zombieId: "zombie-b", targetId: "heritage" },
      ]),
    ).toThrow("Duplicate targetId");
  });

  it("loads only ammo belonging to an approaching target", () => {
    const current = spawnThree();
    const loaded = loadAmmo(current, "preserve");

    expect(loaded.loadedTargetId).toBe("preserve");
    expect(current.loadedTargetId).toBeNull();
    expect(() => loadAmmo(current, "missing")).toThrow(
      "No approaching zombie has targetId",
    );
    expect(() => loadAmmo(loaded, "balance")).toThrow(
      "Ammo is already loaded",
    );
  });

  it("defeats the matching zombie on one shot and updates score counters", () => {
    const initial = spawnThree();
    const transition = fireAtZombie(loadAmmo(initial, "preserve"), "zombie-b");

    expect(transition.state).toMatchObject({
      loadedTargetId: null,
      resolved: 1,
      correct: 1,
      wrong: 0,
      breach: 0,
      streak: 1,
      score: 100,
    });
    expect(transition.state.zombies[1]).toMatchObject({
      status: "defeated",
      attempts: 1,
    });
    expect(transition.event).toEqual({
      type: "hit",
      zombieId: "zombie-b",
      targetId: "preserve",
      attempts: 1,
      points: 100,
      comboBonus: 0,
      streak: 1,
      score: 100,
    });
    expect(initial.zombies[1].status).toBe("approaching");
  });

  it("caps the consecutive-hit bonus at 100 points", () => {
    const spawned = spawnZombies(createMatchBattleState(),
      Array.from({ length: 6 }, (_, index) => ({
        zombieId: `zombie-${index}`,
        targetId: `target-${index}`,
      })),
    );
    let state = spawned;
    const points: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const transition = fireAtZombie(
        loadAmmo(state, `target-${index}`),
        `zombie-${index}`,
      );
      points.push(transition.event.type === "hit" ? transition.event.points : 0);
      state = transition.state;
    }

    expect(points).toEqual([100, 125, 150, 175, 200, 200]);
    expect(state).toMatchObject({
      resolved: 6,
      correct: 6,
      streak: 6,
      score: 950,
    });
  });

  it("charges only the wrongly selected zombie and leaves the ammo target approaching", () => {
    const initial = spawnThree();
    const transition = fireAtZombie(loadAmmo(initial, "heritage"), "zombie-b");

    expect(transition.event).toEqual({
      type: "wrong",
      zombieId: "zombie-b",
      selectedTargetId: "heritage",
      zombieTargetId: "preserve",
      attempts: 1,
    });
    expect(transition.state).toMatchObject({
      loadedTargetId: null,
      resolved: 0,
      correct: 0,
      wrong: 1,
      streak: 0,
      score: 0,
    });
    expect(transition.state.zombies[0].status).toBe("approaching");
    expect(transition.state.zombies[1]).toMatchObject({
      status: "charging",
      attempts: 1,
    });

    expect(loadAmmo(transition.state, "heritage").loadedTargetId).toBe(
      "heritage",
    );
  });

  it("resets an existing streak after a wrong selection", () => {
    const afterHit = fireAtZombie(
      loadAmmo(spawnThree(), "heritage"),
      "zombie-a",
    ).state;
    const afterWrong = fireAtZombie(
      loadAmmo(afterHit, "balance"),
      "zombie-b",
    ).state;

    expect(afterHit.streak).toBe(1);
    expect(afterWrong).toMatchObject({ streak: 0, wrong: 1, score: 100 });
  });

  it("allows only a single shot at charging, defeated, or breached zombies", () => {
    const spawned = spawnThree();
    const charging = fireAtZombie(
      loadAmmo(spawned, "heritage"),
      "zombie-b",
    ).state;
    expect(() =>
      fireAtZombie(loadAmmo(charging, "balance"), "zombie-b"),
    ).toThrow("Cannot fire at a charging zombie");

    const defeated = fireAtZombie(
      loadAmmo(spawned, "heritage"),
      "zombie-a",
    ).state;
    expect(() =>
      fireAtZombie(loadAmmo(defeated, "preserve"), "zombie-a"),
    ).toThrow("Cannot fire at a defeated zombie");

    const breached = resolveBreach(spawned, "zombie-c").state;
    expect(() =>
      fireAtZombie(loadAmmo(breached, "heritage"), "zombie-c"),
    ).toThrow("Cannot fire at a breached zombie");
  });

  it("distinguishes wrong-charge and natural breaches for persistence", () => {
    const charging = fireAtZombie(
      loadAmmo(spawnThree(), "heritage"),
      "zombie-b",
    ).state;
    const chargedBreach = resolveBreach(charging, "zombie-b");

    expect(chargedBreach.event).toEqual({
      type: "breached",
      zombieId: "zombie-b",
      targetId: "preserve",
      reason: "wrong-charge",
      attempts: 1,
      damage: MATCH_BREACH_DAMAGE,
      remainingWallHp: 85,
    });
    expect(chargedBreach.state).toMatchObject({
      wallHp: 85,
      resolved: 1,
      wrong: 1,
      breach: 1,
    });

    const naturalBreach = resolveBreach(
      chargedBreach.state,
      "zombie-c",
    );
    expect(naturalBreach.event).toMatchObject({
      reason: "natural",
      attempts: 0,
      remainingWallHp: 70,
    });
    expect(naturalBreach.state).toMatchObject({
      wallHp: 70,
      resolved: 2,
      breach: 2,
    });
  });

  it("never reduces wall health below zero", () => {
    let state = spawnZombies(
      createMatchBattleState(),
      Array.from({ length: 7 }, (_, index) => ({
        zombieId: `zombie-${index}`,
        targetId: `target-${index}`,
      })),
    );
    for (let index = 0; index < 7; index += 1) {
      state = resolveBreach(state, `zombie-${index}`).state;
    }

    expect(state.wallHp).toBe(0);
    expect(state.breach).toBe(7);
    expect(state.resolved).toBe(7);
  });

  it("clears loaded ammo when its approaching target naturally breaches", () => {
    const loaded = loadAmmo(spawnThree(), "balance");
    const transition = resolveBreach(loaded, "zombie-c");

    expect(transition.state.loadedTargetId).toBeNull();
    expect(() => loadAmmo(transition.state, "balance")).toThrow(
      "No approaching zombie has targetId",
    );
  });

  it("rejects invalid operations without changing the prior state", () => {
    const current = spawnThree();
    const snapshot = structuredClone(current);

    expect(() => fireAtZombie(current, "zombie-a")).toThrow(
      "Cannot fire without loaded ammo",
    );
    expect(() => resolveBreach(current, "missing")).toThrow(
      "Unknown zombieId",
    );
    expect(() => spawnZombies(current, [])).toThrow("At least one zombie");
    expect(current).toEqual(snapshot);

    const defeated = fireAtZombie(
      loadAmmo(current, "heritage"),
      "zombie-a",
    ).state;
    expect(() => resolveBreach(defeated, "zombie-a")).toThrow(
      "Cannot breach a defeated zombie",
    );
  });

  it("round-trips concurrent state and persistence events through JSON", () => {
    const wrong = fireAtZombie(
      loadAmmo(spawnThree(), "heritage"),
      "zombie-b",
    );
    const breached = resolveBreach(wrong.state, "zombie-b");

    expect(JSON.parse(JSON.stringify(breached.state))).toEqual(breached.state);
    expect(JSON.parse(JSON.stringify(breached.event))).toEqual(breached.event);
  });
});
