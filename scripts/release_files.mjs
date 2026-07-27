import { readdir } from "node:fs/promises";
import { join } from "node:path";

const EXCLUDED_RUNTIME_FILES = new Set([
  "assets/battle/app-icon.png",
  "assets/battle/weapon-dictionary.png",
  "assets/battle/weapon-pen.png",
  "assets/battle/word-cannon-base.png",
]);

export async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export function shouldPackage(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  return !normalized.endsWith(".map") && !EXCLUDED_RUNTIME_FILES.has(normalized);
}

