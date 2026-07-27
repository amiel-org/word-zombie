import { describe, expect, it } from "vitest";

import {
  FREQUENCY_VOCABULARY,
  getWordsByFrequencyBand,
} from "./frequencyVocabulary";

describe("frequency vocabulary import", () => {
  it("contains the audited Excel totals", () => {
    expect(FREQUENCY_VOCABULARY.total).toBe(3_180);
    expect(FREQUENCY_VOCABULARY.counts).toEqual({
      high: 660,
      medium: 1_320,
      mediumCore: 660,
      mediumAdvanced: 660,
      low: 1_200,
    });
    expect(getWordsByFrequencyBand("high")).toHaveLength(660);
    expect(getWordsByFrequencyBand("medium")).toHaveLength(1_320);
    expect(getWordsByFrequencyBand("low")).toHaveLength(1_200);
  });

  it("has unique stable ids, unique English entries, and complete fields", () => {
    const ids = new Set<string>();
    const english = new Set<string>();
    for (const word of FREQUENCY_VOCABULARY.words) {
      expect(word.id).toMatch(/^freq-[a-f0-9]{12}$/);
      expect(word.english.trim()).not.toBe("");
      expect(word.meaningZh.trim()).not.toBe("");
      expect(ids.has(word.id)).toBe(false);
      expect(english.has(word.english.trim().toLowerCase())).toBe(false);
      ids.add(word.id);
      english.add(word.english.trim().toLowerCase());
    }
  });

  it("keeps workbook group order instead of interleaving column blocks", () => {
    const high = getWordsByFrequencyBand("high");
    expect(high.slice(0, 60).every((word) => word.groupNumber === 1)).toBe(true);
    expect(high.slice(60, 120).every((word) => word.groupNumber === 2)).toBe(true);
    expect(high[0]?.serial).toBe(1);
    expect(high[59]?.serial).toBe(60);
  });
});
