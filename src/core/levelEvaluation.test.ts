import { describe, expect, it } from "vitest";

import { evaluateLevel } from "./levelEvaluation";

describe("level evaluation", () => {
  it("requires seven of ten mastered words and positive health", () => {
    expect(evaluateLevel({
      masteredWordCount: 7,
      targetWordCount: 10,
      remainingHealth: 1,
    })).toMatchObject({
      passed: true,
      stars: 1,
      requiredMasteryCount: 7,
      failureReason: null,
    });

    expect(evaluateLevel({
      masteredWordCount: 6,
      targetWordCount: 10,
      remainingHealth: 100,
    })).toMatchObject({
      passed: false,
      stars: 0,
      failureReason: "mastery",
    });
  });

  it("fails immediately when health reaches zero", () => {
    expect(evaluateLevel({
      masteredWordCount: 10,
      targetWordCount: 10,
      remainingHealth: 0,
    })).toMatchObject({
      passed: false,
      stars: 0,
      failureReason: "health",
    });
  });

  it.each([
    { masteredWordCount: 7, remainingHealth: 100, stars: 1 },
    { masteredWordCount: 8, remainingHealth: 50, stars: 2 },
    { masteredWordCount: 9, remainingHealth: 70, stars: 3 },
    { masteredWordCount: 10, remainingHealth: 100, stars: 3 },
  ])("awards $stars stars for mastery and health", (input) => {
    expect(evaluateLevel({ ...input, targetWordCount: 10 }).stars).toBe(input.stars);
  });

  it("does not round a seventy-percent threshold down", () => {
    expect(evaluateLevel({
      masteredWordCount: 7,
      targetWordCount: 11,
      remainingHealth: 100,
    })).toMatchObject({ passed: false, requiredMasteryCount: 8 });
  });

  it("rejects impossible inputs", () => {
    expect(() => evaluateLevel({
      masteredWordCount: 1,
      targetWordCount: 0,
      remainingHealth: 100,
    })).toThrow("targetWordCount must be greater than zero");
    expect(() => evaluateLevel({
      masteredWordCount: 11,
      targetWordCount: 10,
      remainingHealth: 100,
    })).toThrow("cannot exceed");
  });
});
