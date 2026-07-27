export const MIN_MASTERY_RATE = 0.7;

export type LevelStars = 0 | 1 | 2 | 3;
export type LevelFailureReason = "health" | "mastery" | null;

export interface EvaluateLevelInput {
  masteredWordCount: number;
  targetWordCount: number;
  remainingHealth: number;
}

export interface LevelEvaluation {
  passed: boolean;
  stars: LevelStars;
  masteredWordCount: number;
  targetWordCount: number;
  requiredMasteryCount: number;
  masteryRate: number;
  remainingHealth: number;
  failureReason: LevelFailureReason;
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative integer`);
  }
}

export function evaluateLevel(input: EvaluateLevelInput): LevelEvaluation {
  assertNonNegativeInteger(input.masteredWordCount, "masteredWordCount");
  assertNonNegativeInteger(input.targetWordCount, "targetWordCount");
  if (input.targetWordCount === 0) {
    throw new RangeError("targetWordCount must be greater than zero");
  }
  if (input.masteredWordCount > input.targetWordCount) {
    throw new RangeError("masteredWordCount cannot exceed targetWordCount");
  }
  if (!Number.isFinite(input.remainingHealth) || input.remainingHealth < 0) {
    throw new RangeError("remainingHealth must be a finite non-negative number");
  }

  const requiredMasteryCount = Math.ceil(input.targetWordCount * MIN_MASTERY_RATE);
  const masteryRate = input.masteredWordCount / input.targetWordCount;
  const hasHealth = input.remainingHealth > 0;
  const hasMastery = input.masteredWordCount >= requiredMasteryCount;
  const passed = hasHealth && hasMastery;
  let stars: LevelStars = 0;
  if (passed) {
    const threeStarMastery = Math.ceil(input.targetWordCount * 0.9);
    const twoStarMastery = Math.ceil(input.targetWordCount * 0.8);
    stars = input.masteredWordCount >= threeStarMastery && input.remainingHealth >= 70
      ? 3
      : input.masteredWordCount >= twoStarMastery && input.remainingHealth >= 50
        ? 2
        : 1;
  }

  return {
    passed,
    stars,
    masteredWordCount: input.masteredWordCount,
    targetWordCount: input.targetWordCount,
    requiredMasteryCount,
    masteryRate,
    remainingHealth: input.remainingHealth,
    failureReason: !hasHealth ? "health" : !hasMastery ? "mastery" : null,
  };
}

