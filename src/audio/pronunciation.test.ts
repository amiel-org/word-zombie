import { describe, expect, it } from "vitest";

import {
  findEnglishVoice,
  pronounceWithSynthesis,
  waitForSpeechVoices,
} from "./pronunciation";

function voice(
  name: string,
  lang: string,
  isDefault = false,
  localService = true,
): SpeechSynthesisVoice {
  return {
    default: isDefault,
    lang,
    localService,
    name,
    voiceURI: name,
  };
}

describe("English speech voice selection", () => {
  it("uses the requested British voice when it is installed", () => {
    const voices = [
      voice("Microsoft Zira Desktop", "en-US"),
      voice("Microsoft Hazel Desktop", "en-GB"),
    ];
    expect(findEnglishVoice(voices, "en-GB")?.name).toBe("Microsoft Hazel Desktop");
  });

  it("falls back to the installed en-US voice used by Windows 10", () => {
    const voices = [
      voice("Microsoft Huihui Desktop", "zh-CN", true),
      voice("Microsoft Zira Desktop", "en-US"),
    ];
    expect(findEnglishVoice(voices, "en-GB")?.name).toBe("Microsoft Zira Desktop");
  });

  it("prefers an offline local English voice on iPad and Android", () => {
    const voices = [
      voice("Cloud British", "en-GB", false, false),
      voice("Local American", "en_US"),
    ];
    expect(findEnglishVoice(voices, "en-GB")?.name).toBe("Local American");
  });

  it("returns no voice when Windows exposes no English voice", () => {
    expect(findEnglishVoice([voice("Microsoft Huihui Desktop", "zh-CN")])).toBeUndefined();
  });

  it("waits for the asynchronous voiceschanged event used by Windows 10 Chrome", async () => {
    class FakeSpeechSynthesis extends EventTarget {
      voices: SpeechSynthesisVoice[] = [];

      getVoices(): SpeechSynthesisVoice[] {
        return this.voices;
      }
    }

    const synth = new FakeSpeechSynthesis();
    const pending = waitForSpeechVoices(synth as unknown as SpeechSynthesis);
    synth.voices = [voice("Microsoft Zira Desktop", "en-US")];
    synth.dispatchEvent(new Event("voiceschanged"));

    await expect(pending).resolves.toEqual(synth.voices);
  });

  it("retries with the system en-US voice when a selected mobile voice is unavailable", async () => {
    class FakeUtterance extends EventTarget {
      lang = "";
      rate = 1;
      pitch = 1;
      volume = 1;
      voice: SpeechSynthesisVoice | null = null;

      constructor(readonly text: string) {
        super();
      }
    }

    const attempts: Array<{ lang: string; voice: SpeechSynthesisVoice | null }> = [];
    const installedVoice = voice("Mobile English", "en-GB");
    const synth = {
      cancel: () => undefined,
      getVoices: () => [installedVoice],
      resume: () => undefined,
      speak: (utterance: FakeUtterance) => {
        attempts.push({ lang: utterance.lang, voice: utterance.voice });
        queueMicrotask(() => {
          if (attempts.length === 1) {
            const event = new Event("error");
            Object.defineProperty(event, "error", { value: "voice-unavailable" });
            utterance.dispatchEvent(event);
          } else {
            utterance.dispatchEvent(new Event("end"));
          }
        });
      },
    };

    const spoken = await pronounceWithSynthesis(
      synth as unknown as SpeechSynthesis,
      FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
      "heritage",
    );

    expect(spoken).toBe(true);
    expect(attempts).toEqual([
      { lang: "en-GB", voice: installedVoice },
      { lang: "en-US", voice: null },
    ]);
  });

  it("can ask the system for English when a Chinese Android ROM lists no English voice", async () => {
    class FakeUtterance extends EventTarget {
      lang = "";
      rate = 1;
      pitch = 1;
      volume = 1;
      voice: SpeechSynthesisVoice | null = null;

      constructor(readonly text: string) {
        super();
      }
    }

    const attempts: Array<{ lang: string; voice: SpeechSynthesisVoice | null }> = [];
    const synth = {
      cancel: () => undefined,
      getVoices: () => [voice("Chinese only", "zh-CN", true)],
      resume: () => undefined,
      speak: (utterance: FakeUtterance) => {
        attempts.push({ lang: utterance.lang, voice: utterance.voice });
        queueMicrotask(() => utterance.dispatchEvent(new Event("end")));
      },
    };

    await expect(pronounceWithSynthesis(
      synth as unknown as SpeechSynthesis,
      FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
      "heritage",
    )).resolves.toBe(true);
    expect(attempts).toEqual([{ lang: "en-GB", voice: null }]);
  });
});
