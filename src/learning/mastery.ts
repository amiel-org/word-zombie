export type MasteryStage = 0 | 1 | 2 | 3 | 4;

export const DAY_MS = 24 * 60 * 60 * 1_000;

export const REVIEW_INTERVAL_DAYS: Readonly<Record<Exclude<MasteryStage, 0>, number>> = {
  1: 3,
  2: 14,
  3: 45,
  4: 90,
};

export interface MasteryState {
  readonly masteryStage: MasteryStage;
  readonly needsReview: boolean;
  readonly nextReviewAt: number;
  readonly lastAdvancedAt: number | null;
}

export interface MasteryOutcome {
  readonly correct: boolean;
  readonly firstTry: boolean;
  readonly occurredAt: number;
}

export interface MasteryTransition extends MasteryState {
  readonly reviewCredited: boolean;
  readonly stageChanged: boolean;
}

function assertTimestamp(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("occurredAt must be a finite non-negative timestamp");
  }
}

function nextStage(stage: MasteryStage): MasteryStage {
  return Math.min(4, stage + 1) as MasteryStage;
}

function previousStage(stage: MasteryStage): MasteryStage {
  return Math.max(0, stage - 1) as MasteryStage;
}

export function applyMasteryOutcome(
  current: MasteryState | null,
  outcome: MasteryOutcome,
): MasteryTransition {
  assertTimestamp(outcome.occurredAt);
  const currentStage = current?.masteryStage ?? 0;

  if (!outcome.correct || !outcome.firstTry) {
    const masteryStage = previousStage(currentStage);
    return {
      masteryStage,
      needsReview: true,
      nextReviewAt: outcome.occurredAt,
      lastAdvancedAt: current?.lastAdvancedAt ?? null,
      reviewCredited: false,
      stageChanged: masteryStage !== currentStage,
    };
  }

  const isDue = current === null
    || current.needsReview
    || current.nextReviewAt <= outcome.occurredAt;
  if (!isDue) {
    return {
      masteryStage: currentStage,
      needsReview: current?.needsReview ?? false,
      nextReviewAt: current?.nextReviewAt ?? outcome.occurredAt,
      lastAdvancedAt: current?.lastAdvancedAt ?? null,
      reviewCredited: false,
      stageChanged: false,
    };
  }

  const masteryStage = nextStage(currentStage);
  const intervalDays = REVIEW_INTERVAL_DAYS[
    masteryStage as Exclude<MasteryStage, 0>
  ];
  return {
    masteryStage,
    needsReview: false,
    nextReviewAt: outcome.occurredAt + intervalDays * DAY_MS,
    lastAdvancedAt: outcome.occurredAt,
    reviewCredited: true,
    stageChanged: masteryStage !== currentStage,
  };
}

export function isDueForReview(
  state: Pick<MasteryState, "needsReview" | "nextReviewAt">,
  now: number,
): boolean {
  assertTimestamp(now);
  return state.needsReview || state.nextReviewAt <= now;
}

export function isMastered(
  state: Pick<MasteryState, "masteryStage" | "needsReview">,
): boolean {
  return state.masteryStage === 4 && !state.needsReview;
}
