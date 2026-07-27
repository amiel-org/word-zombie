import { describe, expect, it } from "vitest";

import {
  AUDIO_SETTINGS_KEY,
  DEFAULT_AUDIO_SETTINGS,
  parseAudioSettings,
  readAudioSettings,
  shouldPlayBackgroundMusic,
  writeAudioSettings,
} from "./audioManager";

describe("audio settings", () => {
  it("uses safe defaults for empty or invalid storage", () => {
    expect(parseAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings("not-json")).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it("preserves valid booleans and repairs missing fields", () => {
    expect(parseAudioSettings('{"music":false,"pronunciation":false}')).toEqual({
      music: false,
      sfx: true,
      pronunciation: false,
    });
  });

  it("reads and writes through a storage-compatible object", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const settings = { music: false, sfx: true, pronunciation: false };
    writeAudioSettings(settings, storage);
    expect(values.has(AUDIO_SETTINGS_KEY)).toBe(true);
    expect(readAudioSettings(storage)).toEqual(settings);
  });
});

describe("background music playback", () => {
  it("plays only after unlock when music is enabled and review is inactive", () => {
    expect(shouldPlayBackgroundMusic(true, true, false)).toBe(true);
    expect(shouldPlayBackgroundMusic(false, true, false)).toBe(false);
    expect(shouldPlayBackgroundMusic(true, false, false)).toBe(false);
    expect(shouldPlayBackgroundMusic(true, true, true)).toBe(false);
  });
});
