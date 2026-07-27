import Phaser from "phaser";

import { BattleScene } from "./scenes/BattleScene";

export function createGame(parent: string): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 1280,
    height: 800,
    backgroundColor: "#d6d4c4",
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: false
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 1280,
      height: 800
    },
    scene: [BattleScene]
  });
}

