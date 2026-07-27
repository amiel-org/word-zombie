import Phaser from "phaser";

import type { FrequencyBand } from "../../content/frequencyTypes";
import type {
  MatchEncounterContent,
  MatchLevelContent,
} from "../../content/matchContentTypes";
import {
  createMatchBattleState,
  fireAtZombie,
  loadAmmo,
  resolveBreach,
  spawnZombie,
  type MatchBattleState,
} from "../../core/matchBattleEngine";
import {
  CHARGE_SPEED,
  getMatchWavePacing,
  MAX_ACTIVE_ZOMBIES,
} from "../../core/matchWavePacing";
import {
  evaluateLevel,
  type LevelFailureReason,
  type LevelStars,
} from "../../core/levelEvaluation";
import {
  completeSession,
  recordEncounter,
} from "../../storage/progressDb";
import type { AttemptCount } from "../../storage/types";
import {
  buildZombieVisualDeck,
  getGuardTextureKey,
  getZombieMotionStyle,
  getWeaponTextureKey,
  isWeaponSelection,
  pickDifferentVisual,
  WEAPON_OPTIONS,
  type WeaponId,
  type WeaponSelection,
  type ZombieMotionStyle,
  ZOMBIE_TEXTURE_KEYS,
  type ZombieTextureKey,
} from "../arsenal";
import {
  BATTLE_MAPS,
  getBattleMap,
  type BattleMapId,
} from "../battleMaps";
import {
  emitBattleSound,
  emitBattleState,
  emitLearningProgressChanged,
  emitPronunciationCue,
  gameEvents,
  type BattleCorrectionView,
  type BattleViewState,
  type DragFireEventDetail,
  type StartEventDetail,
} from "../events";

const GAME_WIDTH = 1280;
const GAME_HEIGHT = 800;
const WALL_X = 205;
const SPAWN_X = 1195;
const FRONT_RANK_X = 965;
const LANE_Y = [285, 470, 655] as const;
const INITIAL_FORMATION_SIZE = 6;
const MIN_SAME_LANE_GAP = 150;
const STATE_PUBLISH_INTERVAL_MS = 70;
const E2E_CONTROLLED_PACING = typeof window !== "undefined"
  && new URLSearchParams(window.location.search).get("e2e") === "1";

type ActiveZombieStatus = "approaching" | "charging";
type QueuedCorrection = Omit<BattleCorrectionView, "reviewIndex" | "reviewTotal">;

interface RuntimeZombie {
  id: string;
  content: MatchEncounterContent;
  container: Phaser.GameObjects.Container;
  body?: Phaser.GameObjects.Image;
  bodyScaleX: number;
  bodyScaleY: number;
  motionStyle: ZombieMotionStyle;
  shadow: Phaser.GameObjects.Ellipse;
  marker: Phaser.GameObjects.Arc;
  lane: number;
  baseY: number;
  baseSpeed: number;
  phaseOffset: number;
  spawnedAt: number;
  spawnOrder: number;
  status: ActiveZombieStatus;
  chargeMoveAt: number;
  lastDustAt: number;
  lastFootstepAt: number;
  footstepSide: -1 | 1;
  resolved: boolean;
}

const ZOMBIE_MOTION_PROFILES: Record<ZombieMotionStyle, {
  frequency: number;
  containerLift: number;
  containerAngle: number;
  bodyShift: number;
  bodyLift: number;
  bodyAngle: number;
  bodyStretch: number;
  footstepInterval: number;
}> = {
  shuffle: {
    frequency: 0.0095,
    containerLift: 7,
    containerAngle: 1.5,
    bodyShift: 4,
    bodyLift: 4,
    bodyAngle: 2.6,
    bodyStretch: 0.02,
    footstepInterval: 410,
  },
  drag: {
    frequency: 0.0068,
    containerLift: 4,
    containerAngle: 1.1,
    bodyShift: 3,
    bodyLift: 2,
    bodyAngle: 1.8,
    bodyStretch: 0.012,
    footstepInterval: 540,
  },
  twitch: {
    frequency: 0.013,
    containerLift: 5,
    containerAngle: 2.4,
    bodyShift: 6,
    bodyLift: 4,
    bodyAngle: 4.4,
    bodyStretch: 0.028,
    footstepInterval: 330,
  },
  jog: {
    frequency: 0.015,
    containerLift: 11,
    containerAngle: 2.5,
    bodyShift: 7,
    bodyLift: 7,
    bodyAngle: 4.2,
    bodyStretch: 0.034,
    footstepInterval: 245,
  },
  stomp: {
    frequency: 0.0062,
    containerLift: 8,
    containerAngle: 0.8,
    bodyShift: 2,
    bodyLift: 5,
    bodyAngle: 1.2,
    bodyStretch: 0.016,
    footstepInterval: 570,
  },
};

interface AmmoSelectDetail {
  targetId: string;
}

interface ZombieSelectDetail {
  zombieId: string;
}

export class BattleScene extends Phaser.Scene {
  private battleState: MatchBattleState = createMatchBattleState();
  private readonly runtimeZombies = new Map<string, RuntimeZombie>();
  private weaponContainer?: Phaser.GameObjects.Container;
  private weaponRig?: Phaser.GameObjects.Container;
  private weaponImage?: Phaser.GameObjects.Image;
  private weaponStatusLight?: Phaser.GameObjects.Arc;
  private backgroundImage?: Phaser.GameObjects.Image;
  private mapTitle?: Phaser.GameObjects.Text;
  private weaponAimY: number = LANE_Y[1];
  private weaponTargetY: number = LANE_Y[1];
  private weaponBusyUntil = 0;
  private readonly weaponIdlePhase = Math.random() * Math.PI * 2;
  private spawnedCount = 0;
  private running = false;
  private phase: BattleViewState["phase"] = "ready";
  private feedback = "选择词频和武器，开始训练";
  private nextSpawnAt = Number.POSITIVE_INFINITY;
  private lastStatePublishAt = 0;
  private weaponId: WeaponId = "m4a1";
  private zombieVisualDeck: ZombieTextureKey[] = [];
  private recordedEncounterIds = new Set<string>();
  private sessionId: string | null = null;
  private storageQueue: Promise<void> = Promise.resolve();
  private sessionFinalized = false;
  private stars: LevelStars = 0;
  private failureReason: LevelFailureReason = null;
  private correction: BattleCorrectionView | null = null;
  private readonly correctionQueue: QueuedCorrection[] = [];
  private correctionIndex = 0;
  private finalPhase: "complete" | "failed" = "failed";
  private finalFeedback = "";
  private levelContent: MatchLevelContent | null = null;
  private profileId: string | null = null;
  private frequencyBand: FrequencyBand = "high";
  private mapId: BattleMapId = BATTLE_MAPS[0].id;
  private pendingMapLoadId: BattleMapId | null = null;
  private progressSaveFailed = false;

