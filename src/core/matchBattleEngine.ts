export const MATCH_INITIAL_WALL_HP = 100;
export const MATCH_BREACH_DAMAGE = 15;
export const MATCH_BASE_HIT_SCORE = 100;
export const MATCH_STREAK_BONUS = 25;
export const MATCH_MAX_STREAK_BONUS = 100;

export type MatchZombieStatus =
  | "approaching"
  | "charging"
  | "defeated"
  | "breached";

export type MatchBreachReason = "wrong-charge" | "natural";

export interface MatchZombie {
  id: string;
  targetId: string;
  status: MatchZombieStatus;
  attempts: 0 | 1;
  breachReason: MatchBreachReason | null;
}

export interface MatchBattleState {
  wallHp: number;
  zombies: MatchZombie[];
  loadedTargetId: string | null;
  resolved: number;
  correct: number;
  wrong: number;
  breach: number;
  streak: number;
  score: number;
}

export interface SpawnMatchZombieInput {
  zombieId: string;
  targetId: string;
}

export interface MatchHitEvent {
  type: "hit";
  zombieId: string;
  targetId: string;
  attempts: 1;
  points: number;
  comboBonus: number;
  streak: number;
  score: number;
}

export interface MatchWrongEvent {
  type: "wrong";
  zombieId: string;
  selectedTargetId: string;
  zombieTargetId: string;
  attempts: 1;
}

export interface MatchBreachEvent {
  type: "breached";
  zombieId: string;
  targetId: string;
  reason: MatchBreachReason;
  attempts: 0 | 1;
  damage: number;
  remainingWallHp: number;
}

export type MatchFireEvent = MatchHitEvent | MatchWrongEvent;
export type MatchBattleEvent = MatchFireEvent | MatchBreachEvent;

export interface MatchTransition<TEvent extends MatchBattleEvent = MatchBattleEvent> {
  state: MatchBattleState;
  event: TEvent;
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new RangeError(`${field} must not be empty`);
  }
}

function findZombieIndex(state: MatchBattleState, zombieId: string): number {
  assertNonEmpty(zombieId, "zombieId");
  const index = state.zombies.findIndex((zombie) => zombie.id === zombieId);
  if (index === -1) {
    throw new Error(`Unknown zombieId: ${zombieId}`);
  }
  return index;
}

function replaceZombie(
  state: MatchBattleState,
  index: number,
  zombie: MatchZombie,
): MatchZombie[] {
  return state.zombies.map((current, currentIndex) =>
    currentIndex === index ? zombie : current,
  );
}

export function createMatchBattleState(): MatchBattleState {
  return {
    wallHp: MATCH_INITIAL_WALL_HP,
    zombies: [],
    loadedTargetId: null,
    resolved: 0,
    correct: 0,
    wrong: 0,
    breach: 0,
    streak: 0,
    score: 0,
  };
}

export function spawnZombies(
  current: MatchBattleState,
  inputs: readonly SpawnMatchZombieInput[],
): MatchBattleState {
  if (inputs.length === 0) {
    throw new RangeError("At least one zombie is required");
  }

  const zombieIds = new Set(current.zombies.map((zombie) => zombie.id));
  const targetIds = new Set(current.zombies.map((zombie) => zombie.targetId));
  const spawned = inputs.map(({ zombieId, targetId }) => {
    assertNonEmpty(zombieId, "zombieId");
    assertNonEmpty(targetId, "targetId");
    if (zombieIds.has(zombieId)) {
      throw new Error(`Duplicate zombieId: ${zombieId}`);
    }
    if (targetIds.has(targetId)) {
      throw new Error(`Duplicate targetId: ${targetId}`);
    }
    zombieIds.add(zombieId);
    targetIds.add(targetId);
    return {
      id: zombieId,
      targetId,
      status: "approaching" as const,
      attempts: 0 as const,
      breachReason: null,
    };
  });

  return {
    ...current,
    zombies: [...current.zombies, ...spawned],
  };
}

export function spawnZombie(
  current: MatchBattleState,
  input: SpawnMatchZombieInput,
): MatchBattleState {
  return spawnZombies(current, [input]);
}

