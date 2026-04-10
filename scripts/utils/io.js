import fs from 'fs-extra';
import path from 'node:path';

export async function ensureDir(fileOrDirPath) {
  const dir = path.extname(fileOrDirPath) ? path.dirname(fileOrDirPath) : fileOrDirPath;
  await fs.ensureDir(dir);
}

export async function readJson(filePath, fallback = null) {
  const exists = await fs.pathExists(filePath);
  if (!exists) {
    if (fallback !== null) return fallback;
    throw new Error(`File not found: ${filePath}`);
  }
  return fs.readJson(filePath);
}

export async function writeJson(filePath, data) {
  await ensureDir(filePath);
  await fs.writeJson(filePath, data, { spaces: 2 });
}