export const WEAPON_OPTIONS = [
  {
    id: "m4a1",
    label: "M4A1",
    textureKey: "weapon-m4a1",
    guardTextureKey: "guard-m4a1",
  },
  {
    id: "ak47",
    label: "AK-47",
    textureKey: "weapon-ak47",
    guardTextureKey: "guard-ak47",
  },
  {
    id: "mp5",
    label: "MP5",
    textureKey: "weapon-mp5",
    guardTextureKey: "guard-mp5",
  },
] as const;

export const CLASSIC_ZOMBIE_TEXTURE_KEYS = [
  "zombie-scout",
  "zombie-scholar",
  "zombie-athlete",
  "zombie-builder",
  "zombie-gentleman",
  "zombie-musician",
] as const;

export const SCHOOL_ZOMBIE_TEXTURE_KEYS = [
  "zombie-female",
  "zombie-teacher",
  "zombie-math-teacher",
  "zombie-pe-teacher",
  "zombie-director",
] as const;

export const ZOMBIE_TEXTURE_KEYS = [
  ...CLASSIC_ZOMBIE_TEXTURE_KEYS,
  ...SCHOOL_ZOMBIE_TEXTURE_KEYS,
] as const;

export type WeaponId = (typeof WEAPON_OPTIONS)[number]["id"];
export type WeaponSelection = WeaponId | "random";
export type ZombieTextureKey = (typeof ZOMBIE_TEXTURE_KEYS)[number];
export type ZombieMotionStyle = "shuffle" | "drag" | "twitch" | "jog" | "stomp";

export function isWeaponSelection(value: unknown): value is WeaponSelection {
  return value === "random" || WEAPON_OPTIONS.some((weapon) => weapon.id === value);
}

export function getWeaponTextureKey(weaponId: WeaponId): string {
  const weapon = WEAPON_OPTIONS.find((option) => option.id === weaponId);
  if (!weapon) throw new RangeError(`Unknown weapon: ${weaponId}`);
  return weapon.textureKey;
}

export function getGuardTextureKey(weaponId: WeaponId): string {
  const weapon = WEAPON_OPTIONS.find((option) => option.id === weaponId);
  if (!weapon) throw new RangeError(`Unknown weapon: ${weaponId}`);
  return weapon.guardTextureKey;
}

export function pickDifferentVisual<T extends string>(
  options: readonly T[],
  previous: T | undefined,
  random: () => number = Math.random,
): T {
  if (options.length === 0) throw new RangeError("At least one visual option is required");

  const candidates = options.length > 1 && previous !== undefined
    ? options.filter((option) => option !== previous)
    : [...options];
  const randomValue = random();
  const normalized = Number.isFinite(randomValue)
    ? Math.max(0, Math.min(0.999_999, randomValue))
    : 0;

  return candidates[Math.floor(normalized * candidates.length)];
}

export function getZombieMotionStyle(textureKey: ZombieTextureKey): ZombieMotionStyle {
  switch (textureKey) {
    case "zombie-teacher":
    case "zombie-builder":
      return "drag";
    case "zombie-math-teacher":
    case "zombie-musician":
      return "twitch";
    case "zombie-pe-teacher":
    case "zombie-athlete":
      return "jog";
    case "zombie-director":
    case "zombie-gentleman":
      return "stomp";
    default:
      return "shuffle";
  }
}

export function buildZombieVisualDeck(
  encounterCount: number,
  random: () => number = Math.random,
): ZombieTextureKey[] {
  if (!Number.isFinite(encounterCount) || encounterCount <= 0) return [];

  const rotatingClassics = shuffleVisuals(CLASSIC_ZOMBIE_TEXTURE_KEYS, random).slice(0, 3);
  const roster: ZombieTextureKey[] = [
    ...SCHOOL_ZOMBIE_TEXTURE_KEYS,
    ...rotatingClassics,
  ];
  const deck: ZombieTextureKey[] = [];

  while (deck.length < Math.floor(encounterCount)) {
    const cycle = shuffleVisuals(roster, random);
    const previous = deck.at(-1);
    if (previous !== undefined && cycle[0] === previous) {
      const swapIndex = cycle.findIndex((candidate) => candidate !== previous);
      if (swapIndex > 0) [cycle[0], cycle[swapIndex]] = [cycle[swapIndex], cycle[0]];
    }
    deck.push(...cycle);
  }

  return deck.slice(0, Math.floor(encounterCount));
}

function shuffleVisuals<T>(options: readonly T[], random: () => number): T[] {
  const shuffled = [...options];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomValue = random();
    const normalized = Number.isFinite(randomValue)
      ? Math.max(0, Math.min(0.999_999, randomValue))
      : 0;
    const swapIndex = Math.floor(normalized * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}
