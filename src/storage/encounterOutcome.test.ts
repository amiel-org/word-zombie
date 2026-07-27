import { describe, expect, it } from "vitest";

import {
  assertAttemptCount,
  countWrongAttempts,
  validateEncounterOutcome,
} from "./encounterOutcome";
import type { AttemptCount } from "./types";

describe("stored encounter outcomes", () => {
  it.each([0, 1, 2, 3] as const)(
    "accepts a wall breach after %i answer attempts",
    (attempts) => {
      const outcome = {
        attempts,
        correct: false,
      } as const;

      expect(() => validateEncounterOutcome(outcome)).not.toThrow();
      expect(countWrongAttempts(outcome)).toBe(attempts);
    },
  );

  it.each([
    { attempts: 1 as const, wrongAttempts: 0 },
    { attempts: 2 as const, wrongAttempts: 1 },
    { attempts: 3 as const, wrongAttempts: 2 },
  ])(
    "accepts a correct result on attempt $attempts",
    ({ attempts, wrongAttempts }) => {
      const outcome = { attempts, correct: true } as const;

      expect(() => validateEncounterOutcome(outcome)).not.toThrow();
      expect(countWrongAttempts(outcome)).toBe(wrongAttempts);
    },
  );

  it("rejects a correct result without an answer attempt", () => {
    expect(() =>
      validateEncounterOutcome({
        attempts: 0,
        correct: true,
      }),
    ).toThrow("must include an answer attempt");
  });

  it("accepts only integer attempt counts from zero through three", () => {
    for (const value of [0, 1, 2, 3]) {
      expect(() => assertAttemptCount(value, "attempts")).not.toThrow();
    }

    for (const value of [-1, 4, 1.5, "0", null]) {
      expect(() => assertAttemptCount(value, "attempts")).toThrow(
        "attempts must be 0, 1, 2, or 3",
      );
    }
  });

  it("exposes zero as a valid persisted attempt count", () => {
    const attempts: AttemptCount = 0;

    expect(attempts).toBe(0);
  });
});
