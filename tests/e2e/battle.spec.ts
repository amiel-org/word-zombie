import { expect, test, type Locator, type Page } from "@playwright/test";

import { BATTLE_MAPS } from "../../src/game/battleMaps";

const TOTAL_WORDS = 20;
const WALL_HP = 100;
const BREACH_DAMAGE = 15;

interface ZombieRef {
  zombieId: string;
  targetId: string;
  x: number;
  english: string;
  meaningZh: string;
}

interface ReviewRef {
  targetId: string;
  english: string;
  meaningZh: string;
  reason: "wrong-charge" | "natural";
}

interface StoredSession {
  id: string;
  profileId: string;
  status: string;
}

interface StoredEncounter {
  profileId: string;
  wordId: string;
  encounterId: string;
  attempts: number;
  correct: boolean;
  masteryCredit: boolean;
}

interface StoredProgress {
  profiles: Array<{ id: string; name: string }>;
  sessions: StoredSession[];
  logs: StoredEncounter[];
  words: Array<{ profileId: string; wordId: string }>;
}

function desktopOnly(projectName: string, reason: string): void {
  test.skip(projectName !== "desktop-chromium", reason);
}

function ammoFor(page: Page, targetId: string): Locator {
  return page.locator(`.ammo-button[data-target-id="${targetId}"]`);
}

function zombieFor(page: Page, zombieId: string): Locator {
  return page.locator(`.zombie-target-button[data-zombie-id="${zombieId}"]`);
}

async function clickMovingZombie(zombie: Locator): Promise<void> {
  await expect(zombie).toBeVisible();
  await expect(zombie).toBeEnabled();
  await zombie.evaluate((button: HTMLButtonElement) => button.click());
}

async function dragAmmoWithMouse(
  page: Page,
  targetId: string,
  destination: Locator,
  options: { dropBelowPx?: number; expectCollisionLock?: boolean } = {},
): Promise<void> {
  const sourceBox = await ammoFor(page, targetId).boundingBox();
  const destinationBox = await destination.boundingBox();
  if (!sourceBox || !destinationBox) throw new Error("Drag source or destination is not visible");
  const endX = destinationBox.x + destinationBox.width / 2;
  const endY = options.dropBelowPx === undefined
    ? destinationBox.y + destinationBox.height / 2
    : destinationBox.y + destinationBox.height + options.dropBelowPx;
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 7 });
  if (options.expectCollisionLock) {
    expect(endY).toBeGreaterThan(destinationBox.y + destinationBox.height);
    await expect(destination).toHaveClass(/is-drag-over/);
    await expect(page.locator(".ammo-drag-ghost")).toHaveClass(/is-locked/);
  }
  await page.mouse.up();
}

async function dragAmmoWithSyntheticTouch(
  page: Page,
  targetId: string,
  zombieId: string,
): Promise<void> {
  const result = await page.evaluate(({ ammoTargetId, destinationZombieId }) => {
    const source = document.querySelector<HTMLButtonElement>(
      `.ammo-button[data-target-id="${ammoTargetId}"]`,
    );
    const destination = document.querySelector<HTMLButtonElement>(
      `.zombie-target-button[data-zombie-id="${destinationZombieId}"]`,
    );
    if (!source || !destination) return null;
    const sourceRect = source.getBoundingClientRect();
    const destinationRect = destination.getBoundingClientRect();
    const startX = sourceRect.left + sourceRect.width / 2;
    const startY = sourceRect.top + sourceRect.height / 2;
    const endX = destinationRect.left + destinationRect.width / 2;
    const endY = destinationRect.bottom + 34;
    const pointerId = 37;
    const dispatch = (type: string, x: number, y: number, buttons: number) => {
      source.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "touch",
        isPrimary: true,
        clientX: x,
        clientY: y,
        buttons,
      }));
    };
    dispatch("pointerdown", startX, startY, 1);
    dispatch("pointermove", endX, endY, 1);
    const pointerInsideTarget = endX >= destinationRect.left
      && endX <= destinationRect.right
      && endY >= destinationRect.top
      && endY <= destinationRect.bottom;
    const highlighted = destination.classList.contains("is-drag-over");
    const ghostVisible = document.querySelector(".ammo-drag-ghost") !== null;
    const ghostLocked = document.querySelector(".ammo-drag-ghost.is-locked") !== null;
    dispatch("pointerup", endX, endY, 0);
    return { highlighted, ghostVisible, ghostLocked, pointerInsideTarget };
  }, { ammoTargetId: targetId, destinationZombieId: zombieId });

  expect(result).toEqual({
    highlighted: true,
    ghostVisible: true,
    ghostLocked: true,
    pointerInsideTarget: false,
  });
}

async function disableTestAudio(page: Page): Promise<void> {
  for (const setting of ["music", "sfx", "pronunciation"] as const) {
    const button = page.locator(`.start-panel [data-audio-setting="${setting}"]`);
    if (await button.getAttribute("aria-pressed") === "true") await button.click();
  }
}

