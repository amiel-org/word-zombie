export type FrequencyBand = "high" | "medium" | "low";
export type MediumFrequencyBand = "core" | "advanced";

export interface FrequencyWord {
  readonly id: string;
  readonly english: string;
  readonly meaningZh: string;
  readonly band: FrequencyBand;
  readonly mediumBand?: MediumFrequencyBand;
  readonly groupNumber: number;
  readonly serial: number;
  readonly sourceSheet: string;
  readonly sourceOrder: number;
}

export interface FrequencyVocabularyData {
  readonly schemaVersion: 1;
  readonly sourceFile: string;
  readonly sourceSha256: string;
  readonly total: number;
  readonly counts: {
    readonly high: number;
    readonly medium: number;
    readonly mediumCore: number;
    readonly mediumAdvanced: number;
    readonly low: number;
  };
  readonly words: readonly FrequencyWord[];
}

export interface FrequencyBandDefinition {
  readonly id: FrequencyBand;
  readonly label: string;
  readonly description: string;
  readonly total: number;
}
