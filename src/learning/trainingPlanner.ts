import type { FrequencyBand, FrequencyWord } from "../content/frequencyTypes";
import type { MatchLevelContent } from "../content/matchContentTypes";
import { isDueForReview } from "./mastery";

export interface TrainingWordProgress {
  readonly wordId: string;
  readonly masteryStage: 0 | 1 | 2 | 3 | 4;
  readonly needsReview: boolean;
  readonly nextReviewAt: number;
  readonly wrong: number;
  readonly lastSeenAt: number;
}

export interface TrainingPlanComposition {
  readonly dueWeak: number;
  readonly dueReview: number;
  readonly unseen: number;
  readonly practice: number;
  readonly masteredAudit: number;
}

export interface TrainingPlan {
  readonly content: MatchLevelContent;
  readonly words: readonly FrequencyWord[];
  readonly composition: TrainingPlanComposition;
}

export interface BuildTrainingPlanOptions {
  readonly band: FrequencyBand;
  readonly now?: number;
  readonly roundSize?: number;
  readonly random?: () => number;
}

type PlanReason = keyof TrainingPlanComposition;

const BAND_TITLES: Readonly<Record<FrequencyBand, string>> = {
  high: "高频词防线",
  medium: "中频词防线",
  low: "低频词防线",
};

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function meaningKey(word: FrequencyWord): string {
  return word.meaningZh.replace(/[；，、。\s]/g, "").toLowerCase();
}

export function buildTrainingPlan(
  vocabulary: readonly FrequencyWord[],
  progress: readonly TrainingWordProgress[],
  options: BuildTrainingPlanOptions,
): TrainingPlan {
  const now = options.now ?? Date.now();
  const roundSize = options.roundSize ?? 20;
  const random = options.random ?? Math.random;
  if (!Number.isFinite(now) || now < 0) throw new RangeError("now must be valid");
  if (!Number.isInteger(roundSize) || roundSize <= 0) {
    throw new RangeError("roundSize must be a positive integer");
  }

  const bandWords = vocabulary.filter((word) => word.band === options.band);
  if (bandWords.length < roundSize) {
    throw new RangeError(`Not enough ${options.band} words for a ${roundSize}-word round`);
  }

  const progressByWord = new Map(progress.map((record) => [record.wordId, record]));
  const dueWeak: FrequencyWord[] = [];
  const dueReview: FrequencyWord[] = [];
  const unseen: FrequencyWord[] = [];
  const practice: FrequencyWord[] = [];
  const dueMasteredAudit: FrequencyWord[] = [];
  const masteredAudit: FrequencyWord[] = [];

  for (const word of bandWords) {
    const record = progressByWord.get(word.id);
    if (!record) {
      unseen.push(word);
    } else if (record.needsReview && isDueForReview(record, now)) {
      dueWeak.push(word);
    } else if (isDueForReview(record, now)) {
      if (record.masteryStage === 4) dueMasteredAudit.push(word);
      else dueReview.push(word);
    } else if (record.masteryStage < 4) {
      practice.push(word);
    } else {
      masteredAudit.push(word);
    }
  }

  const weakRank = (left: FrequencyWord, right: FrequencyWord): number => {
    const leftProgress = progressByWord.get(left.id)!;
    const rightProgress = progressByWord.get(right.id)!;
    return rightProgress.wrong - leftProgress.wrong
      || leftProgress.nextReviewAt - rightProgress.nextReviewAt
      || leftProgress.lastSeenAt - rightProgress.lastSeenAt;
  };
  const dueRank = (left: FrequencyWord, right: FrequencyWord): number => {
    const leftProgress = progressByWord.get(left.id)!;
    const rightProgress = progressByWord.get(right.id)!;
    return leftProgress.nextReviewAt - rightProgress.nextReviewAt
      || leftProgress.lastSeenAt - rightProgress.lastSeenAt;
  };
  dueWeak.sort(weakRank);
  dueReview.sort(dueRank);
  dueMasteredAudit.sort(dueRank);
  masteredAudit.sort(dueRank);

  const selected: FrequencyWord[] = [];
  const reasons = new Map<string, PlanReason>();
  const usedMeanings = new Set<string>();
  const usedIds = new Set<string>();

  const add = (
    candidates: readonly FrequencyWord[],
    reason: PlanReason,
    maximum: number,
  ): void => {
    if (maximum <= 0 || selected.length >= roundSize) return;
    const available = candidates.filter((word) => !usedIds.has(word.id));
    for (const allowDuplicateMeaning of [false, true]) {
      for (const word of available) {
        if (selected.length >= roundSize || maximum <= 0) return;
        if (usedIds.has(word.id)) continue;
        const key = meaningKey(word);
        if (!allowDuplicateMeaning && usedMeanings.has(key)) continue;
        selected.push(word);
        usedIds.add(word.id);
        usedMeanings.add(key);
        reasons.set(word.id, reason);
        maximum -= 1;
      }
    }
  };

  if (progress.length === 0) {
    add(shuffle(unseen, random), "unseen", roundSize);
  } else {
    add(dueWeak, "dueWeak", Math.min(8, roundSize));
    add(dueReview, "dueReview", Math.max(0, Math.min(12, roundSize) - selected.length));
    add(
      dueMasteredAudit,
      "masteredAudit",
      Math.max(0, Math.min(12, roundSize) - selected.length),
    );
    add(shuffle(unseen, random), "unseen", roundSize - selected.length);

    add(dueWeak, "dueWeak", roundSize - selected.length);
    add(dueReview, "dueReview", roundSize - selected.length);
    add(dueMasteredAudit, "masteredAudit", roundSize - selected.length);
    add(shuffle(practice, random), "practice", roundSize - selected.length);
    add(masteredAudit, "masteredAudit", roundSize - selected.length);
  }

  if (selected.length !== roundSize) {
    throw new Error(`Planner selected ${selected.length}/${roundSize} words`);
  }

  const ordered = shuffle(selected, random);
  const roundId = `frequency-${options.band}-${Math.floor(now)}`;
  const content: MatchLevelContent = {
    id: roundId,
    unit: 0,
    level: 1,
    title: BAND_TITLES[options.band],
    encounters: ordered.map((word, index) => ({
      encounterId: `${roundId}-${String(index + 1).padStart(2, "0")}-${word.id}`,
      targetId: word.id,
      english: word.english,
      meaningZh: word.meaningZh,
      phonetic: null,
    })),
  };
  const composition: Record<PlanReason, number> = {
    dueWeak: 0,
    dueReview: 0,
    unseen: 0,
    practice: 0,
    masteredAudit: 0,
  };
  for (const word of selected) composition[reasons.get(word.id)!] += 1;

  return { content, words: ordered, composition };
}
