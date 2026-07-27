import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { listFiles, shouldPackage } from "./release_files.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version: VERSION } = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const distDir = join(root, "dist");
const releaseDir = join(root, "releases", `word-zombie-pwa-v${VERSION}`);

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

let packagedFiles = 0;
for (const source of await listFiles(distDir)) {
  const key = relative(distDir, source).replaceAll("\\", "/");
  if (!shouldPackage(key)) continue;
  const destination = join(releaseDir, key);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  packagedFiles += 1;
}

const deployReadme = await readFile(
  join(root, "packaging", "PWA_DEPLOY_README.txt"),
  "utf8",
);
await writeFile(
  join(releaseDir, "部署说明.txt"),
  deployReadme.replaceAll("v2.1.0", `v${VERSION}`),
  "utf8",
);

console.log(JSON.stringify({ releaseDir, packagedFiles }, null, 2));
