export const LANE_COUNT = 3;
export const MAX_ACTIVE_ZOMBIES = 6;
export const CHARGE_SPEED = 800;

const MATCH_ZOMBIE_COUNT = 20;

export type MatchWaveNumber = 1 | 2 | 3;

export interface MatchWavePacing {
  wave: MatchWaveNumber;
  baseSpeed: number;
  spawnIntervalMs: number;
}

export function getMatchWavePacing(
  spawnIndex: number,
  total = MATCH_ZOMBIE_COUNT,
): MatchWavePacing {
  if (!Number.isInteger(total) || total !== MATCH_ZOMBIE_COUNT) {
    throw new RangeError(`total must be exactly ${MATCH_ZOMBIE_COUNT}`);
  }
  if (!Number.isInteger(spawnIndex) || spawnIndex < 0) {
    throw new RangeError("spawnIndex must be a non-negative integer");
  }
  if (spawnIndex >= total) {
    throw new RangeError("spawnIndex must be within the match zombie count");
  }

  if (spawnIndex <= 5) {
    return { wave: 1, baseSpeed: 34, spawnIntervalMs: 1_900 };
  }
  if (spawnIndex <= 13) {
    return { wave: 2, baseSpeed: 40, spawnIntervalMs: 1_550 };
  }
  return { wave: 3, baseSpeed: 47, spawnIntervalMs: 1_250 };
}
