"use strict";

const http = require("node:http");
const { spawn } = require("node:child_process");
const { getAsset, getAssetKeys } = require("node:sea");

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

const assetKeys = new Set(getAssetKeys());

function extensionOf(pathname) {
  const dot = pathname.lastIndexOf(".");
  return dot >= 0 ? pathname.slice(dot).toLowerCase() : "";
}

function openBrowser(url) {
  const child = spawn("cmd.exe", ["/d", "/s", "/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function verifyWordZombieServer(url, callback) {
  let settled = false;
  const finish = (matches) => {
    if (settled) return;
    settled = true;
    callback(matches);
  };
  const request = http.get(new URL("/manifest.webmanifest", url), (response) => {
    if (response.statusCode !== 200) {
      response.resume();
      finish(false);
      return;
    }
    response.setEncoding("utf8");
    let body = "";
    response.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) response.destroy();
    });
    response.on("end", () => {
      try {
        const manifest = JSON.parse(body);
        finish(
          manifest.name === "单词大战僵尸"
          && manifest.short_name === "单词大战",
        );
      } catch {
        finish(false);
      }
    });
    response.on("error", () => finish(false));
  });
  request.setTimeout(2_500, () => request.destroy());
  request.on("error", () => finish(false));
}

const server = http.createServer((request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    let assetKey = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
    if (!assetKey || assetKey.endsWith("/")) assetKey += "index.html";

    if (!assetKeys.has(assetKey)) {
      const acceptsHtml = (request.headers.accept || "").includes("text/html");
      if (acceptsHtml) assetKey = "index.html";
    }

    if (!assetKeys.has(assetKey)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const body = Buffer.from(getAsset(assetKey));
    const contentType = MIME_TYPES.get(extensionOf(assetKey))
      || "application/octet-stream";
    const immutable = /(^|\/)assets\//.test(assetKey) && /-[A-Za-z0-9_-]{8,}\./.test(assetKey);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": String(body.length),
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    if (request.method === "HEAD") response.end();
    else response.end(body);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "Server error");
  }
});

const DEFAULT_PORT = 41739;
const requestedPort = Number.parseInt(
  process.env.WORD_ZOMBIE_PORT || String(DEFAULT_PORT),
  10,
);
const port = Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535
  ? requestedPort
  : 0;

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to bind local server");
  const url = `http://127.0.0.1:${address.port}/`;
  process.title = "Word Zombie";
  console.log("Word Zombie is running.");
  console.log(`Open: ${url}`);
  console.log("Keep this window open while playing. Close it to stop the game.");
  if (process.env.WORD_ZOMBIE_NO_BROWSER !== "1") openBrowser(url);
  if (process.env.WORD_ZOMBIE_VERIFY_ONCE === "1") {
    setTimeout(() => server.close(), 5_000);
  }
});

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    const url = `http://127.0.0.1:${port}/`;
    verifyWordZombieServer(url, (matches) => {
      if (matches) {
        console.log("Word Zombie is already running.");
        console.log(`Open: ${url}`);
        if (process.env.WORD_ZOMBIE_NO_BROWSER !== "1") openBrowser(url);
        return;
      }
      console.error(`Port ${port} is used by another application, not Word Zombie.`);
      process.exitCode = 1;
    });
    return;
  }
  console.error("Unable to start Word Zombie:", error);
  process.exitCode = 1;
});
