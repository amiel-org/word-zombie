import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "单词大战僵尸",
        short_name: "单词大战",
        description: "高考高、中、低频 3,180 词训练",
        lang: "zh-CN",
        theme_color: "#183c38",
        background_color: "#f2f0e8",
        display: "standalone",
        orientation: "any",
        start_url: ".",
        icons: [
          {
            src: "assets/battle/app-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "assets/battle/app-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "assets/battle/app-icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,jpg,jpeg,webp,svg,json,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globIgnores: [
          "**/assets/battle/app-icon.png",
          "**/assets/battle/app-icon-192.png",
          "**/assets/battle/app-icon-512.png",
          "**/assets/battle/app-icon-maskable-512.png",
          "**/assets/battle/weapon-dictionary.png",
          "**/assets/battle/weapon-pen.png",
          "**/assets/battle/word-cannon-base.png"
        ],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/audio\/.*\.mp3$/,
            handler: "CacheFirst",
            options: {
              cacheName: "word-zombie-audio-v1",
              expiration: { maxEntries: 3, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          }
        ]
      }
    })
  ],
  server: {
    host: "0.0.0.0",
    port: 5173
  },
  preview: {
    host: "0.0.0.0",
    port: 4173
  },
  build: {
    sourcemap: true
  }
});