async function installSpeechSynthesisMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class MockSpeechSynthesisUtterance extends EventTarget {
      lang = "";
      rate = 1;
      pitch = 1;
      volume = 1;
      voice: SpeechSynthesisVoice | null = null;

      constructor(readonly text: string) {
        super();
      }
    }

    const englishVoice = {
      default: true,
      lang: "en-US",
      localService: true,
      name: "Test English",
      voiceURI: "test-english",
    } as SpeechSynthesisVoice;
    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      cancel: () => undefined,
      getVoices: () => [englishVoice],
      pause: () => undefined,
      resume: () => undefined,
      speak: (utterance: MockSpeechSynthesisUtterance) => {
        window.setTimeout(() => {
          const shouldFail = Boolean((window as typeof window & {
            __WORD_ZOMBIE_SPEECH_FAIL__?: boolean;
          }).__WORD_ZOMBIE_SPEECH_FAIL__);
          if (!shouldFail) {
            utterance.dispatchEvent(new Event("end"));
            return;
          }
          const event = new Event("error");
          Object.defineProperty(event, "error", { value: "voice-unavailable" });
          utterance.dispatchEvent(event);
        }, 20);
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
      onvoiceschanged: null,
    };
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: MockSpeechSynthesisUtterance,
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: synth,
    });
  });
}

async function startBattle(
  page: Page,
  weapon = "m4a1",
  controlledPacing = true,
): Promise<void> {
  await page.goto(controlledPacing ? "/?e2e=1" : "/");
  await expect(page.locator("#start-button")).toBeEnabled({ timeout: 20_000 });
  await disableTestAudio(page);
  await page.locator("#weapon-select").selectOption(weapon);
  await page.locator("#start-button").click();
  await expect(page.locator(".game-app")).toHaveAttribute(
    "data-weapon-id",
    weapon === "random" ? /^(m4a1|ak47|mp5)$/ : weapon,
  );
  await expect(page.locator('.zombie-target-button[data-status="approaching"]').first())
    .toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".ammo-button").first()).toBeEnabled();
}

