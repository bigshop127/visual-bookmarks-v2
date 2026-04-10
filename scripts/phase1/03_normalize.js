import path from 'node:path';
import { loadConfig } from '../utils/config.js';
import { readJson, writeJson } from '../utils/io.js';
import { normalizeBookmark } from '../utils/normalize.js';
import { readFileSync } from 'node:fs';

export async function run() {
  const config = await loadConfig();
  const ignoreParams = JSON.parse(readFileSync(path.resolve('rules/ignore-params.json'), 'utf-8'));
  
  const validated = await readJson(path.resolve('output/validated/bookmarks.validated.json'));
  const items = validated.items.map((item) => {
    const normalized = normalizeBookmark(item, ignoreParams);
    // 直接保留擴充套件已經處理好的標準時間
    normalized.dateAdded = item.dateAdded;
    return normalized;
  });

  await writeJson(path.resolve('output/normalized/bookmarks.normalized.json'), { count: items.length, items });
  return items.length;
}