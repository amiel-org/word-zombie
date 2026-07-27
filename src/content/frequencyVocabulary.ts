import rawVocabulary from "../../data/senior_frequency_words.json";

import type {
  FrequencyBand,
  FrequencyBandDefinition,
  FrequencyVocabularyData,
  FrequencyWord,
} from "./frequencyTypes";

export const FREQUENCY_VOCABULARY = rawVocabulary as FrequencyVocabularyData;

export const FREQUENCY_BANDS = [
  {
    id: "high",
    label: "高频",
    description: "优先夯实高考常见词",
    total: FREQUENCY_VOCABULARY.counts.high,
  },
  {
    id: "medium",
    label: "中频",
    description: "核心与提升词合并训练",
    total: FREQUENCY_VOCABULARY.counts.medium,
  },
  {
    id: "low",
    label: "低频",
    description: "拓展识别范围",
    total: FREQUENCY_VOCABULARY.counts.low,
  },
] as const satisfies readonly FrequencyBandDefinition[];

export const DEFAULT_FREQUENCY_BAND = "high" satisfies FrequencyBand;

const wordsByBand = new Map<FrequencyBand, readonly FrequencyWord[]>(
  FREQUENCY_BANDS.map((band) => [
    band.id,
    FREQUENCY_VOCABULARY.words.filter((word) => word.band === band.id),
  ]),
);

export function isFrequencyBand(value: unknown): value is FrequencyBand {
  return value === "high" || value === "medium" || value === "low";
}

export function getFrequencyBandDefinition(
  band: FrequencyBand,
): FrequencyBandDefinition {
  const definition = FREQUENCY_BANDS.find((candidate) => candidate.id === band);
  if (!definition) throw new Error(`Unknown frequency band: ${band}`);
  return definition;
}

export function getWordsByFrequencyBand(
  band: FrequencyBand,
): readonly FrequencyWord[] {
  return wordsByBand.get(band) ?? [];
}