test("verifies English pronunciation before battle on every supported layout", async ({
  page,
}, testInfo) => {
  await installSpeechSynthesisMock(page);
  await page.goto("/?e2e=1");

  const testButton = page.locator("#pronunciation-test");
  const status = page.locator("#pronunciation-test-status");
  await expect(testButton).toBeVisible();
  await expect(testButton).toBeEnabled();
  await testButton.click();
  await expect(status).toHaveText("英文发音正常");
  await expect(status).toHaveAttribute("data-state", "success");

  await page.screenshot({
    path: testInfo.outputPath(`pronunciation-check-success-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await page.evaluate(() => {
    (window as typeof window & { __WORD_ZOMBIE_SPEECH_FAIL__?: boolean })
      .__WORD_ZOMBIE_SPEECH_FAIL__ = true;
  });
  await testButton.click();
  await expect(status).toHaveAttribute("data-state", "error");
  if (testInfo.project.name === "ipad-landscape") {
    await expect(status).toContainText("iPad 设置");
  } else if (testInfo.project.name.startsWith("android-")) {
    await expect(status).toContainText("系统文字转语音");
  } else {
    await expect(status).toContainText("系统英文文字转语音");
  }

  const layout = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".start-panel")?.getBoundingClientRect();
    const button = document.querySelector<HTMLElement>("#pronunciation-test")?.getBoundingClientRect();
    const statusRect = document.querySelector<HTMLElement>("#pronunciation-test-status")
      ?.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      panel: panel?.toJSON(),
      button: button?.toJSON(),
      status: statusRect?.toJSON(),
    };
  });
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.panel).toBeTruthy();
  expect(layout.button?.width).toBeGreaterThanOrEqual(44);
  expect(layout.button?.height).toBeGreaterThanOrEqual(44);
  expect(layout.status?.right).toBeLessThanOrEqual((layout.panel?.right ?? 0) + 1);

  await page.screenshot({
    path: testInfo.outputPath(`pronunciation-check-error-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

async function approachingZombies(page: Page): Promise<ZombieRef[]> {
  return page
    .locator('.zombie-target-button[data-status="approaching"]')
    .evaluateAll((buttons) =>
      buttons.flatMap((button) => {
        const zombieId = (button as HTMLElement).dataset.zombieId;
        const targetId = (button as HTMLElement).dataset.targetId;
        const english = targetId
          ? document.querySelector<HTMLElement>(`.ammo-button[data-target-id="${targetId}"] .ammo-label`)?.textContent?.trim()
          : "";
        const meaningZh = button.querySelector<HTMLElement>(".zombie-target-prompt")
          ?.textContent?.trim();
        return zombieId && targetId && english && meaningZh
          ? [{ zombieId, targetId, english, meaningZh, x: button.getBoundingClientRect().x }]
          : [];
      }),
    );
}

async function waitForApproachingZombie(
  page: Page,
  excludedTargetIds: readonly string[] = [],
  timeout = 15_000,
): Promise<ZombieRef> {
  const excluded = new Set(excludedTargetIds);
  await expect
    .poll(
      async () =>
        (await approachingZombies(page)).filter(
          (zombie) => !excluded.has(zombie.targetId),
        ).length,
      { timeout },
    )
    .toBeGreaterThan(0);

  const candidate = (await approachingZombies(page)).find(
    (zombie) => !excluded.has(zombie.targetId),
  );
  if (!candidate) throw new Error("An approaching zombie disappeared before selection");
  return candidate;
}

async function waitForRightmostApproachingZombie(
  page: Page,
  excludedTargetIds: readonly string[] = [],
  timeout = 15_000,
): Promise<ZombieRef> {
  await waitForApproachingZombie(page, excludedTargetIds, timeout);
  const excluded = new Set(excludedTargetIds);
  const candidates = (await approachingZombies(page)).filter(
    (zombie) => !excluded.has(zombie.targetId),
  );
  return candidates.reduce((rightmost, zombie) =>
    zombie.x > rightmost.x ? zombie : rightmost,
  );
}

async function loadAmmo(page: Page, targetId: string): Promise<void> {
  const ammo = ammoFor(page, targetId);
  await expect(ammo).toBeEnabled();
  await ammo.evaluate((button: HTMLButtonElement) => button.click());
  await expect(ammo).toHaveAttribute("data-loaded", "true");
  await expect(page.locator("#loaded-ammo")).not.toHaveText("未装填");
}

async function shootCorrect(
  page: Page,
  zombie: ZombieRef,
  expectedResolved?: number,
): Promise<void> {
  const result = await page.evaluate(({ zombieId, targetId }) => {
    const ammo = document.querySelector<HTMLButtonElement>(
      `.ammo-button[data-target-id="${targetId}"]`,
    );
    const target = document.querySelector<HTMLButtonElement>(
      `.zombie-target-button[data-zombie-id="${zombieId}"]`,
    );
    if (!ammo || !target) return null;
    const ammoWasEnabled = !ammo.disabled;
    ammo.click();
    const loaded = ammo.dataset.loaded === "true";
    const loadedLabel = document.querySelector("#loaded-ammo")?.textContent ?? "";
    target.click();
    return {
      ammoWasEnabled,
      loaded,
      loadedLabel,
      progress: document.querySelector("#progress-count")?.textContent ?? "",
    };
  }, zombie);
  expect(result).toMatchObject({
    ammoWasEnabled: true,
    loaded: true,
  });
  expect(result?.loadedLabel).not.toBe("未装填");
  if (expectedResolved !== undefined) {
    expect(result?.progress).toBe(`${expectedResolved} / ${TOTAL_WORDS}`);
  }
}

async function fireWrongMatch(
  page: Page,
  ammoTargetId: string,
  victim: ZombieRef,
): Promise<void> {
  if (victim.targetId === ammoTargetId) {
    throw new Error("Wrong-match helper requires different ammo and zombie targets");
  }

  const shot = await page.evaluate(({ zombieId, targetId }) => {
    const ammo = document.querySelector<HTMLButtonElement>(
      `.ammo-button[data-target-id="${targetId}"]`,
    );
    const target = document.querySelector<HTMLButtonElement>(
      `.zombie-target-button[data-zombie-id="${zombieId}"]`,
    );
    if (!ammo || !target) return null;
    const ammoWasEnabled = !ammo.disabled;
    ammo.click();
    const loaded = ammo.dataset.loaded === "true";
    target.click();
    return {
      ammoWasEnabled,
      loaded,
      status: target.dataset.status,
      disabled: target.disabled,
    };
  }, { zombieId: victim.zombieId, targetId: ammoTargetId });
  expect(shot).toMatchObject({
    ammoWasEnabled: true,
    loaded: true,
    status: "charging",
    disabled: true,
  });
  await expect(page.locator("#streak-value")).toHaveText("0");
}

async function sendWrongZombieToWall(
  page: Page,
  ammoTargetId: string,
  victim: ZombieRef,
  expectedResolved: number,
  expectedHp: number,
): Promise<void> {
  await fireWrongMatch(page, ammoTargetId, victim);
  await expect(page.locator("#health-value")).toHaveText(String(expectedHp), {
    timeout: 15_000,
  });
  await expect(page.locator("#progress-count")).toHaveText(
    `${expectedResolved} / ${TOTAL_WORDS}`,
  );
  if (expectedHp > 0) {
    await expect(page.locator("#correction-screen")).toBeHidden();
    await expect(page.locator("#complete-screen")).toBeHidden();
    await expect(page.locator(".ammo-button").first()).toBeEnabled();
  }
}

async function acknowledgeReviewSequence(
  page: Page,
  reviews: readonly ReviewRef[],
): Promise<void> {
  if (reviews.length === 0) throw new Error("At least one review item is required");

  const modal = page.locator("#correction-screen");
  await expect(modal).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#complete-screen")).toBeHidden();

  for (const [index, review] of reviews.entries()) {
    await expect(page.locator("#correction-kicker")).toContainText(
      `${index + 1}/${reviews.length}`,
    );
    await expect(page.locator("#correction-title")).toHaveText(review.english);
    await expect(page.locator("#correction-meaning")).toHaveText(review.meaningZh);
    await expect(page.locator("#correction-phonetic")).toHaveText("跟随发音朗读一遍");
    await expect(page.locator("#correction-reason")).toContainText(
      review.reason === "wrong-charge" ? "错配" : "没有及时作答",
    );
    await expect(page.locator("#correction-confirm")).toHaveText(
      index + 1 < reviews.length ? "知道了，下一个" : "知道了，看结果",
    );
    await page.locator("#correction-confirm").click();
  }
  await expect(modal).toBeHidden();
  await expect(page.locator("#complete-screen")).toBeVisible({ timeout: 3_000 });
}

async function readCanvasPixels(page: Page): Promise<{
  sampled: number;
  colored: number;
  colorBuckets: number;
}> {
  return page.locator("canvas").evaluate(async (element) => {
    const canvas = element as HTMLCanvasElement;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const width = canvas.width;
    const height = canvas.height;
    let pixels: Uint8Array | Uint8ClampedArray;
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl) {
      pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } else {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas has no readable rendering context");
      pixels = context.getImageData(0, 0, width, height).data;
    }

    const pixelCount = width * height;
    const stride = Math.max(1, Math.floor(pixelCount / 20_000));
    const buckets = new Set<number>();
    let sampled = 0;
    let colored = 0;
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += stride) {
      const offset = pixelIndex * 4;
      const red = pixels[offset] ?? 0;
      const green = pixels[offset + 1] ?? 0;
      const blue = pixels[offset + 2] ?? 0;
      const alpha = pixels[offset + 3] ?? 0;
      sampled += 1;
      if (alpha > 0 && red + green + blue > 30) colored += 1;
      buckets.add((red >> 5) * 64 + (green >> 5) * 8 + (blue >> 5));
    }

    return { sampled, colored, colorBuckets: buckets.size };
  });
}

async function readProgress(page: Page): Promise<StoredProgress> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("word-zombie-learning-v2");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(
      ["profiles", "sessions", "encounterLogs", "wordProgress"],
      "readonly",
    );
    const readAll = <T>(storeName: string): Promise<T[]> =>
      new Promise((resolve, reject) => {
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      });
    const [profiles, sessions, logs, words] = await Promise.all([
      readAll<{ id: string; name: string }>("profiles"),
      readAll<StoredSession>("sessions"),
      readAll<StoredEncounter>("encounterLogs"),
      readAll<{ profileId: string; wordId: string }>("wordProgress"),
    ]);
    database.close();
    return { profiles, sessions, logs, words };
  });
}

