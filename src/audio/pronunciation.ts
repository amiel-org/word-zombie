export interface PronunciationOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

const VOICE_LOAD_WAIT_MS = 1_500;
const SPEECH_RETRY_DELAY_MS = 40;

let pendingVoiceLoad: Promise<readonly SpeechSynthesisVoice[]> | null = null;
let pronunciationSequence = 0;
let activeUtterance: SpeechSynthesisUtterance | undefined;
let unlockUtterance: SpeechSynthesisUtterance | undefined;

type SpeechFailureReason =
  | "timeout"
  | "exception"
  | "canceled"
  | "interrupted"
  | "audio-busy"
  | "audio-hardware"
  | "network"
  | "synthesis-unavailable"
  | "synthesis-failed"
  | "language-unavailable"
  | "voice-unavailable"
  | "text-too-long"
  | "invalid-argument"
  | "not-allowed"
  | string;

interface SpeechAttemptResult {
  spoken: boolean;
  reason?: SpeechFailureReason;
}

export function findEnglishVoice(
  voices: readonly SpeechSynthesisVoice[],
  preferredLanguage = "en-GB",
): SpeechSynthesisVoice | undefined {
  const preferred = normalizeLanguage(preferredLanguage);
  const englishVoices = voices.filter((voice) => normalizeLanguage(voice.lang).startsWith("en"));
  const localVoices = englishVoices.filter((voice) => voice.localService);
  const remoteVoices = englishVoices.filter((voice) => !voice.localService);
  return findBestVoice(localVoices, preferred) ?? findBestVoice(remoteVoices, preferred);
}

export function canPronounce(): boolean {
  return typeof window !== "undefined"
    && "speechSynthesis" in window
    && typeof SpeechSynthesisUtterance !== "undefined";
}

export function stopPronunciation(): void {
  pronunciationSequence += 1;
  activeUtterance = undefined;
  unlockUtterance = undefined;
  if (canPronounce()) window.speechSynthesis.cancel();
}

export function warmPronunciationEngine(): void {
  if (!canPronounce()) return;
  const synth = window.speechSynthesis;
  void waitForSpeechVoices(synth);
  try {
    synth.resume();
  } catch {
    // Some older browsers expose speechSynthesis before the engine is ready.
  }
}

export function unlockPronunciationEngine(): void {
  if (!canPronounce()) return;
  const synth = window.speechSynthesis;
  warmPronunciationEngine();
  if (synth.speaking || synth.pending) return;

  try {
    const utterance = new SpeechSynthesisUtterance(".");
    const voice = findEnglishVoice(safelyGetVoices(synth), "en-US");
    utterance.lang = voice?.lang ?? "en-US";
    utterance.rate = 2;
    utterance.volume = 0;
    if (voice) utterance.voice = voice;
    unlockUtterance = utterance;
    const release = (): void => {
      if (unlockUtterance === utterance) unlockUtterance = undefined;
    };
    utterance.addEventListener("end", release, { once: true });
    utterance.addEventListener("error", release, { once: true });
    synth.speak(utterance);
    globalThis.setTimeout(release, 1_200);
  } catch {
    unlockUtterance = undefined;
  }
}

export async function pronounceEnglish(
  text: string,
  options: PronunciationOptions = {},
): Promise<boolean> {
  if (!text.trim() || !canPronounce()) return false;

  return pronounceWithSynthesis(
    window.speechSynthesis,
    SpeechSynthesisUtterance,
    text,
    options,
  );
}

export async function pronounceWithSynthesis(
  synth: SpeechSynthesis,
  Utterance: typeof SpeechSynthesisUtterance,
  text: string,
  options: PronunciationOptions = {},
): Promise<boolean> {
  if (!text.trim()) return false;

  const requestId = ++pronunciationSequence;
  synth.cancel();
  const voices = await waitForSpeechVoices(synth);
  if (requestId !== pronunciationSequence) return false;

  const requestedLanguage = options.lang ?? "en-GB";
  const voice = findEnglishVoice(voices, requestedLanguage);
  const firstAttempt = await speakOnce(
    synth,
    Utterance,
    text,
    options,
    voice?.lang ?? requestedLanguage,
    voice,
    requestId,
  );
  if (firstAttempt.spoken || requestId !== pronunciationSequence) {
    return firstAttempt.spoken;
  }
  if (!shouldRetryWithoutVoice(firstAttempt.reason)) return false;

  await delay(SPEECH_RETRY_DELAY_MS);
  if (requestId !== pronunciationSequence) return false;
  const fallbackLanguage = normalizeLanguage(requestedLanguage) === "en-us"
    ? requestedLanguage
    : "en-US";
  const fallbackAttempt = await speakOnce(
    synth,
    Utterance,
    text,
    options,
    fallbackLanguage,
    undefined,
    requestId,
  );
  return fallbackAttempt.spoken;
}

