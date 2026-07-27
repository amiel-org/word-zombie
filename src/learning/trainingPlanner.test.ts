import { describe, expect, it } from "vitest";

import type { FrequencyWord } from "../content/frequencyTypes";
import { DAY_MS } from "./mastery";
import { buildTrainingPlan, type TrainingWordProgress } from "./trainingPlanner";

function word(index: number, band: FrequencyWord["band"] = "high"): FrequencyWord {
  return {
    id: `word-${index}`,
    english: `english-${index}`,
    meaningZh: `释义-${index}`,
    band,
    groupNumber: Math.ceil(index / 60),
    serial: ((index - 1) % 60) + 1,
    sourceSheet: "test",
    sourceOrder: index,
  };
}

function progress(
  index: number,
  values: Partial<TrainingWordProgress> = {},
): TrainingWordProgress {
  return {
    wordId: `word-${index}`,
    masteryStage: 1,
    needsReview: false,
    nextReviewAt: 30 * DAY_MS,
    wrong: 0,
    lastSeenAt: 0,
    ...values,
  };
}

describe("training planner", () => {
  const highWords = Array.from({ length: 80 }, (_, index) => word(index + 1));
  const allWords = [...highWords, ...Array.from({ length: 30 }, (_, index) => word(100 + index, "low"))];

  it("starts with twenty unique unseen words from the selected band", () => {
    const plan = buildTrainingPlan(allWords, [], {
      band: "high",
      now: 0,
      random: () => 0.5,
    });

    expect(plan.words).toHaveLength(20);
    expect(new Set(plan.words.map((item) => item.id)).size).toBe(20);
    expect(plan.words.every((item) => item.band === "high")).toBe(true);
    expect(plan.composition.unseen).toBe(20);
  });

  it("prioritizes weak and due words while reserving new vocabulary", () => {
    const records = [
      ...Array.from({ length: 10 }, (_, index) => progress(index + 1, {
        needsReview: true,
        nextReviewAt: 0,
        wrong: 10 - index,
      })),
      ...Array.from({ length: 10 }, (_, index) => progress(index + 11, {
        nextReviewAt: 0,
      })),
    ];
    const plan = buildTrainingPlan(allWords, records, {
      band: "high",
      now: DAY_MS,
      random: () => 0.25,
    });

    expect(plan.composition.dueWeak).toBe(8);
    expect(plan.composition.dueReview).toBe(4);
    expect(plan.composition.unseen).toBe(8);
    expect(plan.words).toHaveLength(20);
  });

  it("fills a new round with unseen words when nothing is due", () => {
    const records = Array.from({ length: 20 }, (_, index) => progress(index + 1, {
      nextReviewAt: 30 * DAY_MS,
    }));
    const plan = buildTrainingPlan(allWords, records, {
      band: "high",
      now: DAY_MS,
      random: () => 0.5,
    });

    expect(plan.composition.unseen).toBe(20);
    expect(plan.composition.practice).toBe(0);
    expect(plan.words.every((item) => !records.some((record) => record.wordId === item.id)))
      .toBe(true);
  });

  it("avoids duplicate Chinese meanings when alternatives exist", () => {
    const vocabulary = highWords.map((item, index) => ({
      ...item,
      meaningZh: index < 2 ? "相同释义" : item.meaningZh,
    }));
    const plan = buildTrainingPlan(vocabulary, [], {
      band: "high",
      now: 0,
      random: () => 0.1,
    });

    expect(plan.words.filter((item) => item.meaningZh === "相同释义")).toHaveLength(1);
  });
});
