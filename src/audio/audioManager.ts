import {
  canPronounce,
  pronounceEnglish,
  stopPronunciation,
  unlockPronunciationEngine,
  warmPronunciationEngine,
} from "./pronunciation";
import type { BattleSoundCue } from "../game/events";

export const AUDIO_SETTINGS_KEY = "word-zombie.audio.v1";

export interface AudioSettings {
  music: boolean;
  sfx: boolean;
  pronunciation: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  music: true,
  sfx: true,
  pronunciation: true,
};

export type AudioSettingName = keyof AudioSettings;

export function shouldPlayBackgroundMusic(
  unlocked: boolean,
  musicEnabled: boolean,
  reviewMode: boolean,
): boolean {
  return unlocked && musicEnabled && !reviewMode;
}

export function parseAudioSettings(value: string | null): AudioSettings {
  if (!value) return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    const parsed = JSON.parse(value) as Partial<AudioSettings>;
    return {
      music: typeof parsed.music === "boolean" ? parsed.music : true,
      sfx: typeof parsed.sfx === "boolean" ? parsed.sfx : true,
      pronunciation:
        typeof parsed.pronunciation === "boolean" ? parsed.pronunciation : true,
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function readAudioSettings(storage: Pick<Storage, "getItem"> = window.localStorage): AudioSettings {
  try {
    return parseAudioSettings(storage.getItem(AUDIO_SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function writeAudioSettings(
  settings: AudioSettings,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  try {
    storage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in private browsing; audio still works for this run.
  }
}

type AudioContextConstructor = typeof AudioContext;

export class GameAudioManager {
  private settings: AudioSettings;
  private bgm?: HTMLAudioElement;
  private context?: AudioContext;
  private unlocked = false;
  private reviewMode = false;
  private pronunciationRun = 0;
  private readonly musicVolume = 0.22;

  constructor(private readonly musicUrl: string) {
    this.settings = readAudioSettings();
    warmPronunciationEngine();
  }

  get currentSettings(): Readonly<AudioSettings> {
    return this.settings;
  }

  get pronunciationSupported(): boolean {
    return canPronounce();
  }

  async unlockAndStart(): Promise<void> {
    this.unlocked = true;
    unlockPronunciationEngine();
    if (this.settings.sfx) {
      this.ensureContext();
      if (this.context?.state === "suspended") {
        await this.context.resume().catch(() => undefined);
      }
    }
    this.syncMusic();
  }

  setSetting(name: AudioSettingName, enabled: boolean): void {
    this.settings = { ...this.settings, [name]: enabled };
    writeAudioSettings(this.settings);
    if (name === "music") this.syncMusic();
    if (name === "sfx" && enabled && this.unlocked) {
      const context = this.ensureContext();
      if (context?.state === "suspended") void context.resume().catch(() => undefined);
    }
    if (name === "pronunciation" && !enabled) {
      this.pronunciationRun += 1;
      stopPronunciation();
      this.restoreMusicVolume();
    }
  }

  toggle(name: AudioSettingName): boolean {
    const enabled = !this.settings[name];
    this.setSetting(name, enabled);
    return enabled;
  }

  setReviewMode(reviewing: boolean): void {
    if (this.reviewMode === reviewing) return;
    this.reviewMode = reviewing;
    this.syncMusic();
  }

  playSfx(cue: BattleSoundCue): void {
    if (!this.unlocked || !this.settings.sfx) return;
    const context = this.ensureContext();
    if (!context) return;

    const now = context.currentTime;
    switch (cue) {
      case "start":
        this.tone(340, 620, 0.16, "triangle", 0.075, now);
        break;
      case "load":
        this.tone(420, 760, 0.09, "triangle", 0.055, now);
        break;
      case "shot":
        this.tone(190, 68, 0.1, "square", 0.075, now);
        break;
      case "correct":
        this.tone(610, 850, 0.12, "sine", 0.065, now);
        this.tone(850, 1_080, 0.13, "sine", 0.05, now + 0.1);
        break;
      case "wrong":
        this.tone(220, 92, 0.24, "sawtooth", 0.06, now);
        break;
      case "breach":
        this.tone(96, 38, 0.42, "sawtooth", 0.1, now);
        this.tone(70, 42, 0.36, "square", 0.045, now + 0.04);
        break;
      case "confirm":
        this.tone(430, 610, 0.11, "triangle", 0.045, now);
        break;
      case "victory":
        [520, 660, 790, 1_040].forEach((frequency, index) => {
          this.tone(frequency, frequency * 1.04, 0.18, "triangle", 0.055, now + index * 0.13);
        });
        break;
      case "failure":
        [260, 210, 150].forEach((frequency, index) => {
          this.tone(frequency, frequency * 0.72, 0.25, "triangle", 0.06, now + index * 0.18);
        });
        break;
    }
  }

  async pronounce(text: string): Promise<boolean> {
    if (!this.settings.pronunciation) return false;
    const run = ++this.pronunciationRun;
    this.duckMusic();
    const spoken = await pronounceEnglish(text, { lang: "en-GB", rate: 0.86 });
    if (run === this.pronunciationRun) this.restoreMusicVolume();
    return spoken;
  }

  destroy(): void {
    this.pronunciationRun += 1;
    stopPronunciation();
    this.bgm?.pause();
    void this.context?.close();
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context) return this.context;
    const WindowWithWebkit = window as typeof window & {
      webkitAudioContext?: AudioContextConstructor;
    };
    const Context = window.AudioContext ?? WindowWithWebkit.webkitAudioContext;
    if (!Context) return undefined;
    this.context = new Context();
    return this.context;
  }

  private ensureBgm(): HTMLAudioElement {
    if (this.bgm) return this.bgm;
    const audio = new Audio(this.musicUrl);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = this.musicVolume;
    this.bgm = audio;
    return audio;
  }

  private syncMusic(): void {
    if (!shouldPlayBackgroundMusic(this.unlocked, this.settings.music, this.reviewMode)) {
      this.bgm?.pause();
      return;
    }
    const bgm = this.ensureBgm();
    bgm.volume = this.musicVolume;
    void bgm.play().catch(() => undefined);
  }

  private duckMusic(): void {
    if (this.bgm && this.settings.music && !this.reviewMode) this.bgm.volume = 0.055;
  }

  private restoreMusicVolume(): void {
    if (this.bgm) this.bgm.volume = this.musicVolume;
  }

  private tone(
    startFrequency: number,
    endFrequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    startAt: number,
  ): void {
    const context = this.context;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), startAt + duration);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  }
}
