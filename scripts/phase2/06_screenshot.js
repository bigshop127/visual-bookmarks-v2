import path from 'node:path';
import fs from 'fs-extra';
import pLimit from 'p-limit';
import { loadConfig } from '../utils/config.js';
import { sha1 } from '../utils/hash.js';
import { readJson, writeJson } from '../utils/io.js';
import { resolvePolicy } from '../utils/domain-policy.js';
import { captureScreenshot, closeBrowser } from './screenshot-worker.js';

export async function run() {
  const config = await loadConfig();
  const normalized = await readJson(path.resolve('output/normalized/bookmarks.normalized.json'));
  const metadata = await readJson(path.resolve('output/metadata/metadata-results.json'));
  const state = await readJson(path.resolve('state/manifest.json'));

  // 確保截圖目錄存在（不清空，保留已有截圖）
  const screenshotDir = path.resolve('dist/assets/screenshots');
  await fs.ensureDir(screenshotDir);

  const normalizedById = Object.fromEntries(normalized.items.map((item) => [item.id, item]));
  const limit = pLimit(1); // 單一並發避免 Cloudflare 擋住
  
  // 處理所有項目（包括 metadata 失敗的，用 Playwright 重新抓）
  const targets = metadata.items
    .map(item => ({ ...normalizedById[item.id], ...item }));

  const results = [];

  const tasks = targets.map((item) => limit(async () => {
    // 0. 如果截圖檔案已存在，直接跳過（支援中斷續跑）
    const existingPath = path.resolve(`dist/assets/screenshots/${item.id}.jpg`);
    if (await fs.pathExists(existingPath)) {
      const webPath = `./assets/screenshots/${item.id}.jpg`;
      results.push({ id: item.id, ok: true, sourceType: 'screenshot', coverImage: webPath, mode: 'existing' });
      state.items[item.id] = {
        ...(state.items[item.id] || {}),
        status: 'screenshot_ok', retryCount: 0, failureReason: null, quarantine: false,
        lastProcessedAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString()
      };
      return;
    }

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

    // 3. 檢查 domain policy 是否跳過截圖
    const targetUrl = item.finalUrl || item.normalizedUrl;
    const policy = await resolvePolicy(targetUrl);
    if (policy?.skipScreenshot) {
      results.push({ id: item.id, ok: false, error: `Domain policy: skipScreenshot (${policy.note || ''})` });
      return;
    }

    // 4. 呼叫 Playwright 進行截圖
    const captured = await captureScreenshot(item, config);
    
    if (!captured.ok) {
      const currentRetry = (currentState.retryCount || 0) + 1;
      const willQuarantine = currentRetry >= (config.pipeline.retryLimit || 2);
      
      state.items[item.id] = {
        ...currentState,
        status: 'screenshot_failed', retryCount: currentRetry, failureReason: captured.error,
        quarantine: willQuarantine, lastProcessedAt: new Date().toISOString()
      };
      results.push({ id: item.id, ok: false, error: captured.error, extractedMeta: captured.extractedMeta });
      return;
    }

    // 5. 截圖成功，更新狀態
    const screenshotHash = sha1(captured.webPath);
    state.items[item.id] = {
      ...currentState,
      screenshotHash, status: 'screenshot_ok', retryCount: 0, failureReason: null, quarantine: false,
      lastProcessedAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString()
    };
    results.push({ id: item.id, ok: true, sourceType: 'screenshot', coverImage: captured.webPath, mode: captured.mode, extractedMeta: captured.extractedMeta });
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