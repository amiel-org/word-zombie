import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { listFiles, shouldPackage } from "./release_files.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version: VERSION } = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const distDir = join(root, "dist");
const generatedDir = join(root, "packaging", "windows", "generated");
const releaseDir = join(root, "releases", `word-zombie-windows-v${VERSION}`);
const blobPath = join(generatedDir, "word-zombie.blob");
const configPath = join(generatedDir, "sea-config.json");
const executablePath = join(releaseDir, "Word-Zombie-Windows-x64.exe");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${String(result.status)}`);
  }
}

await mkdir(generatedDir, { recursive: true });
await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

const assets = {};
for (const path of await listFiles(distDir)) {
  const key = relative(distDir, path).replaceAll("\\", "/");
  if (!shouldPackage(key)) continue;
  assets[key] = path;
}

await writeFile(configPath, JSON.stringify({
  main: join(root, "packaging", "windows", "launcher.cjs"),
  output: blobPath,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: true,
  assets,
}, null, 2), "utf8");

run(process.execPath, ["--experimental-sea-config", configPath]);
await copyFile(process.execPath, executablePath);

const postject = join(root, "node_modules", "postject", "dist", "cli.js");
run(process.execPath, [
  postject,
  executablePath,
  "NODE_SEA_BLOB",
  blobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
]);

await writeFile(join(releaseDir, "使用说明.txt"), [
  "单词大战僵尸 Windows x64 单文件版",
  "",
  "1. 双击 Word-Zombie-Windows-x64.exe。",
  "2. 程序会自动打开默认浏览器，游戏完全在本机运行，不需要联网。",
  "3. 玩游戏时请保留黑色运行窗口；关闭该窗口即可停止游戏。",
  "4. 学习记录按本机学习档案分别保存在浏览器中，可在“学习进度”里导出备份。",
  "5. 如果 Windows 首次提示未知发布者，请选择“更多信息”后再运行；本文件未做商业代码签名。",
  "",
  `版本：${VERSION}`,
].join("\r\n"), "utf8");

console.log(JSON.stringify({
  releaseDir,
  executablePath,
  embeddedAssets: Object.keys(assets).length,
}, null, 2));
