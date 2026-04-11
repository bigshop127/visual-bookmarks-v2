import path from 'node:path';
import { readJson, writeJson } from '../utils/io.js';

export async function run() {
  const normalized = await readJson(path.resolve('output/normalized/bookmarks.normalized.json'));
  
  // 加上 fallback，state 不存在時視為全新狀態
  const state = await readJson(path.resolve('state/manifest.json'), { items: {} });

  const results = normalized.items.map((item) => {
    const previous = state.items[item.id];
    const isNew = !previous;
    const contentChanged = previous && previous.contentHash !== item.contentHash;

    return {
      id: item.id,
      title: item.cleanTitle,
      normalizedUrl: item.normalizedUrl,
      identityHash: item.identityHash,
      contentHash: item.contentHash,
      action: isNew ? 'new' : contentChanged ? 'update' : 'skip'
    };
  });

  await writeJson(path.resolve('output/diff/diff-results.json'), { count: results.length, items: results });
  return results.filter(r => r.action !== 'skip').length;
} 