  private readonly onStart = (event: Event): void => {
    const detail = (event as CustomEvent<StartEventDetail>).detail;
    const selection = isWeaponSelection(detail?.weaponSelection)
      ? detail.weaponSelection
      : "random";
    if (
      !detail?.content
      || !detail.band
      || !detail.profileId
      || !detail.sessionId
      || !detail.mapId
    ) return;
    this.startBattle(
      selection,
      detail.content,
      detail.profileId,
      detail.band,
      detail.sessionId,
      detail.mapId,
    );
  };

  private readonly onAmmoSelect = (event: Event): void => {
    const { targetId } = (event as CustomEvent<AmmoSelectDetail>).detail;
    this.selectAmmo(targetId);
  };

  private readonly onZombieSelect = (event: Event): void => {
    const { zombieId } = (event as CustomEvent<ZombieSelectDetail>).detail;
    this.shootZombie(zombieId);
  };

  private readonly onDragFire = (event: Event): void => {
    const { targetId, zombieId } = (event as CustomEvent<DragFireEventDetail>).detail;
    this.fireDraggedAmmo(targetId, zombieId);
  };

  private readonly onCorrectionConfirm = (): void => {
    this.confirmCorrection();
  };

  constructor() {
    super("battle");
  }

  preload(): void {
    const initialMap = BATTLE_MAPS[0];
    this.load.image(initialMap.textureKey, initialMap.assetPath);
    this.load.image("zombie-scout", "/assets/battle/zombie-scout.png");
    this.load.image("zombie-scholar", "/assets/battle/zombie-scholar.png");
    this.load.image("zombie-athlete", "/assets/battle/zombie-athlete.png");
    this.load.image("zombie-builder", "/assets/battle/zombie-builder.png");
    this.load.image("zombie-gentleman", "/assets/battle/zombie-gentleman.png");
    this.load.image("zombie-musician", "/assets/battle/zombie-musician.png");
    this.load.image("zombie-female", "/assets/battle/zombie-female.png");
    this.load.image("zombie-teacher", "/assets/battle/zombie-teacher.png");
    this.load.image("zombie-math-teacher", "/assets/battle/zombie-math-teacher.png");
    this.load.image("zombie-pe-teacher", "/assets/battle/zombie-pe-teacher.png");
    this.load.image("zombie-director", "/assets/battle/zombie-director.png");
    this.load.image("weapon-m4a1", "/assets/battle/weapon-m4a1.png");
    this.load.image("weapon-ak47", "/assets/battle/weapon-ak47.png");
    this.load.image("weapon-mp5", "/assets/battle/weapon-mp5.png");
    this.load.image("guard-m4a1", "/assets/battle/guard-m4a1.png");
    this.load.image("guard-ak47", "/assets/battle/guard-ak47.png");
    this.load.image("guard-mp5", "/assets/battle/guard-mp5.png");
    this.load.svg("decor-grass", "/assets/battle/decor-grass.svg");
    this.load.image("decor-sign", "/assets/battle/decor-sign.png");
  }

