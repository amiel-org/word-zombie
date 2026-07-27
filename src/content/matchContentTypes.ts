export interface MatchEncounterContent {
  readonly encounterId: string;
  readonly targetId: string;
  readonly english: string;
  readonly meaningZh: string;
  readonly phonetic: string | null;
}

export interface MatchLevelContent {
  readonly id: string;
  readonly unit: number;
  readonly level: number;
  readonly title: string;
  readonly encounters: readonly MatchEncounterContent[];
}
