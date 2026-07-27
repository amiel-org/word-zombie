import { describe, expect, it } from "vitest";

import {
  applyMasteryOutcome,
  DAY_MS,
  isDueForReview,
  isMastered,
  type MasteryState,
} from "./mastery";

const DAY = DAY_MS;

function correctAt(current: MasteryState | null, day: number) {
  return applyMasteryOutcome(current, {
    correct: true,
    firstTry: true,
    occurredAt: day * DAY,
  });
}

describe("spaced mastery", () => {
  it("requires 3, 14, and 45 day spacing before mastery", () => {
    const initial = correctAt(null, 0);
    expect(initial).toMatchObject({ masteryStage: 1, nextReviewAt: 3 * DAY });

    const reinforcing = correctAt(initial, 3);
    expect(reinforcing).toMatchObject({ masteryStage: 2, nextReviewAt: 17 * DAY });

    const stable = correctAt(reinforcing, 17);
    expect(stable).toMatchObject({ masteryStage: 3, nextReviewAt: 62 * DAY });

    const mastered = correctAt(stable, 62);
    expect(mastered).toMatchObject({ masteryStage: 4, nextReviewAt: 152 * DAY });
    expect(isMastered(mastered)).toBe(true);
  });

  it("does not advance an early review", () => {
    const initial = correctAt(null, 0);
    const early = correctAt(initial, 2);

    expect(early.masteryStage).toBe(1);
    expect(early.nextReviewAt).toBe(3 * DAY);
    expect(early.reviewCredited).toBe(false);
  });

  it("does not punish a long gap and audits mastered words after 90 days", () => {
    const initial = correctAt(null, 0);
    const reinforcing = correctAt(initial, 30);
    const stable = correctAt(reinforcing, 100);
    const mastered = correctAt(stable, 200);

    expect(mastered.masteryStage).toBe(4);
    expect(isDueForReview(mastered, 289 * DAY)).toBe(false);
    expect(isDueForReview(mastered, 290 * DAY)).toBe(true);

    const audited = correctAt(mastered, 300);
    expect(audited.masteryStage).toBe(4);
    expect(audited.nextReviewAt).toBe(390 * DAY);
    expect(audited.reviewCredited).toBe(true);
  });

  it("demotes wrong or missed words by one stage and makes them immediately due", () => {
    const current: MasteryState = {
      masteryStage: 4,
      needsReview: false,
      nextReviewAt: 999 * DAY,
      lastAdvancedAt: 10 * DAY,
    };
    const wrong = applyMasteryOutcome(current, {
      correct: false,
      firstTry: false,
      occurredAt: 20 * DAY,
    });

    expect(wrong).toMatchObject({
      masteryStage: 3,
      needsReview: true,
      nextReviewAt: 20 * DAY,
      reviewCredited: false,
    });
    expect(isMastered(wrong)).toBe(false);
  });
});
