import path from 'node:path';
import pLimit from 'p-limit';
import { fetchMetadata } from '../utils/metadata.js';
import { sha1 } from '../utils/hash.js';
import { loadConfig } from '../utils/config.js';
import { readJson, writeJson } from '../utils/io.js';

export async function run() {
  const config = await loadConfig();
  const diff = await readJson(path.resolve('output/diff/diff-results.json'));
  const normalized = await readJson(path.resolve('output/normalized/bookmarks.normalized.json'));

  // 加上 fallback，state 不存在時視為全新狀態
  const state = await readJson(path.resolve('state/manifest.json'), { items: {} });

  const normalizedById = Object.fromEntries(normalized.items.map(i => [i.id, i]));
  const metadataItems = [];
  
  // 使用 p-limit 控制併發，避免 axios 一口氣發出數百個請求被封鎖
  const limit = pLimit(config.pipeline.screenshotConcurrency || 3);
  
  const tasks = diff.items.filter(entry => entry.action !== 'skip').map(entry => limit(async () => {
    const item = normalizedById[entry.id];
    try {
      const metadata = await fetchMetadata(item.normalizedUrl, 12000);
      const metadataHash = sha1(JSON.stringify(metadata));
      
      metadataItems.push({ id: item.id, ...metadata, metadataHash });
      
      state.items[item.id] = {
        ...(state.items[item.id] || {}),
        id: item.id, sourceUrl: item.url, normalizedUrl: item.normalizedUrl, finalUrl: metadata.finalUrl,
        identityHash: item.identityHash, contentHash: item.contentHash, metadataHash,
        status: 'metadata_ok', retryCount: 0, failureReason: null, quarantine: false,
        manualOverride: false, lastProcessedAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString()
      };
    } catch (error) {
      metadataItems.push({ id: item.id, error: error.message, finalUrl: item.normalizedUrl, metadataHash: null });
      state.items[item.id] = {
        ...(state.items[item.id] || {}),
        id: item.id, sourceUrl: item.url, normalizedUrl: item.normalizedUrl, identityHash: item.identityHash, contentHash: item.contentHash,
        status: 'metadata_failed', retryCount: (state.items[item.id]?.retryCount || 0) + 1, failureReason: error.message,
        lastProcessedAt: new Date().toISOString()
      };
    }
  }));

  await Promise.all(tasks);
  
  // 把 skip 的也保留進結果中
  diff.items.filter(e => e.action === 'skip').forEach(e => {
      const prev = state.items[e.id];
      if (prev && prev.status === 'metadata_ok') metadataItems.push({ id: e.id, status: 'skipped (retained)' });
  });

  await writeJson(path.resolve('output/metadata/metadata-results.json'), { count: metadataItems.length, items: metadataItems });
  await writeJson(path.resolve('state/manifest.json'), state);
  return tasks.length; // 回傳處理的數量
}