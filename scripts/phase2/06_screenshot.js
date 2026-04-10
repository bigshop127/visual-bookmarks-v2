import path from 'node:path';
import pLimit from 'p-limit';
import { loadConfig } from '../utils/config.js';
import { sha1 } from '../utils/hash.js';
import { readJson, writeJson } from '../utils/io.js';
import { captureScreenshot, closeBrowser } from './screenshot-worker.js';

export async function run() {
  const config = await loadConfig();
  const normalized = await readJson(path.resolve('output/normalized/bookmarks.normalized.json'));
  const metadata = await readJson(path.resolve('output/metadata/metadata-results.json'));
  const state = await readJson(path.resolve('state/manifest.json'));

  const normalizedById = Object.fromEntries(normalized.items.map((item) => [item.id, item]));
  const limit = pLimit(config.pipeline.screenshotConcurrency || 3);
  
  // 只處理 Metadata 階段成功，或是雖然 skip 但缺乏 screenshotHash 的項目
  const targets = metadata.items
    .filter(item => item.status !== 'metadata_failed')
    .map(item => ({ ...normalizedById[item.id], ...item }));

  const results = [];

  const tasks = targets.map((item) => limit(async () => {
    // 1. 優先使用 OG Image (極速模式)
    if (item.ogImage) {
      const ogHash = sha1(item.ogImage);
      // 如果狀態機顯示已經是這張圖，就不用更新
      if (state.items[item.id]?.screenshotHash === ogHash) {
        results.push({ id: item.id, ok: true, sourceType: 'og', coverImage: item.ogImage, mode: 'cached' });
        return;
      }
      
      state.items[item.id] = {
        ...(state.items[item.id] || {}),
        screenshotHash: ogHash, status: 'screenshot_ok', retryCount: 0, failureReason: null, quarantine: false,
        lastProcessedAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString()
      };
      results.push({ id: item.id, ok: true, sourceType: 'og', coverImage: item.ogImage, mode: 'new' });
      return;
    }

    // 2. 如果沒有 OG，且已經被隔離，直接放棄
    const currentState = state.items[item.id] || {};
    if (currentState.quarantine) {
      results.push({ id: item.id, ok: false, error: 'Quarantined' });
      return;
    }

    // 3. 呼叫 Playwright 進行截圖
    const captured = await captureScreenshot(item, config);
    
    if (!captured.ok) {
      const currentRetry = (currentState.retryCount || 0) + 1;
      const willQuarantine = currentRetry >= (config.pipeline.retryLimit || 2);
      
      state.items[item.id] = {
        ...currentState,
        status: 'screenshot_failed', retryCount: currentRetry, failureReason: captured.error,
        quarantine: willQuarantine, lastProcessedAt: new Date().toISOString()
      };
      results.push({ id: item.id, ok: false, error: captured.error });
      return;
    }

    // 4. 截圖成功，更新狀態
    const screenshotHash = sha1(captured.webPath);
    state.items[item.id] = {
      ...currentState,
      screenshotHash, status: 'screenshot_ok', retryCount: 0, failureReason: null, quarantine: false,
      lastProcessedAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString()
    };
    results.push({ id: item.id, ok: true, sourceType: 'screenshot', coverImage: captured.webPath, mode: captured.mode });
  }));

  await Promise.all(tasks);
  await closeBrowser();

  await writeJson(path.resolve('output/screenshots/screenshot-results.json'), { count: results.length, items: results });
  await writeJson(path.resolve('state/manifest.json'), state);
  
  const successCount = results.filter(r => r.ok).length;
  await writeJson(path.resolve('output/reports/screenshot-report.json'), {
    total: results.length, success: successCount, failed: results.length - successCount
  });

  return { total: results.length, success: successCount };
}