test("shows six concurrent word bullets in a responsive animated battle", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const failedAssets: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/assets/") && response.status() >= 400) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/assets/")) {
      failedAssets.push(`${request.failure()?.errorText ?? "failed"} ${request.url()}`);
    }
  });

  await page.goto("/?e2e=1");
  await expect(page.locator("#start-button")).toBeEnabled({ timeout: 20_000 });
  await page.locator('[data-stage="junior"]').click();
  await expect(page.locator("#start-title")).toHaveText("词库待导入");
  await expect(page.locator("#course-version")).toHaveText("教材版本待导入");
  await expect(page.locator("#start-button")).toBeDisabled();
  await page.locator('[data-stage="senior"]').click();
  await expect(page.locator("#course-version")).toHaveText("蝶变英语词频分类 · 3,180词");
  await expect(page.locator("#course-status")).toContainText("首答正确 14/20");
  await expect(page.locator("#weapon-select option")).toHaveCount(4);
  await expect(page.locator('#weapon-select option[value="m4a1"]')).toHaveText("M4A1");
  await expect(page.locator('#weapon-select option[value="ak47"]')).toHaveText("AK-47");
  await expect(page.locator('#weapon-select option[value="mp5"]')).toHaveText("MP5");
  await expect(page.locator('.start-panel [data-audio-setting="music"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator('.start-panel [data-audio-setting="music"]').click();
  await disableTestAudio(page);
  await expect(page.locator('.start-panel [data-audio-setting="music"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator('.battle-header [data-audio-setting="music"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(await page.evaluate(() => localStorage.getItem("word-zombie.audio.v1")))
    .toContain('"music":false');

  await page.locator("#weapon-select").selectOption("m4a1");
  await page.locator("#start-button").click();
  const approaching = page.locator('.zombie-target-button[data-status="approaching"]');
  await expect
    .poll(async () => approaching.count(), { timeout: 7_000 })
    .toBeGreaterThanOrEqual(2);
  await expect(approaching).toHaveCount(6, { timeout: 15_000 });
  await expect(page.locator(".ammo-button")).toHaveCount(6);
  await expect(page.locator("#battle-counts")).toContainText("来袭 6");
  await expect(page.locator('.battle-header [data-audio-setting="music"]')).toBeVisible();

  const observedMaximum = await page.evaluate(async () => {
    let maximum = 0;
    const deadline = performance.now() + 700;
    while (performance.now() < deadline) {
      maximum = Math.max(
        maximum,
        document.querySelectorAll(".zombie-target-button").length,
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return maximum;
  });
  expect(observedMaximum).toBe(6);

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const pixels = await readCanvasPixels(page);
  expect(pixels.colored / pixels.sampled).toBeGreaterThan(0.35);
  expect(pixels.colorBuckets).toBeGreaterThan(12);
  const walkFrameA = await canvas.screenshot();
  await page.waitForTimeout(350);
  const walkFrameB = await canvas.screenshot();
  expect(walkFrameA.equals(walkFrameB)).toBe(false);

  const stableTargetId = await approaching.first().getAttribute("data-zombie-id");
  expect(stableTargetId).toBeTruthy();
  const labelMotion = await page.evaluate(async (zombieId) => {
    const tops = new Set<string>();
    const deadline = performance.now() + 720;
    while (performance.now() < deadline) {
      const label = document.querySelector<HTMLElement>(
        `.zombie-target-button[data-zombie-id="${zombieId}"]`,
      );
      if (label) {
        tops.add(label.style.top);
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return { tops: [...tops] };
  }, stableTargetId);
  expect(labelMotion.tops).toHaveLength(1);

  const layout = await page.evaluate(() => {
    const visibleButtons = [
      ...document.querySelectorAll<HTMLElement>(
        ".ammo-button, .zombie-target-button, .segment-button, #start-button, #replay-button",
      ),
    ].filter((element) => element.offsetParent !== null);
    const buttonRects = visibleButtons.map((element) => ({
      name: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.id,
      rect: element.getBoundingClientRect().toJSON(),
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    }));
    const regions = [".battle-header", ".battle-workspace", ".ammo-dock"]
      .map((selector) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect())
      .filter((rect): rect is DOMRect => Boolean(rect));
    const regionOverlaps: number[] = [];
    for (let left = 0; left < regions.length; left += 1) {
      for (let right = left + 1; right < regions.length; right += 1) {
        const width = Math.min(regions[left].right, regions[right].right)
          - Math.max(regions[left].left, regions[right].left);
        const height = Math.min(regions[left].bottom, regions[right].bottom)
          - Math.max(regions[left].top, regions[right].top);
        if (width > 1 && height > 1) regionOverlaps.push(width * height);
      }
    }
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: document.documentElement.clientHeight,
      buttonRects,
      regionOverlaps,
    };
  });
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.regionOverlaps).toEqual([]);
  for (const button of layout.buttonRects) {
    expect(button.width, `${button.name} width`).toBeGreaterThanOrEqual(44);
    expect(button.height, `${button.name} height`).toBeGreaterThanOrEqual(44);
    expect(button.rect.x, `${button.name} left edge`).toBeGreaterThanOrEqual(-1);
    expect(button.rect.x + button.rect.width, `${button.name} right edge`)
      .toBeLessThanOrEqual(layout.viewportWidth + 1);
  }
  expect(failedAssets).toEqual([]);

  await page.screenshot({
    path: testInfo.outputPath(`battle-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test("keeps local profiles isolated, survives reload, and deletes one profile safely", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo.project.name, "profile persistence flow runs once");
  test.setTimeout(150_000);

  await startBattle(page);
  const childWord = await waitForRightmostApproachingZombie(page);
  await shootCorrect(page, childWord, 1);
  await expect.poll(async () => (await readProgress(page)).logs.length).toBe(1);

  await page.reload();
  await expect(page.locator("#start-button")).toBeEnabled({ timeout: 20_000 });
  await expect(page.locator("#profile-select")).toHaveValue("profile-child");
  await expect(page.locator("#selected-progress")).toContainText("未接触 659");

  await page.locator("#learning-button").click();
  await expect(page.locator("#learning-screen")).toBeVisible();
  await expect(page.locator("#dashboard-summary")).toContainText("已练 0 局");
  await page.locator("#profile-name-input").fill("朋友测试档案");
  await page.locator("#profile-create-form button[type=submit]").click();
  await expect(page.locator("#learning-message")).toContainText("已新建档案");
  await expect(page.locator("#dashboard-summary")).toContainText("首答正确率 暂无");
  await page.screenshot({
    path: testInfo.outputPath("learning-dashboard-desktop.png"),
    fullPage: true,
  });
  const friendProfileId = await page.locator("#dashboard-profile-select").inputValue();
  expect(friendProfileId).not.toBe("profile-child");
  expect(friendProfileId).not.toBe("guest");
  await page.locator("#learning-close").click();

  await disableTestAudio(page);
  await page.locator("#weapon-select").selectOption("m4a1");
  await page.locator("#start-button").click();
  const friendWord = await waitForRightmostApproachingZombie(page);
  await shootCorrect(page, friendWord, 1);
  await expect.poll(async () => (await readProgress(page)).logs.length).toBe(2);
  const persisted = await readProgress(page);
  expect(new Set(persisted.words.map((word) => word.profileId))).toEqual(
    new Set(["profile-child", friendProfileId]),
  );

  await page.reload();
  await expect(page.locator("#start-button")).toBeEnabled({ timeout: 20_000 });
  await expect(page.locator("#profile-select")).toHaveValue(friendProfileId);
  await expect(page.locator('#profile-select option[value="guest"]')).toHaveCount(0);
  await page.locator("#learning-button").click();
  await expect(page.locator("#profile-delete")).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#profile-delete").click();
  await expect(page.locator("#learning-message")).toContainText("已删除");
  await expect(page.locator("#dashboard-profile-select")).toHaveValue("profile-child");
  await expect(page.locator("#profile-delete")).toBeDisabled();

  const afterDelete = await readProgress(page);
  expect(afterDelete.profiles.map((profile) => profile.id)).toEqual(["profile-child"]);
  expect(afterDelete.sessions).toHaveLength(1);
  expect(afterDelete.logs).toHaveLength(1);
  expect(new Set(afterDelete.words.map((word) => word.profileId))).toEqual(
    new Set(["profile-child"]),
  );
});

test("blocks battle start when persistent browser storage is unavailable", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo.project.name, "storage failure flow runs once");
  await page.addInitScript(() => {
    const factory = window.indexedDB;
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: new Proxy(factory, {
        get(target, property) {
          if (property === "open") {
            return () => {
              throw new DOMException("Storage disabled for test", "InvalidStateError");
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    });
  });

  await page.goto("/?e2e=1");
  await expect(page.locator("#selected-progress")).toContainText("已停止开局", {
    timeout: 20_000,
  });
  await expect(page.locator("#start-button")).toBeDisabled();
  await expect(page.locator("#profile-select")).toBeDisabled();
  await expect(page.locator("#profile-select")).toContainText("学习记录不可用");
  await expect(page.locator('#profile-select option[value="guest"]')).toHaveCount(0);
});

test("rotates all eight maps per profile and loops on the ninth new round", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.goto("/?e2e=1");
  await disableTestAudio(page);
  const rotation = [...BATTLE_MAPS, BATTLE_MAPS[0]];
  let previousFrame: Uint8Array | null = null;

  for (const [index, map] of rotation.entries()) {
    await expect(page.locator("#start-button")).toBeEnabled({ timeout: 20_000 });
    await page.locator("#start-button").click();
    await expect(page.locator("#game-canvas")).toHaveAttribute("data-map-id", map.id, {
      timeout: 20_000,
    });
    await expect(page.locator(".chapter-name")).toContainText(map.name);
    await page.waitForTimeout(650);

    const pixels = await readCanvasPixels(page);
    expect(pixels.colored / pixels.sampled).toBeGreaterThan(0.35);
    expect(pixels.colorBuckets).toBeGreaterThan(5);
    const frame = await page.locator("canvas").screenshot({
      path: index < BATTLE_MAPS.length
        ? testInfo.outputPath(`map-${index + 1}-${map.id}.png`)
        : undefined,
    });
    if (previousFrame && index < BATTLE_MAPS.length) {
      const isSameFrame = frame.length === previousFrame.length
        && frame.every((value: number, byteIndex: number) => value === previousFrame![byteIndex]);
      expect(isSameFrame).toBe(false);
    }
    if (index < BATTLE_MAPS.length) previousFrame = frame;

    if (index < rotation.length - 1) await page.reload();
  }

  expect((await readProgress(page)).sessions).toHaveLength(rotation.length);
});

test("supports mouse and touch dragging without revealing the answer before drop", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo.project.name, "drag contract runs once with mouse and synthetic touch");
  await startBattle(page);

  const correctTarget = await waitForRightmostApproachingZombie(page);
  await dragAmmoWithMouse(page, correctTarget.targetId, page.locator(".brand-name"));
  await expect(page.locator("#progress-count")).toHaveText(`0 / ${TOTAL_WORDS}`);
  await expect(ammoFor(page, correctTarget.targetId)).toHaveAttribute("data-loaded", "false");
  await expect(zombieFor(page, correctTarget.zombieId)).toHaveAttribute(
    "data-status",
    "approaching",
  );

  await dragAmmoWithMouse(
    page,
    correctTarget.targetId,
    zombieFor(page, correctTarget.zombieId),
    { dropBelowPx: 34, expectCollisionLock: true },
  );
  await expect(page.locator("#progress-count")).toHaveText(`1 / ${TOTAL_WORDS}`);
  await expect(zombieFor(page, correctTarget.zombieId)).toHaveCount(0, { timeout: 3_000 });

  const victim = await waitForApproachingZombie(page, [correctTarget.targetId]);
  const wrongAmmo = (await approachingZombies(page)).find(
    (candidate) => candidate.targetId !== victim.targetId,
  );
  if (!wrongAmmo) throw new Error("No wrong ammo candidate available for touch drag");
  await dragAmmoWithSyntheticTouch(page, wrongAmmo.targetId, victim.zombieId);
  await expect(zombieFor(page, victim.zombieId)).toHaveAttribute("data-status", "charging");
  await expect(zombieFor(page, victim.zombieId)).toBeDisabled();
  await expect(page.locator("#loaded-ammo")).toHaveText("未装填");
  await expect(page.locator(".ammo-drag-ghost")).toHaveCount(0);
});

test("requires ammo, kills a correct target, and does not interrupt after a wrong breach", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo.project.name, "interaction contract runs once");
  test.setTimeout(150_000);
  await startBattle(page);

  const correctTarget = await waitForRightmostApproachingZombie(page);
  const untouchedButton = zombieFor(page, correctTarget.zombieId);
  await clickMovingZombie(untouchedButton);
  await expect(page.locator("#feedback")).toContainText("请先装填");
  await expect(untouchedButton).toHaveAttribute("data-status", "approaching");
  await expect(page.locator("#health-value")).toHaveText(String(WALL_HP));
  await expect(page.locator("#progress-count")).toHaveText(`0 / ${TOTAL_WORDS}`);

  await shootCorrect(page, correctTarget, 1);
  await expect(page.locator("#score-value")).toHaveText("100");
  await expect(page.locator("#streak-value")).toHaveText("1");
  await expect(zombieFor(page, correctTarget.zombieId)).toHaveCount(0, {
    timeout: 3_000,
  });

  await expect
    .poll(async () => (await approachingZombies(page)).length, { timeout: 8_000 })
    .toBeGreaterThanOrEqual(2);
  const active = await approachingZombies(page);
  const victim = active.reduce((rightmost, zombie) =>
    zombie.x > rightmost.x ? zombie : rightmost,
  );
  const wrongAmmoTarget = active.find((zombie) => zombie.targetId !== victim.targetId);
  if (!wrongAmmoTarget) throw new Error("Two distinct targets are required for wrong-match test");

  await loadAmmo(page, wrongAmmoTarget.targetId);
  const chargeEvidence = await page.evaluate(async (zombieId) => {
    const button = document.querySelector<HTMLButtonElement>(
      `.zombie-target-button[data-zombie-id="${zombieId}"]`,
    );
    if (!button) return null;
    button.click();
    const startX = Number(button.dataset.worldX);
    const status = button.dataset.status;
    const disabled = button.disabled;
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    const current = document.querySelector<HTMLButtonElement>(
      `.zombie-target-button[data-zombie-id="${zombieId}"]`,
    );
    if (!current) return null;
    const currentX = Number(current.dataset.worldX);
    return {
      status,
      disabled,
      distance: startX - currentX,
    };
  }, victim.zombieId);
  expect(chargeEvidence).not.toBeNull();
  expect(chargeEvidence).toMatchObject({
    status: "charging",
    disabled: true,
  });
  expect(chargeEvidence?.distance ?? 0).toBeGreaterThan(8);

  await expect(page.locator("#health-value")).toHaveText("85", { timeout: 15_000 });
  await expect(page.locator("#progress-count")).toHaveText(`2 / ${TOTAL_WORDS}`);
  await expect(page.locator("#correction-screen")).toBeHidden();
  await expect(page.locator("#feedback")).toContainText("关后统一纠错");
  await expect(page.locator(".ammo-button").first()).toBeEnabled();
  await expect
    .poll(async () => (await readProgress(page)).logs.length)
    .toBe(2);
  const stored = await readProgress(page);
  expect(stored.logs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        wordId: correctTarget.targetId,
        attempts: 1,
        correct: true,
        masteryCredit: true,
      }),
      expect.objectContaining({
        wordId: victim.targetId,
        attempts: 1,
        correct: false,
        masteryCredit: false,
      }),
    ]),
  );
});

test("records an untouched natural breach and continues without a modal", async ({ page }, testInfo) => {
  desktopOnly(testInfo.project.name, "natural timing flow runs once");
  test.setTimeout(180_000);
  await startBattle(page, "mp5", false);

  await expect
    .poll(async () => (await readProgress(page)).logs.length, { timeout: 55_000 })
    .toBeGreaterThanOrEqual(1);
  const stored = await readProgress(page);
  expect(stored.logs[0]).toEqual(
    expect.objectContaining({
      attempts: 0,
      correct: false,
      masteryCredit: false,
    }),
  );
  expect(Number(await page.locator("#health-value").textContent())).toBeLessThan(WALL_HP);
  await expect(page.locator("#feedback")).toContainText("冲破防线");
  await expect(page.locator("#feedback")).toContainText("关后统一纠错");
  await expect(page.locator("#correction-screen")).toBeHidden();
  await expect(page.locator(".ammo-button").first()).toBeEnabled();
});

test("passes at exactly fourteen of twenty after reviewing six errors", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo.project.name, "complete progression flow runs once");
  test.setTimeout(300_000);
  await startBattle(page, "ak47");

  for (let resolved = 1; resolved <= 13; resolved += 1) {
    const zombie = await waitForRightmostApproachingZombie(page);
    await shootCorrect(page, zombie, resolved);
  }

  const anchor = await waitForRightmostApproachingZombie(page);
  const reviews: ReviewRef[] = [];
  for (let wrong = 1; wrong <= 6; wrong += 1) {
    const victim = await waitForRightmostApproachingZombie(page, [anchor.targetId]);
    reviews.push({ ...victim, reason: "wrong-charge" });
    await sendWrongZombieToWall(
      page,
      anchor.targetId,
      victim,
      13 + wrong,
      WALL_HP - wrong * BREACH_DAMAGE,
    );
  }
  await shootCorrect(page, anchor, TOTAL_WORDS);

  await expect(page.locator("#complete-screen")).toBeHidden();
  await acknowledgeReviewSequence(page, reviews);
  await expect(page.locator("#complete-title")).toHaveText("高频词防线已守住");
  await expect(page.locator("#complete-rating")).toContainText("1 星");
  await expect(page.locator("#complete-health")).toHaveText("防线剩余 10 点生命");
  await expect(page.locator("#complete-detail")).toContainText("本局首答正确 14/20");
  await expect(page.locator("#progress-count")).toHaveText(`20 / ${TOTAL_WORDS}`);

});

test("reviews all errors before ending when the seventh breach reduces HP to zero", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo.project.name, "health failure flow runs once");
  test.setTimeout(240_000);
  await startBattle(page);

  const anchor = await waitForRightmostApproachingZombie(page);
  const reviews: ReviewRef[] = [];
  for (let breach = 1; breach <= 7; breach += 1) {
    const victim = await waitForRightmostApproachingZombie(page, [anchor.targetId]);
    reviews.push({ ...victim, reason: "wrong-charge" });
    await sendWrongZombieToWall(
      page,
      anchor.targetId,
      victim,
      breach,
      Math.max(0, WALL_HP - breach * BREACH_DAMAGE),
    );
  }

  await expect(page.locator("#health-value")).toHaveText("0");
  await expect(page.locator("#complete-screen")).toBeHidden();
  await acknowledgeReviewSequence(page, reviews);
  await expect(page.locator("#complete-title")).toHaveText("防线失守，重新部署");
  await expect(page.locator("#complete-health")).toHaveText("防线剩余 0 点生命");
  await expect(page.locator("#progress-count")).toHaveText(`7 / ${TOTAL_WORDS}`);
});

for (const weapon of ["m4a1", "ak47", "mp5"] as const) {
  test(`deploys the selected ${weapon.toUpperCase()} weapon`, async ({ page }, testInfo) => {
    desktopOnly(testInfo.project.name, "weapon selection runs once per weapon");
    await startBattle(page, weapon);
    await expect(page.locator("#game-canvas")).toHaveAttribute("data-weapon-id", weapon);
    await expect(page.locator("#weapon-status")).toHaveText(
      weapon === "ak47" ? "AK-47" : weapon.toUpperCase(),
    );
  });
}

test("reloads from the service worker while offline", async ({ page, context }, testInfo) => {
  desktopOnly(testInfo.project.name, "offline flow runs once");
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.locator("#start-button")).toBeEnabled({ timeout: 45_000 });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(
      async () => page.evaluate(async () => {
        const cacheNames = await caches.keys();
        const cachedRequests = (
          await Promise.all(
            cacheNames.map(async (cacheName) => (await caches.open(cacheName)).keys()),
          )
        ).flat();
        return cachedRequests.some(
          (request) => new URL(request.url).pathname === "/index.html",
        );
      }),
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#start-button")).toBeEnabled({ timeout: 45_000 });
    await expect(page.locator("#course-version")).toHaveText("蝶变英语词频分类 · 3,180词");
    await expect(page.locator("#weapon-select option")).toHaveCount(4);
  } finally {
    await context.setOffline(false);
  }
});
