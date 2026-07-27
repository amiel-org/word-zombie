export const BATTLE_MAPS = [
  {
    id: "heritage-field",
    name: "文化遗产草坪",
    textureKey: "battle-map-heritage-field",
    assetPath: "/assets/battle/maps/heritage-field.jpg",
  },
  {
    id: "library-autumn",
    name: "秋日图书馆",
    textureKey: "battle-map-library-autumn",
    assetPath: "/assets/battle/maps/library-autumn.jpg",
  },
  {
    id: "athletics-summer",
    name: "盛夏运动场",
    textureKey: "battle-map-athletics-summer",
    assetPath: "/assets/battle/maps/athletics-summer.jpg",
  },
  {
    id: "science-rain",
    name: "雨后实验楼",
    textureKey: "battle-map-science-rain",
    assetPath: "/assets/battle/maps/science-rain.jpg",
  },
  {
    id: "winter-plaza",
    name: "冬日校园广场",
    textureKey: "battle-map-winter-plaza",
    assetPath: "/assets/battle/maps/winter-plaza.jpg",
  },
  {
    id: "academy-spring",
    name: "春日书院",
    textureKey: "battle-map-academy-spring",
    assetPath: "/assets/battle/maps/academy-spring.jpg",
  },
  {
    id: "seaside-campus",
    name: "海滨校园",
    textureKey: "battle-map-seaside-campus",
    assetPath: "/assets/battle/maps/seaside-campus.jpg",
  },
  {
    id: "greenhouse-rooftop",
    name: "屋顶温室",
    textureKey: "battle-map-greenhouse-rooftop",
    assetPath: "/assets/battle/maps/greenhouse-rooftop.jpg",
  },
] as const;

export type BattleMapDefinition = (typeof BATTLE_MAPS)[number];
export type BattleMapId = BattleMapDefinition["id"];

export function getBattleMap(mapId: BattleMapId): BattleMapDefinition {
  const map = BATTLE_MAPS.find((candidate) => candidate.id === mapId);
  if (!map) throw new RangeError(`Unknown battle map: ${mapId}`);
  return map;
}

export function getBattleMapForSessionCount(sessionCount: number): BattleMapDefinition {
  if (!Number.isInteger(sessionCount) || sessionCount < 0) {
    throw new RangeError("sessionCount must be a non-negative integer");
  }
  return BATTLE_MAPS[sessionCount % BATTLE_MAPS.length];
}
