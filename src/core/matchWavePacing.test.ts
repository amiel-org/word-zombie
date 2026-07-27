import { describe, expect, it } from "vitest";

import {
  CHARGE_SPEED,
  getMatchWavePacing,
  LANE_COUNT,
  MAX_ACTIVE_ZOMBIES,
} from "./matchWavePacing";

describe("match wave pacing", () => {
  it("uses three fixed waves across all twenty spawn positions", () => {
    expect(getMatchWavePacing(0)).toEqual({
      wave: 1,
      baseSpeed: 34,
      spawnIntervalMs: 1_900,
    });
    expect(getMatchWavePacing(5)).toEqual({
      wave: 1,
      baseSpeed: 34,
      spawnIntervalMs: 1_900,
    });
    expect(getMatchWavePacing(6)).toEqual({
      wave: 2,
      baseSpeed: 40,
      spawnIntervalMs: 1_550,
    });
    expect(getMatchWavePacing(13)).toEqual({
      wave: 2,
      baseSpeed: 40,
      spawnIntervalMs: 1_550,
    });
    expect(getMatchWavePacing(14)).toEqual({
      wave: 3,
      baseSpeed: 47,
      spawnIntervalMs: 1_250,
    });
    expect(getMatchWavePacing(19)).toEqual({
      wave: 3,
      baseSpeed: 47,
      spawnIntervalMs: 1_250,
    });
  });

  it("increases approach speed and shortens spawn intervals each wave", () => {
    const waves = [
      getMatchWavePacing(0),
      getMatchWavePacing(6),
      getMatchWavePacing(14),
    ];

    expect(waves.map(({ baseSpeed }) => baseSpeed)).toEqual([34, 40, 47]);
    expect(waves.map(({ spawnIntervalMs }) => spawnIntervalMs)).toEqual([
      1_900,
      1_550,
      1_250,
    ]);
  });

  it("keeps same-lane zombies at least 150 pixels apart at spawn time", () => {
    const waveStarts = [0, 6, 14];
    const theoreticalSpacing = waveStarts.map((spawnIndex) => {
      const pacing = getMatchWavePacing(spawnIndex);
      const sameLaneIntervalMs = LANE_COUNT * pacing.spawnIntervalMs;
      return pacing.baseSpeed * (sameLaneIntervalMs / 1_000);
    });

    expect(theoreticalSpacing).toEqual([193.8, 186, 176.25]);
    theoreticalSpacing.forEach((spacing) =>
      expect(spacing).toBeGreaterThanOrEqual(150),
    );
  });

  it("exports the concurrency, lane and wrong-answer charge limits", () => {
    expect(LANE_COUNT).toBe(3);
    expect(MAX_ACTIVE_ZOMBIES).toBe(6);
    expect(CHARGE_SPEED).toBeGreaterThanOrEqual(800);
  });

  it("rejects positions outside the fixed twenty-zombie match", () => {
    expect(() => getMatchWavePacing(-1)).toThrow("non-negative integer");
    expect(() => getMatchWavePacing(1.5)).toThrow("non-negative integer");
    expect(() => getMatchWavePacing(20)).toThrow(
      "within the match zombie count",
    );
    expect(() => getMatchWavePacing(0, 19)).toThrow("exactly 20");
    expect(() => getMatchWavePacing(0, 20.5)).toThrow("exactly 20");
  });
});
