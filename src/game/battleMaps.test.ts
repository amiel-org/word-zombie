import { describe, expect, it } from "vitest";

import { BATTLE_MAPS, getBattleMap, getBattleMapForSessionCount } from "./battleMaps";

describe("battle map rotation", () => {
  it("exposes eight unique packaged maps", () => {
    expect(BATTLE_MAPS).toHaveLength(8);
    expect(new Set(BATTLE_MAPS.map((map) => map.id)).size).toBe(BATTLE_MAPS.length);
    expect(new Set(BATTLE_MAPS.map((map) => map.assetPath)).size).toBe(BATTLE_MAPS.length);
    expect(BATTLE_MAPS.every((map) => map.assetPath.endsWith(".jpg"))).toBe(true);
  });

  it("rotates in order for each recorded session and then loops", () => {
    const firstCycle = BATTLE_MAPS.map((_, index) => getBattleMapForSessionCount(index).id);
    expect(firstCycle).toEqual(BATTLE_MAPS.map((map) => map.id));
    expect(getBattleMapForSessionCount(BATTLE_MAPS.length).id).toBe(BATTLE_MAPS[0].id);
    expect(getBattleMap(BATTLE_MAPS[3].id)).toBe(BATTLE_MAPS[3]);
  });

  it("rejects invalid session counts", () => {
    expect(() => getBattleMapForSessionCount(-1)).toThrow(RangeError);
    expect(() => getBattleMapForSessionCount(1.5)).toThrow(RangeError);
  });
});
