import path from 'node:path';
import fs from 'fs-extra';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { resolvePolicy } from '../utils/domain-policy.js';
import { ensureDir } from '../utils/io.js';

chromium.use(stealthPlugin());
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browserPromise;
}

export async function captureScreenshot(item, config) {
  const browser = await getBrowser();
  const targetUrl = item.finalUrl || item.normalizedUrl;
  const policy = await resolvePolicy(targetUrl);

  const viewport = config.app.defaultViewport || { width: 1280, height: 800 };
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: 'zh-TW',
    serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  const blockResourceTypes = policy?.blockResourceTypes || config.pipeline.requestBlockResourceTypes || ['media', 'font'];
  await page.route('**/*', (route) => {
    if (blockResourceTypes.includes(route.request().resourceType())) return route.abort();
    return route.continue();
  });

  const localOutputPath = path.resolve(`dist/assets/screenshots/${item.id}.jpg`);
  const webPath = `./assets/screenshots/${item.id}.jpg`;
  await ensureDir(localOutputPath);

  try {
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // ====== 驗證：檢查是否被重定向到不相關的網域 ======
    const finalUrl = page.url();
    let targetDomain, finalDomain;
    try {
      targetDomain = new URL(targetUrl).hostname.replace(/^www\./, '');
      finalDomain = new URL(finalUrl).hostname.replace(/^www\./, '');
    } catch { /* ignore */ }

    if (targetDomain && finalDomain && targetDomain !== finalDomain) {
      const targetBase = targetDomain.split('.').slice(-2).join('.');
      const finalBase = finalDomain.split('.').slice(-2).join('.');
      if (targetBase !== finalBase) {
        console.warn(`  ⚠ [${item.id}] 重定向到不同網域: ${targetUrl} → ${finalUrl}`);
        await context.close();
        return { ok: false, error: `Redirected to different domain: ${finalDomain}` };
      }
    }

    // HTTP 錯誤檢查
    if (response && response.status() >= 400) {
      console.warn(`  ⚠ [${item.id}] HTTP ${response.status()}: ${targetUrl}`);
      await context.close();
      return { ok: false, error: `HTTP ${response.status()}` };
    }

    // 等待頁面載入
    await page.waitForTimeout(3000);
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch { /* 超時沒關係 */ }

    const isControlled = policy?.forceProgressiveScroll || false;
    if (isControlled) {
      for (let i = 1; i <= 5; i++) {
        await page.evaluate((step) => window.scrollTo({ top: document.body.scrollHeight * (step / 5), behavior: 'instant' }), i);
        await page.waitForTimeout(800);
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: localOutputPath, fullPage: false, type: 'jpeg', quality: 82 });

    // ====== 驗證：截圖檔案大小 ======
    const stat = await fs.stat(localOutputPath);
    if (stat.size < 5000) {
      console.warn(`  ⚠ [${item.id}] 截圖太小 (${stat.size} bytes): ${targetUrl}`);
      await fs.remove(localOutputPath);
      await context.close();
      return { ok: false, error: `Screenshot too small: ${stat.size} bytes` };
    }

    await context.close();
    console.log(`  ✓ [${item.id}] 截圖成功 (${(stat.size / 1024).toFixed(0)}KB): ${targetUrl}`);
    return { ok: true, webPath, mode: isControlled ? 'controlled' : 'quick' };
  } catch (error) {
    if (await fs.pathExists(localOutputPath)) await fs.remove(localOutputPath);
    await context.close();
    console.warn(`  ✗ [${item.id}] 截圖失敗: ${error.message.slice(0, 100)}`);
    return { ok: false, error: error.message };
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}