  create(): void {
    this.createBackdrop();
    this.createLanes();
    this.createDefenseLine();

    gameEvents.addEventListener("battle-start", this.onStart);
    gameEvents.addEventListener("battle-ammo-select", this.onAmmoSelect);
    gameEvents.addEventListener("battle-zombie-select", this.onZombieSelect);
    gameEvents.addEventListener("battle-drag-fire", this.onDragFire);
    gameEvents.addEventListener("battle-correction-confirm", this.onCorrectionConfirm);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameEvents.removeEventListener("battle-start", this.onStart);
      gameEvents.removeEventListener("battle-ammo-select", this.onAmmoSelect);
      gameEvents.removeEventListener("battle-zombie-select", this.onZombieSelect);
      gameEvents.removeEventListener("battle-drag-fire", this.onDragFire);
      gameEvents.removeEventListener("battle-correction-confirm", this.onCorrectionConfirm);
    });

    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      if (!this.running || this.correction || event.key < "1" || event.key > "6") return;
      const ammo = this.availableAmmo;
      const selected = ammo[Number(event.key) - 1];
      if (selected) this.selectAmmo(selected.content.targetId);
    });

    this.publishState();
  }

  update(time: number, delta: number): void {
    this.animateWeapon(time, delta);
    if (!this.running) return;

    const breaches: string[] = [];
    for (const zombie of this.runtimeZombies.values()) {
      if (zombie.resolved) continue;
      this.animateZombie(zombie, time, delta);
      if (zombie.container.x <= WALL_X + 36) breaches.push(zombie.id);
    }
    for (const zombieId of breaches) {
      this.handleBreach(zombieId);
      if (!this.running) break;
    }

    this.trySpawnNext(time);
    if (time - this.lastStatePublishAt >= STATE_PUBLISH_INTERVAL_MS) {
      this.publishState();
      this.lastStatePublishAt = time;
    }
  }

  private createBackdrop(): void {
    const initialMap = BATTLE_MAPS[0];
    if (this.textures.exists(initialMap.textureKey)) {
      this.backgroundImage = this.add
        .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, initialMap.textureKey)
        .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
        .setDepth(-100);
    } else {
      const background = this.add.graphics().setDepth(-100);
      background.fillGradientStyle(0xb9cfad, 0xe8d6a0, 0x71936c, 0xb58a53, 1);
      background.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
    this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      0x102827,
      0.18,
    );
    this.add.rectangle(GAME_WIDTH / 2, 52, GAME_WIDTH, 104, 0x0f2927, 0.76);
    this.mapTitle = this.add.text(38, 26, `WORD DEFENSE  ·  ${initialMap.name}`, {
      fontFamily: '"Arial Black", "Microsoft YaHei", sans-serif',
      fontSize: "24px",
      color: "#fff5d6",
    });
    this.createScenery();
  }

  private createScenery(): void {
    if (this.textures.exists("decor-sign")) {
      const sign = this.add.image(1080, 152, "decor-sign").setDepth(6).setAlpha(0.9);
      this.fitImage(sign, 220, 86);
      this.add.text(1080, 148, "词频训练", {
        fontFamily: '"Microsoft YaHei", sans-serif',
        fontSize: "19px",
        fontStyle: "bold",
        color: "#fff0b8",
        stroke: "#5d3c1d",
        strokeThickness: 4,
      }).setOrigin(0.5).setDepth(7).setAngle(-1);
    }

    if (this.textures.exists("decor-grass")) {
      const placements = [
        { x: 485, y: 792, width: 640, height: 98, angle: -1.4 },
        { x: 980, y: 794, width: 670, height: 102, angle: 1.2 },
        { x: 1095, y: 370, width: 320, height: 48, angle: -1 },
        { x: 1035, y: 557, width: 285, height: 43, angle: 1.5 },
      ];
      placements.forEach((placement, index) => {
        const grass = this.add.image(placement.x, placement.y, "decor-grass")
          .setOrigin(0.5, 1)
          .setDisplaySize(placement.width, placement.height)
          .setAngle(placement.angle)
          .setAlpha(index < 2 ? 0.78 : 0.42)
          .setDepth(index < 2 ? 14 : 8);
        this.tweens.add({
          targets: grass,
          angle: placement.angle + (index % 2 === 0 ? 1.2 : -1.1),
          duration: 2_300 + index * 310,
          yoyo: true,
          repeat: -1,
          ease: "Sine.inOut",
        });
      });
    }

    for (let index = 0; index < 11; index += 1) {
      const glow = this.add.circle(
        Phaser.Math.Between(260, 1_210),
        Phaser.Math.Between(125, 735),
        Phaser.Math.Between(2, 4),
        index % 3 === 0 ? 0x9fdb83 : 0xffd975,
        0.18 + Math.random() * 0.24,
      ).setDepth(9);
      this.tweens.add({
        targets: glow,
        x: glow.x + Phaser.Math.Between(-36, 44),
        y: glow.y - Phaser.Math.Between(20, 62),
        alpha: 0.04,
        duration: Phaser.Math.Between(1_900, 3_900),
        delay: Phaser.Math.Between(0, 1_400),
        yoyo: true,
        repeat: -1,
        ease: "Sine.inOut",
      });
    }
  }

  private createLanes(): void {
    const graphics = this.add.graphics();
    for (const [index, y] of LANE_Y.entries()) {
      graphics.fillStyle(index % 2 === 0 ? 0x153c36 : 0x25483d, 0.18);
      graphics.fillRoundedRect(170, y - 78, 1060, 156, 12);
      graphics.lineStyle(2, 0xf4e4b3, 0.34);
      graphics.strokeRoundedRect(170, y - 78, 1060, 156, 12);
      graphics.lineStyle(2, 0xffffff, 0.12);
      graphics.lineBetween(250, y + 57, 1190, y + 57);
    }
  }

  private createDefenseLine(): void {
    const wall = this.add.graphics().setDepth(40);
    wall.fillStyle(0x193d38, 0.98);
    wall.fillRoundedRect(42, 130, 145, 590, 8);
    wall.lineStyle(6, 0xf1bd3d, 1);
    wall.strokeRoundedRect(42, 130, 145, 590, 8);
    wall.fillStyle(0xf1bd3d, 1);
    for (let y = 158; y <= 690; y += 54) wall.fillRect(171, y, 30, 16);
    this.add.text(114, 690, "防 线", {
      fontFamily: '"Microsoft YaHei", sans-serif',
      fontSize: "21px",
      color: "#fff5cf",
    }).setOrigin(0.5).setDepth(41);

    this.weaponContainer = this.add.container(180, LANE_Y[1]).setDepth(50);
    const platform = this.add.graphics();
    platform.fillStyle(0x102b29, 0.92);
    platform.fillRoundedRect(-105, 34, 180, 52, 12);
    platform.lineStyle(3, 0xeab43c, 0.95);
    platform.strokeRoundedRect(-105, 34, 180, 52, 12);
    this.weaponContainer.add(platform);

    const pivot = this.add.circle(-28, 20, 24, 0x203f3b, 1);
    pivot.setStrokeStyle(4, 0xeab43c, 0.92);
    this.weaponContainer.add(pivot);
    this.weaponStatusLight = this.add.circle(-78, 58, 7, 0xeab43c, 0.9);
    this.weaponStatusLight.setStrokeStyle(2, 0xffefb3, 0.85);
    this.weaponContainer.add(this.weaponStatusLight);

    this.weaponRig = this.add.container(0, 0);
    this.weaponContainer.add(this.weaponRig);
    this.setWeaponTexture(this.weaponId);
  }

  private startBattle(
    selection: WeaponSelection,
    content: MatchLevelContent,
    profileId: string,
    band: FrequencyBand,
    sessionId: string,
    mapId: BattleMapId,
  ): void {
    if (this.running || content.encounters.length === 0) return;

    const map = getBattleMap(mapId);
    if (!this.textures.exists(map.textureKey)) {
      if (this.pendingMapLoadId !== null) return;
      this.pendingMapLoadId = mapId;
      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this.pendingMapLoadId = null;
        const resolvedMapId = this.textures.exists(map.textureKey) ? mapId : BATTLE_MAPS[0].id;
        this.startBattle(selection, content, profileId, band, sessionId, resolvedMapId);
      });
      this.load.image(map.textureKey, map.assetPath);
      this.load.start();
      return;
    }

    this.clearRuntimeZombies();
    this.levelContent = content;
    this.profileId = profileId;
    this.sessionId = sessionId;
    this.frequencyBand = band;
    this.mapId = mapId;
    this.setBattleMap(mapId);
    this.battleState = createMatchBattleState();
    this.spawnedCount = 0;
    this.zombieVisualDeck = buildZombieVisualDeck(content.encounters.length);
    this.recordedEncounterIds.clear();
    this.sessionFinalized = false;
    this.progressSaveFailed = false;
    this.storageQueue = Promise.resolve();
    this.stars = 0;
    this.failureReason = null;
    this.correction = null;
    this.correctionQueue.length = 0;
    this.correctionIndex = 0;
    this.finalPhase = "failed";
    this.finalFeedback = "";
    this.weaponAimY = LANE_Y[1];
    this.weaponTargetY = LANE_Y[1];
    this.weaponBusyUntil = 0;
    if (this.weaponContainer) this.weaponContainer.y = LANE_Y[1];
    this.weaponId = selection === "random"
      ? pickDifferentVisual(
        WEAPON_OPTIONS.map((weapon) => weapon.id),
        undefined,
      )
      : selection;
    this.setWeaponTexture(this.weaponId);
    this.feedback = "第一波已进入射程";
    this.phase = "playing";
    this.running = true;
    emitBattleSound("start");

    for (let index = 0; index < INITIAL_FORMATION_SIZE; index += 1) {
      const lane = index % LANE_Y.length;
      const rank = Math.floor(index / LANE_Y.length);
      const formationX = rank === 0
        ? FRONT_RANK_X - 80 + lane * 50
        : SPAWN_X;
      this.spawnNextZombie(lane, formationX);
    }
    this.nextSpawnAt = this.time.now + getMatchWavePacing(this.spawnedCount).spawnIntervalMs;
    this.publishState();
  }

  private setBattleMap(mapId: BattleMapId): void {
    const map = getBattleMap(mapId);
    if (!this.textures.exists(map.textureKey)) {
      throw new Error(`Battle map texture is unavailable: ${map.textureKey}`);
    }
    this.backgroundImage?.setTexture(map.textureKey).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    this.mapTitle?.setText(`WORD DEFENSE  ·  ${map.name}`);
    this.cameras.main.fadeIn(360, 15, 41, 39);
  }

  private setWeaponTexture(weaponId: WeaponId): void {
    if (!this.weaponRig) return;
    this.weaponRig.removeAll(true);
    this.weaponImage = undefined;

    const textureKey = this.textures.exists(getGuardTextureKey(weaponId))
      ? getGuardTextureKey(weaponId)
      : getWeaponTextureKey(weaponId);
    if (this.textures.exists(textureKey)) {
      this.weaponImage = this.add.image(0, 0, textureKey).setOrigin(0.33, 0.52);
      this.fitImage(this.weaponImage, 360, 270);
      this.weaponRig.add(this.weaponImage);
      return;
    }

    const fallback = this.add.graphics();
    fallback.fillStyle(0x293532, 1);
    fallback.fillRoundedRect(-58, -22, 185, 44, 10);
    fallback.fillStyle(0xd0a13a, 1);
    fallback.fillRect(110, -8, 82, 16);
    this.weaponRig.add(fallback);
  }

  private spawnNextZombie(lane: number, x = SPAWN_X): void {
    const content = this.levelContent?.encounters[this.spawnedCount];
    if (!content) return;

    this.battleState = spawnZombie(this.battleState, {
      zombieId: content.encounterId,
      targetId: content.targetId,
    });
    const pacing = getMatchWavePacing(this.spawnedCount);
    const baseSpeed = E2E_CONTROLLED_PACING ? Math.min(1.5, pacing.baseSpeed) : pacing.baseSpeed;
    const runtime = this.createRuntimeZombie(content, lane, x, baseSpeed);
    this.runtimeZombies.set(runtime.id, runtime);
    this.spawnedCount += 1;
  }

  private createRuntimeZombie(
    content: MatchEncounterContent,
    lane: number,
    x: number,
    baseSpeed: number,
  ): RuntimeZombie {
    const baseY = LANE_Y[lane];
    const container = this.add.container(x, baseY).setDepth(20 + lane * 4);
    const shadow = this.add.ellipse(0, 10, 122, 28, 0x0b1e1c, 0.42);
    container.add(shadow);

    const textureKey = this.zombieVisualDeck[this.spawnedCount]
      ?? pickDifferentVisual(ZOMBIE_TEXTURE_KEYS, undefined);
    let body: Phaser.GameObjects.Image | undefined;
    if (this.textures.exists(textureKey)) {
      body = this.add.image(0, 10, textureKey).setOrigin(0.5, 1);
      this.fitImage(body, 152, 210);
      container.add(body);
    } else {
      const fallback = this.add.graphics();
      fallback.fillStyle(0x749552, 1);
      fallback.fillCircle(0, -132, 41);
      fallback.fillStyle(0x354b36, 1);
      fallback.fillRoundedRect(-43, -105, 86, 116, 16);
      container.add(fallback);
    }

    const marker = this.add.circle(0, -177, 11, 0xf3bd3e, 0.96);
    marker.setStrokeStyle(3, 0xfff3c4, 0.9);
    container.add(marker);
    container.setScale(0.96);

    return {
      id: content.encounterId,
      content,
      container,
      body,
      bodyScaleX: body?.scaleX ?? 1,
      bodyScaleY: body?.scaleY ?? 1,
      motionStyle: getZombieMotionStyle(textureKey),
      shadow,
      marker,
      lane,
      baseY,
      baseSpeed,
      phaseOffset: Math.random() * Math.PI * 2,
      spawnedAt: performance.now(),
      spawnOrder: this.spawnedCount,
      status: "approaching",
      chargeMoveAt: 0,
      lastDustAt: 0,
      lastFootstepAt: this.time.now + Math.random() * 260,
      footstepSide: Math.random() > 0.5 ? 1 : -1,
      resolved: false,
    };
  }

  private animateZombie(zombie: RuntimeZombie, time: number, delta: number): void {
    const charging = zombie.status === "charging";
    const canMove = !charging || time >= zombie.chargeMoveAt;
    const speed = charging ? CHARGE_SPEED : zombie.baseSpeed;
    if (canMove) zombie.container.x -= (speed * delta) / 1000;

    const motion = ZOMBIE_MOTION_PROFILES[zombie.motionStyle];
    const frequency = charging ? 0.026 : motion.frequency;
    const step = Math.sin(time * frequency + zombie.phaseOffset);
    const footLift = Math.abs(step);
    zombie.container.y = zombie.baseY - footLift * (charging ? 13 : motion.containerLift);
    zombie.container.angle = charging
      ? -14 + step * 2.8
      : step * motion.containerAngle;
    zombie.shadow.setScale(
      1 + footLift * (charging ? 0.17 : 0.1),
      1 - footLift * 0.11,
    );
    zombie.shadow.setAlpha(0.42 - footLift * 0.12);
    zombie.marker.setPosition(-step * 3, -177 - footLift * 5);
    zombie.marker.setScale(1 + footLift * 0.12);
    if (zombie.body) {
      zombie.body.setPosition(
        step * (charging ? 7 : motion.bodyShift),
        10 - footLift * (charging ? 7 : motion.bodyLift),
      );
      zombie.body.setAngle(step * (charging ? 4.2 : motion.bodyAngle));
      zombie.body.setScale(
        zombie.bodyScaleX * (1 - step * (charging ? 0.035 : motion.bodyStretch)),
        zombie.bodyScaleY * (1 + footLift * (charging ? 0.035 : motion.bodyStretch)),
      );
    }

    const footstepInterval = charging ? 120 : motion.footstepInterval;
    if (canMove && time >= zombie.lastFootstepAt) {
      zombie.lastFootstepAt = time + footstepInterval;
      zombie.footstepSide = zombie.footstepSide === 1 ? -1 : 1;
      this.createFootstepEffect(zombie, charging);
    }
    if (charging && canMove && time - zombie.lastDustAt >= 85) {
      zombie.lastDustAt = time;
      this.createDust(zombie);
    }
  }

  private createFootstepEffect(zombie: RuntimeZombie, charging: boolean): void {
    const footX = zombie.container.x + zombie.footstepSide * 22;
    const footY = zombie.baseY + 7;
    const ring = this.add.ellipse(
      footX,
      footY,
      charging ? 34 : 22,
      charging ? 10 : 7,
      charging ? 0xd6a25e : 0xc8b27f,
      charging ? 0.42 : 0.24,
    ).setDepth(zombie.container.depth - 1);
    this.tweens.add({
      targets: ring,
      alpha: 0,
      scaleX: 1.75,
      scaleY: 1.35,
      duration: charging ? 220 : 300,
      onComplete: () => ring.destroy(),
    });

    const streak = this.add.rectangle(
      zombie.container.x + (charging ? 72 : 54),
      zombie.baseY - (charging ? 82 : 68),
      charging ? 46 : 26,
      charging ? 4 : 3,
      charging ? 0xffd081 : 0xf4e6bd,
      charging ? 0.42 : 0.18,
    ).setAngle(-7).setDepth(zombie.container.depth - 1);
    this.tweens.add({
      targets: streak,
      x: streak.x + 34,
      alpha: 0,
      scaleX: 1.35,
      duration: charging ? 150 : 260,
      onComplete: () => streak.destroy(),
    });
  }

  private createDust(zombie: RuntimeZombie): void {
    const dust = this.add.circle(
      zombie.container.x + 48,
      zombie.baseY + 4,
      Phaser.Math.Between(7, 14),
      0xc6a368,
      0.5,
    ).setDepth(zombie.container.depth - 1);
    this.tweens.add({
      targets: dust,
      x: dust.x + 52,
      y: dust.y - Phaser.Math.Between(8, 24),
      alpha: 0,
      scale: 1.7,
      duration: 330,
      onComplete: () => dust.destroy(),
    });
  }

  private animateWeapon(time: number, delta: number): void {
    if (!this.weaponContainer || !this.weaponRig) return;
    const aimDelta = this.weaponTargetY - this.weaponAimY;
    const follow = 1 - Math.exp(-delta / 85);
    this.weaponAimY = Phaser.Math.Linear(
      this.weaponAimY,
      this.weaponTargetY,
      follow,
    );
    this.weaponContainer.y = this.weaponAimY
      + Math.sin(time * 0.0024 + this.weaponIdlePhase) * 2.2;

    if (time >= this.weaponBusyUntil) {
      const breath = Math.sin(time * 0.003 + this.weaponIdlePhase);
      this.weaponRig.x = breath * 1.8;
      this.weaponRig.y = Math.abs(breath) * -1.5;
      this.weaponRig.angle = breath * 0.75
        + Phaser.Math.Clamp(aimDelta / 28, -5, 5);
    }

    if (this.weaponStatusLight) {
      const loaded = this.battleState.loadedTargetId !== null && this.running;
      const pulse = 0.78 + Math.sin(time * 0.008) * 0.18;
      this.weaponStatusLight.setFillStyle(loaded ? 0x80d16c : 0xeab43c, pulse);
      this.weaponStatusLight.setScale(loaded ? 1.18 : 0.92 + pulse * 0.08);
    }
  }

  private trySpawnNext(time: number): void {
    if (this.spawnedCount >= this.encounterCount) return;
    if (this.activeZombieCount >= MAX_ACTIVE_ZOMBIES || time < this.nextSpawnAt) return;

    const preferredLane = this.spawnedCount % LANE_Y.length;
    const active = [...this.runtimeZombies.values()].filter((zombie) => !zombie.resolved);
    const lane = [...LANE_Y.keys()]
      .filter((candidateLane) => {
        const laneZombies = active.filter((zombie) => zombie.lane === candidateLane);
        return laneZombies.length < 2 && laneZombies.every(
          (zombie) => zombie.container.x <= SPAWN_X - MIN_SAME_LANE_GAP,
        );
      })
      .sort((left, right) => {
        const leftCount = active.filter((zombie) => zombie.lane === left).length;
        const rightCount = active.filter((zombie) => zombie.lane === right).length;
        if (leftCount !== rightCount) return leftCount - rightCount;
        const leftDistance = (left - preferredLane + LANE_Y.length) % LANE_Y.length;
        const rightDistance = (right - preferredLane + LANE_Y.length) % LANE_Y.length;
        return leftDistance - rightDistance;
      })[0];
    if (lane === undefined) {
      this.nextSpawnAt = time + 120;
      return;
    }

    this.spawnNextZombie(lane);
    if (this.spawnedCount < this.encounterCount) {
      this.nextSpawnAt = time + getMatchWavePacing(this.spawnedCount).spawnIntervalMs;
    } else {
      this.nextSpawnAt = Number.POSITIVE_INFINITY;
    }
    this.publishState();
  }

  private selectAmmo(targetId: string): void {
    if (!this.running || this.phase !== "playing" || this.correction) return;
    if (this.battleState.loadedTargetId !== null) {
      this.feedback = "枪膛里已有一枚单词弹，请先射击";
      this.publishState();
      return;
    }

    try {
      this.battleState = loadAmmo(this.battleState, targetId);
      const content = this.levelContent?.encounters.find((item) => item.targetId === targetId);
      this.feedback = content ? `已装填：${content.english}` : "单词弹已装填";
      this.pulseWeapon();
      emitBattleSound("load");
    } catch (error) {
      this.feedback = error instanceof Error ? error.message : "这枚单词弹暂不可用";
    }
    this.publishState();
  }

  private fireDraggedAmmo(targetId: string, zombieId: string): void {
    if (!this.running || this.phase !== "playing" || this.correction) return;
    if (this.battleState.loadedTargetId !== null) return;

    this.selectAmmo(targetId);
    if (this.battleState.loadedTargetId === targetId) this.shootZombie(zombieId);
  }

  private shootZombie(zombieId: string): void {
    if (!this.running || this.phase !== "playing" || this.correction) return;
    const runtime = this.runtimeZombies.get(zombieId);
    if (!runtime || runtime.resolved) return;
    if (runtime.status === "charging") {
      this.feedback = "该僵尸已经冲锋，不能再次射击";
      this.publishState();
      return;
    }
    if (this.battleState.loadedTargetId === null) {
      this.feedback = "请先装填英文单词弹";
      this.dryFire();
      this.publishState();
      return;
    }

    this.moveWeaponToLane(runtime.lane);
    try {
      const transition = fireAtZombie(this.battleState, zombieId);
      this.battleState = transition.state;
      emitBattleSound("shot");
      if (transition.event.type === "hit") {
        runtime.resolved = true;
        this.feedback = transition.event.comboBonus > 0
          ? `命中！连击 +${transition.event.points}`
          : `命中！+${transition.event.points}`;
        this.recordOutcome(runtime, 1, true);
        emitBattleSound("correct");
        emitPronunciationCue({
          targetId: runtime.content.targetId,
          english: runtime.content.english,
          phonetic: runtime.content.phonetic ?? "",
          meaningZh: runtime.content.meaningZh,
          source: "correct",
        });
        this.fireProjectile(runtime, true, () => this.animateDefeat(runtime));
      } else {
        runtime.status = "charging";
        runtime.chargeMoveAt = this.time.now + 30;
        runtime.body?.setTint(0xff8b78);
        this.feedback = "错配！这只僵尸已锁定防线，不能再次射击";
        emitBattleSound("wrong");
        this.fireProjectile(runtime, false, () => this.flashHit(runtime, 0xe64232));
      }
    } catch (error) {
      this.feedback = error instanceof Error ? error.message : "当前无法射击";
    }
    this.publishState();
  }

  private fireProjectile(
    zombie: RuntimeZombie,
    correct: boolean,
    onComplete: () => void,
  ): void {
    if (!this.weaponContainer) return;
    this.recoilWeapon();
    const muzzle = this.getMuzzlePoint();
    this.createMuzzleEffects(correct, muzzle.x, muzzle.y);
    const projectile = this.add.circle(
      muzzle.x,
      muzzle.y,
      correct ? 10 : 12,
      correct ? 0xffd64d : 0xe64032,
      1,
    ).setDepth(80);
    projectile.setStrokeStyle(4, 0xfff5c7, 0.94);
    const targetX = zombie.container.x;
    const targetY = zombie.container.y - 100;
    const trail = this.add.line(
      0,
      0,
      projectile.x - 54,
      projectile.y,
      targetX,
      targetY,
      correct ? 0xffe27a : 0xff7366,
      0.75,
    ).setOrigin(0).setDepth(79);
    this.tweens.add({
      targets: projectile,
      x: targetX,
      y: targetY,
      duration: 175,
      ease: "Quad.in",
      onComplete: () => {
        projectile.destroy();
        trail.destroy();
        onComplete();
      },
    });
    this.tweens.add({
      targets: trail,
      alpha: 0,
      duration: 175,
    });
  }

  private recoilWeapon(): void {
    if (!this.weaponRig) return;
    this.weaponBusyUntil = this.time.now + 240;
    this.tweens.killTweensOf(this.weaponRig);
    this.weaponRig.setPosition(0, 0).setAngle(0);
    this.tweens.add({
      targets: this.weaponRig,
      x: -34,
      y: 4,
      angle: 7,
      duration: 92,
      yoyo: true,
      ease: "Quad.out",
      onComplete: () => {
        if (this.weaponRig) {
          this.weaponRig.setPosition(0, 0).setAngle(0);
        }
      },
    });
  }

  private pulseWeapon(): void {
    if (!this.weaponRig || !this.weaponContainer) return;
    this.weaponBusyUntil = this.time.now + 300;
    this.tweens.killTweensOf(this.weaponRig);
    this.weaponRig.setPosition(0, 0).setAngle(0);
    this.tweens.add({
      targets: this.weaponRig,
      x: -5,
      y: 9,
      angle: -8,
      duration: 110,
      hold: 35,
      yoyo: true,
      ease: "Cubic.inOut",
      onComplete: () => this.weaponRig?.setPosition(0, 0).setAngle(0),
    });
    const cartridge = this.add.rectangle(
      this.weaponContainer.x - 70,
      this.weaponContainer.y + 48,
      34,
      10,
      0xf0bd42,
      0.95,
    ).setStrokeStyle(2, 0xfff0b4, 0.9).setDepth(82);
    this.tweens.add({
      targets: cartridge,
      x: this.weaponContainer.x + 46,
      y: this.weaponContainer.y - 5,
      angle: -18,
      alpha: 0.15,
      scaleX: 0.45,
      duration: 330,
      ease: "Cubic.in",
      onComplete: () => cartridge.destroy(),
    });
  }

  private dryFire(): void {
    if (!this.weaponRig) return;
    this.weaponBusyUntil = this.time.now + 150;
    this.tweens.killTweensOf(this.weaponRig);
    this.tweens.add({
      targets: this.weaponRig,
      x: -7,
      angle: 3,
      duration: 58,
      yoyo: true,
      onComplete: () => this.weaponRig?.setPosition(0, 0).setAngle(0),
    });
  }

  private moveWeaponToLane(lane: number): void {
    this.weaponTargetY = LANE_Y[lane];
  }

  private getMuzzlePoint(): Phaser.Math.Vector2 {
    const image = this.weaponImage;
    const localMuzzleX = image
      ? image.x + image.displayWidth * (1 - image.originX) - 9
      : 205;
    const localMuzzleY = image
      ? image.y + image.displayHeight * (0.29 - image.originY)
      : -10;
    const x = (this.weaponContainer?.x ?? 180) + localMuzzleX + (this.weaponRig?.x ?? 0);
    const y = (this.weaponContainer?.y ?? LANE_Y[1]) + localMuzzleY + (this.weaponRig?.y ?? 0);
    return new Phaser.Math.Vector2(x, y);
  }

  private createMuzzleEffects(correct: boolean, x: number, y: number): void {
    const color = correct ? 0xffd554 : 0xff6b49;
    const flash = this.add.star(x, y, 7, 6, 25, color, 1).setDepth(90);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.9,
      angle: 140,
      duration: 310,
      ease: "Quad.out",
      onComplete: () => flash.destroy(),
    });

    for (let index = 0; index < 3; index += 1) {
      const smoke = this.add.circle(
        x + 5 + index * 5,
        y - index * 2,
        7 + index * 2,
        0xe5dfcc,
        0.3,
      ).setDepth(84);
      this.tweens.add({
        targets: smoke,
        x: smoke.x + 28 + index * 8,
        y: smoke.y - 16 - index * 7,
        alpha: 0,
        scale: 1.6,
        duration: 480 + index * 75,
        onComplete: () => smoke.destroy(),
      });
    }

    const shell = this.add.rectangle(x - 94, y - 19, 7, 16, 0xd8a83b, 1)
      .setAngle(-24)
      .setDepth(86);
    this.tweens.add({
      targets: shell,
      x: shell.x + 38,
      y: shell.y - 42,
      angle: 210,
      alpha: 0,
      duration: 520,
      ease: "Quad.out",
      onComplete: () => shell.destroy(),
    });
  }

  private animateDefeat(zombie: RuntimeZombie): void {
    this.flashHit(zombie, 0xffd74f);
    zombie.body?.setTintFill(0xffef9a);
    this.tweens.add({
      targets: zombie.container,
      x: zombie.container.x + 48,
      y: zombie.container.y - 38,
      alpha: 0,
      angle: -20,
      scale: 1.1,
      duration: 330,
      ease: "Back.in",
      onComplete: () => {
        this.removeRuntimeZombie(zombie.id);
        if (this.battleState.resolved >= this.encounterCount) {
          this.finishRun();
        } else {
          this.publishState();
        }
      },
    });
  }

  private flashHit(zombie: RuntimeZombie, color: number): void {
    const flash = this.add.circle(
      zombie.container.x,
      zombie.container.y - 95,
      70,
      color,
      0.58,
    ).setDepth(70);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.65,
      duration: 260,
      onComplete: () => flash.destroy(),
    });
  }

  private handleBreach(zombieId: string): void {
    const runtime = this.runtimeZombies.get(zombieId);
    if (!runtime || runtime.resolved || !this.running) return;

    try {
      const transition = resolveBreach(this.battleState, zombieId);
      this.battleState = transition.state;
      runtime.resolved = true;
      const wasWrong = transition.event.reason === "wrong-charge";
      this.feedback = wasWrong
        ? "错配僵尸冲破防线，防线 -15｜继续战斗，关后统一纠错"
        : "未作答僵尸冲破防线，防线 -15｜继续战斗，关后统一纠错";
      this.recordOutcome(
        runtime,
        transition.event.attempts,
        false,
      );
      this.createWallImpact(runtime.baseY);
      runtime.container.destroy();
      this.runtimeZombies.delete(runtime.id);
      this.correctionQueue.push({
        targetId: runtime.content.targetId,
        english: runtime.content.english,
        phonetic: runtime.content.phonetic ?? "",
        meaningZh: runtime.content.meaningZh,
        reason: transition.event.reason,
      });
      emitBattleSound("breach");
      if (
        this.battleState.wallHp <= 0
        || this.battleState.resolved >= this.encounterCount
      ) {
        this.finishRun();
      } else {
        this.publishState();
      }
    } catch (error) {
      console.warn("Unable to resolve wall breach.", error);
    }
  }

  private confirmCorrection(): void {
    if (!this.correction || this.phase !== "reviewing") return;
    emitBattleSound("confirm");
    this.correctionIndex += 1;
    if (this.correctionIndex < this.correctionQueue.length) {
      this.showCurrentCorrection();
    } else {
      this.correction = null;
      this.revealFinalResult();
    }
  }

  private createWallImpact(y: number): void {
    this.cameras.main.shake(190, 0.009);
    const burst = this.add.circle(WALL_X + 8, y - 55, 28, 0xffc84a, 0.9).setDepth(90);
    burst.setStrokeStyle(8, 0xe94a35, 0.82);
    this.tweens.add({
      targets: burst,
      alpha: 0,
      scale: 2.8,
      duration: 360,
      onComplete: () => burst.destroy(),
    });
  }

  private recordOutcome(
    zombie: RuntimeZombie,
    attempts: AttemptCount,
    correct: boolean,
  ): void {
    if (!this.profileId || !this.sessionId) return;
    if (this.recordedEncounterIds.has(zombie.content.encounterId)) return;
    this.recordedEncounterIds.add(zombie.content.encounterId);
    const responseMs = Math.max(0, performance.now() - zombie.spawnedAt);
    const profileId = this.profileId;
    const band = this.frequencyBand;
    this.enqueueStorage(async (sessionId) => {
      await recordEncounter({
        sessionId,
        profileId,
        band,
        wordId: zombie.content.targetId,
        encounterId: zombie.content.encounterId,
        attempts,
        correct,
        responseMs,
      });
    });
  }

  private finishRun(): void {
    if (!this.running) return;
    this.running = false;
    this.nextSpawnAt = Number.POSITIVE_INFINITY;

    const evaluation = evaluateLevel({
      masteredWordCount: this.battleState.correct,
      targetWordCount: this.encounterCount,
      remainingHealth: this.battleState.wallHp,
    });
    this.stars = evaluation.stars;
    this.failureReason = evaluation.failureReason;
    this.finalPhase = evaluation.passed ? "complete" : "failed";
    this.finalFeedback = evaluation.passed
      ? `晋级成功：本局首答正确 ${evaluation.masteredWordCount}/${this.encounterCount}`
      : evaluation.failureReason === "health"
        ? "防线生命归零，本关失败"
        : `本局首答正确 ${evaluation.masteredWordCount}/${this.encounterCount}，至少需要 ${evaluation.requiredMasteryCount} 个`;

    for (const zombie of this.runtimeZombies.values()) {
      zombie.resolved = true;
      this.tweens.add({
        targets: zombie.container,
        alpha: 0,
        duration: 220,
        onComplete: () => zombie.container.destroy(),
      });
    }
    this.runtimeZombies.clear();
    this.finalizeSession();
    if (this.correctionQueue.length > 0) {
      this.phase = "reviewing";
      this.correctionIndex = 0;
      this.showCurrentCorrection();
    } else {
      this.revealFinalResult();
    }
  }

  private showCurrentCorrection(): void {
    const entry = this.correctionQueue[this.correctionIndex];
    if (!entry) {
      this.correction = null;
      this.revealFinalResult();
      return;
    }
    this.correction = {
      ...entry,
      reviewIndex: this.correctionIndex + 1,
      reviewTotal: this.correctionQueue.length,
    };
    this.feedback = `本关结束，错词回顾 ${this.correction.reviewIndex}/${this.correction.reviewTotal}`;
    this.publishState();
    emitPronunciationCue({
      targetId: entry.targetId,
      english: entry.english,
      phonetic: entry.phonetic,
      meaningZh: entry.meaningZh,
      source: "correction",
    });
  }

  private revealFinalResult(): void {
    this.phase = this.finalPhase;
    this.feedback = this.finalFeedback;
    this.publishState();
    emitBattleSound(this.finalPhase === "complete" ? "victory" : "failure");
  }

  private finalizeSession(): void {
    if (this.sessionFinalized) return;
    this.sessionFinalized = true;
    this.enqueueStorage(async (sessionId) => {
      await completeSession(sessionId);
      emitLearningProgressChanged();
    });
  }

  private enqueueStorage(operation: (sessionId: string) => Promise<void>): void {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    this.storageQueue = this.storageQueue
      .then(() => operation(sessionId))
      .catch((error: unknown) => {
        this.progressSaveFailed = true;
        this.feedback = "学习记录保存失败，请结束后检查浏览器网站数据权限";
        console.error("Unable to save battle progress.", error);
        this.publishState();
      });
  }

  private get availableAmmo(): RuntimeZombie[] {
    return [...this.runtimeZombies.values()]
      .filter((zombie) => !zombie.resolved && zombie.status === "approaching")
      .sort((left, right) => left.spawnOrder - right.spawnOrder);
  }

  private get activeZombieCount(): number {
    return [...this.runtimeZombies.values()].filter((zombie) => !zombie.resolved).length;
  }

  private get encounterCount(): number {
    return this.levelContent?.encounters.length ?? 20;
  }

  private publishState(): void {
    const active = [...this.runtimeZombies.values()]
      .filter((zombie) => !zombie.resolved)
      .sort((left, right) => left.spawnOrder - right.spawnOrder);
    const ammo = this.availableAmmo.map((zombie) => ({
      targetId: zombie.content.targetId,
      label: zombie.content.english,
    }));
    const zombies = active.map((zombie) => ({
      id: zombie.id,
      targetId: zombie.content.targetId,
      prompt: zombie.content.meaningZh,
      x: zombie.container.x,
      y: zombie.baseY - 190,
      lane: zombie.lane,
      status: zombie.status,
    }));

    emitBattleState({
      phase: this.phase,
      health: this.battleState.wallHp,
      resolvedCount: this.battleState.resolved,
      encounterCount: this.encounterCount,
      spawnedCount: this.spawnedCount,
      activeZombieCount: active.length,
      zombies,
      ammo,
      loadedTargetId: this.battleState.loadedTargetId,
      feedback: this.feedback,
      score: this.battleState.score,
      streak: this.battleState.streak,
      canLoadAmmo:
        this.phase === "playing" &&
        this.correction === null &&
        this.battleState.loadedTargetId === null &&
        ammo.length > 0,
      defeatedCount: this.battleState.correct,
      wrongAttempts: this.battleState.wrong,
      breachCount: this.battleState.breach,
      firstTryCorrectCount: this.battleState.correct,
      targetWordCount: this.encounterCount,
      stars: this.stars,
      failureReason: this.failureReason,
      weaponId: this.weaponId,
      mapId: this.mapId,
      progressSaveFailed: this.progressSaveFailed,
      correction: this.correction,
    });
  }

  private removeRuntimeZombie(zombieId: string): void {
    const zombie = this.runtimeZombies.get(zombieId);
    zombie?.container.destroy();
    this.runtimeZombies.delete(zombieId);
  }

  private clearRuntimeZombies(): void {
    for (const zombie of this.runtimeZombies.values()) zombie.container.destroy();
    this.runtimeZombies.clear();
  }

  private fitImage(
    image: Phaser.GameObjects.Image,
    maxWidth: number,
    maxHeight: number,
  ): void {
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    image.setDisplaySize(image.width * scale, image.height * scale);
  }
}
