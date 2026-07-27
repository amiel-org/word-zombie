import type { AttemptCount } from "./types";

export interface StoredEncounterOutcome {
  attempts: AttemptCount;
  correct: boolean;
}

export function assertAttemptCount(
  value: unknown,
  field: string,
): asserts value is AttemptCount {
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3) {
    throw new TypeError(`${field} must be 0, 1, 2, or 3`);
  }
}

export function validateEncounterOutcome(input: StoredEncounterOutcome): void {
  if (input.correct && input.attempts === 0) {
    throw new RangeError("A correct encounter must include an answer attempt");
  }
}

export function countWrongAttempts(input: StoredEncounterOutcome): number {
  return input.correct ? input.attempts - 1 : input.attempts;
}
