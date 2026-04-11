import path from 'node:path';
import pLimit from 'p-limit';
import { loadConfig } from '../utils/config.js';
import { sha1 } from '../utils/hash.js';
import { readJson, writeJson } from '../utils/io.js';
import { captureScreenshot, closeBrowser, downloadOgImage } from './screenshot-worker.js';
import { resolvePolicy } from '../utils/domain-policy.js';

export async function run() {
  const config = await loadConfig();
  const normalized = await readJson(path.resolve('output/normalized/bookmarks.normalized.json'));
  const metadata = await readJson(path.resolve('output/metadata/metadata-results.json'));
  const state = await readJson(path.resolve('state/manifest.json'));

  const normalizedById = Object.fromEntries(normalized.items.map((item) => [item.id, item]));
  const limit = pLimit(config.pipeline.screenshotConcurrency || 3);
  
  // 排除 metadata 抓取失敗的項目（有 error 欄位），skipped/retained 的項目保留處理
  const targets = metadata.items
    .filter(item => !item.error)
    .map(item => ({ ...normalizedById[item.id], ...item }));

  const results = [];

  const tasks = targets.map((item) => limit(async () => {
    // 1. 優先使用 OG Image：下載到本地避免 hotlink 保護
    //    但如果 domain-policy 設定 skipOgImage，直接跳過走截圖
    const itemUrl = item.finalUrl || item.normalizedUrl;
    const policy = await resolvePolicy(itemUrl);
    const shouldSkipOg = policy?.skipOgImage === true;

    if (item.ogImage && !shouldSkipOg) {
      const ogHash = sha1(item.ogImage);
      // 如果狀態機顯示已經是這張圖且本地檔案存在，就不用重下載
      if (state.items[item.id]?.screenshotHash === ogHash) {
        results.push({ id: item.id, ok: true, sourceType: 'og', coverImage: state.items[item.id].localCoverImage || item.ogImage, mode: 'cached' });
        return;
      }
      const downloaded = await downloadOgImage(item.ogImage, item.id);
      const coverImage = downloaded.ok ? downloaded.webPath : item.ogImage;
      state.items[item.id] = {
        ...(state.items[item.id] || {}),
        screenshotHash: ogHash, status: 'screenshot_ok', retryCount: 0, failureReason: null, quarantine: false,
        localCoverImage: coverImage,
        lastProcessedAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString()
      };
      results.push({ id: item.id, ok: true, sourceType: 'og', coverImage, mode: downloaded.ok ? 'og-local' : 'og-remote' });
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