export function waitForSpeechVoices(
  synth: SpeechSynthesis,
): Promise<readonly SpeechSynthesisVoice[]> {
  const existing = safelyGetVoices(synth);
  if (existing.length > 0) return Promise.resolve(existing);
  if (pendingVoiceLoad) return pendingVoiceLoad;

  const request = new Promise<readonly SpeechSynthesisVoice[]>((resolve) => {
    let settled = false;
    let timeout = 0;
    const finish = (voices: readonly SpeechSynthesisVoice[]): void => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      synth.removeEventListener("voiceschanged", onVoicesChanged);
      resolve(voices);
    };
    const onVoicesChanged = (): void => {
      const voices = safelyGetVoices(synth);
      if (voices.length > 0) finish(voices);
    };
    synth.addEventListener("voiceschanged", onVoicesChanged);
    timeout = globalThis.setTimeout(
      () => finish(safelyGetVoices(synth)),
      VOICE_LOAD_WAIT_MS,
    );
  });
  pendingVoiceLoad = request;
  void request.finally(() => {
    if (pendingVoiceLoad === request) pendingVoiceLoad = null;
  });
  return request;
}

function safelyGetVoices(synth: SpeechSynthesis): readonly SpeechSynthesisVoice[] {
  try {
    return synth.getVoices();
  } catch {
    return [];
  }
}

function findBestVoice(
  voices: readonly SpeechSynthesisVoice[],
  preferredLanguage: string,
): SpeechSynthesisVoice | undefined {
  return voices.find((voice) => normalizeLanguage(voice.lang) === preferredLanguage)
    ?? voices.find((voice) => normalizeLanguage(voice.lang).startsWith(preferredLanguage))
    ?? voices.find((voice) => normalizeLanguage(voice.lang) === "en-us")
    ?? voices.find((voice) => normalizeLanguage(voice.lang).startsWith("en-us"))
    ?? voices.find((voice) => voice.default)
    ?? voices.find((voice) => normalizeLanguage(voice.lang).startsWith("en-gb"))
    ?? voices[0];
}

function normalizeLanguage(language: string): string {
  return language.trim().toLowerCase().replaceAll("_", "-");
}

function shouldRetryWithoutVoice(reason: SpeechFailureReason | undefined): boolean {
  return reason !== "canceled"
    && reason !== "interrupted"
    && reason !== "not-allowed"
    && reason !== "invalid-argument"
    && reason !== "text-too-long";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function speakOnce(
  synth: SpeechSynthesis,
  Utterance: typeof SpeechSynthesisUtterance,
  text: string,
  options: PronunciationOptions,
  language: string,
  voice: SpeechSynthesisVoice | undefined,
  requestId: number,
): Promise<SpeechAttemptResult> {
  return new Promise((resolve) => {
    if (requestId !== pronunciationSequence) {
      resolve({ spoken: false, reason: "canceled" });
      return;
    }

    const utterance = new Utterance(text);
    utterance.lang = language;
    utterance.rate = options.rate ?? 0.86;
    utterance.pitch = options.pitch ?? 1;
    utterance.volume = options.volume ?? 1;
    if (voice) utterance.voice = voice;
    activeUtterance = utterance;

    let finished = false;
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    const finish = (result: SpeechAttemptResult): void => {
      if (finished) return;
      finished = true;
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      if (activeUtterance === utterance) activeUtterance = undefined;
      resolve(result);
    };
    utterance.addEventListener("end", () => finish({ spoken: true }), { once: true });
    utterance.addEventListener("error", (event) => {
      const reason = "error" in event && typeof event.error === "string"
        ? event.error
        : "synthesis-failed";
      finish({ spoken: false, reason });
    }, { once: true });
    try {
      synth.resume();
      synth.speak(utterance);
    } catch {
      finish({ spoken: false, reason: "exception" });
      return;
    }

    timeout = globalThis.setTimeout(
      () => finish({ spoken: false, reason: "timeout" }),
      Math.max(4_000, text.length * 320),
    );
  });
}