export function loadAmmo(
  current: MatchBattleState,
  targetId: string,
): MatchBattleState {
  assertNonEmpty(targetId, "targetId");
  if (current.loadedTargetId !== null) {
    throw new Error("Ammo is already loaded");
  }

  const hasAvailableAmmo = current.zombies.some(
    (zombie) =>
      zombie.targetId === targetId && zombie.status === "approaching",
  );
  if (!hasAvailableAmmo) {
    throw new Error(`No approaching zombie has targetId: ${targetId}`);
  }

  return {
    ...current,
    loadedTargetId: targetId,
  };
}

export function fireAtZombie(
  current: MatchBattleState,
  zombieId: string,
): MatchTransition<MatchFireEvent> {
  if (current.loadedTargetId === null) {
    throw new Error("Cannot fire without loaded ammo");
  }

  const index = findZombieIndex(current, zombieId);
  const zombie = current.zombies[index];
  if (zombie.status !== "approaching") {
    throw new Error(`Cannot fire at a ${zombie.status} zombie`);
  }

  const loadedTargetId = current.loadedTargetId;
  const ammoTargetIsApproaching = current.zombies.some(
    (candidate) =>
      candidate.targetId === loadedTargetId &&
      candidate.status === "approaching",
  );
  if (!ammoTargetIsApproaching) {
    throw new Error(`Loaded ammo is no longer available: ${loadedTargetId}`);
  }

  if (zombie.targetId === loadedTargetId) {
    const comboBonus = Math.min(
      MATCH_MAX_STREAK_BONUS,
      current.streak * MATCH_STREAK_BONUS,
    );
    const points = MATCH_BASE_HIT_SCORE + comboBonus;
    const defeated: MatchZombie = {
      ...zombie,
      status: "defeated",
      attempts: 1,
    };
    const score = current.score + points;
    const streak = current.streak + 1;
    return {
      state: {
        ...current,
        zombies: replaceZombie(current, index, defeated),
        loadedTargetId: null,
        resolved: current.resolved + 1,
        correct: current.correct + 1,
        streak,
        score,
      },
      event: {
        type: "hit",
        zombieId: zombie.id,
        targetId: zombie.targetId,
        attempts: 1,
        points,
        comboBonus,
        streak,
        score,
      },
    };
  }

  const charging: MatchZombie = {
    ...zombie,
    status: "charging",
    attempts: 1,
  };
  return {
    state: {
      ...current,
      zombies: replaceZombie(current, index, charging),
      loadedTargetId: null,
      wrong: current.wrong + 1,
      streak: 0,
    },
    event: {
      type: "wrong",
      zombieId: zombie.id,
      selectedTargetId: loadedTargetId,
      zombieTargetId: zombie.targetId,
      attempts: 1,
    },
  };
}

export function resolveBreach(
  current: MatchBattleState,
  zombieId: string,
): MatchTransition<MatchBreachEvent> {
  const index = findZombieIndex(current, zombieId);
  const zombie = current.zombies[index];
  if (zombie.status !== "approaching" && zombie.status !== "charging") {
    throw new Error(`Cannot breach a ${zombie.status} zombie`);
  }

  const reason: MatchBreachReason =
    zombie.status === "charging" ? "wrong-charge" : "natural";
  const attempts: 0 | 1 = reason === "wrong-charge" ? 1 : 0;
  const remainingWallHp = Math.max(0, current.wallHp - MATCH_BREACH_DAMAGE);
  const breached: MatchZombie = {
    ...zombie,
    status: "breached",
    attempts,
    breachReason: reason,
  };

  return {
    state: {
      ...current,
      wallHp: remainingWallHp,
      zombies: replaceZombie(current, index, breached),
      loadedTargetId:
        current.loadedTargetId === zombie.targetId
          ? null
          : current.loadedTargetId,
      resolved: current.resolved + 1,
      breach: current.breach + 1,
    },
    event: {
      type: "breached",
      zombieId: zombie.id,
      targetId: zombie.targetId,
      reason,
      attempts,
      damage: MATCH_BREACH_DAMAGE,
      remainingWallHp,
    },
  };
}
