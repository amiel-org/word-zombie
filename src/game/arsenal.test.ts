import { describe, expect, it } from "vitest";

import {
  buildZombieVisualDeck,
  getGuardTextureKey,
  getZombieMotionStyle,
  getWeaponTextureKey,
  isWeaponSelection,
  pickDifferentVisual,
  SCHOOL_ZOMBIE_TEXTURE_KEYS,
  WEAPON_OPTIONS,
  ZOMBIE_TEXTURE_KEYS,
} from "./arsenal";

describe("arsenal visual selection", () => {
  it("exposes three real-name selectable weapons and eleven zombie visuals", () => {
    expect(WEAPON_OPTIONS).toHaveLength(3);
    expect(ZOMBIE_TEXTURE_KEYS).toHaveLength(11);
    expect(new Set(WEAPON_OPTIONS.map((weapon) => weapon.textureKey)).size).toBe(3);
    expect(WEAPON_OPTIONS).toEqual([
      { id: "m4a1", label: "M4A1", textureKey: "weapon-m4a1", guardTextureKey: "guard-m4a1" },
      { id: "ak47", label: "AK-47", textureKey: "weapon-ak47", guardTextureKey: "guard-ak47" },
      { id: "mp5", label: "MP5", textureKey: "weapon-mp5", guardTextureKey: "guard-mp5" },
    ]);
  });

  it("accepts random and known weapon ids", () => {
    expect(isWeaponSelection("random")).toBe(true);
    expect(isWeaponSelection("ak47")).toBe(true);
    expect(isWeaponSelection("unknown")).toBe(false);
  });

  it("resolves a weapon id to its Phaser texture key", () => {
    expect(getWeaponTextureKey("mp5")).toBe("weapon-mp5");
    expect(getGuardTextureKey("mp5")).toBe("guard-mp5");
  });

  it("avoids immediately repeating a visual when alternatives exist", () => {
    expect(
      pickDifferentVisual(ZOMBIE_TEXTURE_KEYS, "zombie-scout", () => 0),
    ).toBe("zombie-scholar");
  });

  it("uses the only available visual and clamps invalid random values", () => {
    expect(pickDifferentVisual(["only"] as const, "only", () => Number.NaN)).toBe("only");
    expect(pickDifferentVisual(["first", "last"] as const, undefined, () => 4)).toBe("last");
  });

  it("builds a varied twenty-zombie deck with every school role and no repeats", () => {
    let seed = 17;
    const random = () => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed / 2_147_483_647;
    };
    const deck = buildZombieVisualDeck(20, random);

    expect(deck).toHaveLength(20);
    expect(new Set(deck).size).toBe(8);
    expect(SCHOOL_ZOMBIE_TEXTURE_KEYS.every((key) => deck.includes(key))).toBe(true);
    expect(deck.every((key, index) => index === 0 || key !== deck[index - 1])).toBe(true);
  });

  it("assigns distinctive movement styles to the new school roles", () => {
    expect(getZombieMotionStyle("zombie-female")).toBe("shuffle");
    expect(getZombieMotionStyle("zombie-teacher")).toBe("drag");
    expect(getZombieMotionStyle("zombie-math-teacher")).toBe("twitch");
    expect(getZombieMotionStyle("zombie-pe-teacher")).toBe("jog");
    expect(getZombieMotionStyle("zombie-director")).toBe("stomp");
  });
});
