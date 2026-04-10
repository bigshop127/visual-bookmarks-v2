import path from 'node:path';
import { chromium } from 'playwright';
import { resolvePolicy } from '../utils/domain-policy.js';
import { ensureDir } from '../utils/io.js';

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

export async function captureScreenshot(item, config) {
  const browser = await getBrowser();
  const targetUrl = item.finalUrl || item.normalizedUrl;
  const policy = await resolvePolicy(targetUrl);
  
  // 徹底隔離的 BrowserContext
  const context = await browser.newContext({
    viewport: config.app.defaultViewport || { width: 1280, height: 800 },
    serviceWorkers: 'block' // 阻擋 Service Worker 避免快取干擾
  });

  const page = await context.newPage();

  // 資源節流防護網
  const blockResourceTypes = policy?.blockResourceTypes || config.pipeline.requestBlockResourceTypes || ['media', 'font'];
  await page.route('**/*', (route) => {
    if (blockResourceTypes.includes(route.request().resourceType())) {
      return route.abort();
    }
    return route.continue();
  });

  // 實體存放路徑 (用於存檔)
  const localOutputPath = path.resolve(`dist/assets/screenshots/${item.id}.jpg`);
  // 前端讀取路徑 (永遠保持 POSIX 格式)
  const webPath = `./assets/screenshots/${item.id}.jpg`;
  
  await ensureDir(localOutputPath);

  try {
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: policy?.timeoutMs || config.pipeline.screenshotTimeoutMs || 30000
    });

    const isControlled = policy?.forceProgressiveScroll || false;
    
    if (isControlled) {
      const steps = config.pipeline.progressiveScrollSteps || 5;
      for (let i = 1; i <= steps; i++) {
        await page.evaluate((step, total) => {
          window.scrollTo({ top: document.body.scrollHeight * (step / total), behavior: 'instant' });
        }, i, steps);
        await page.waitForTimeout(600); // 給予畫面渲染時間
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForTimeout(800); // 確保回到頂部後導航列等元素穩定
    } else {
      await page.waitForTimeout(1000); // Quick mode 也給予基礎渲染緩衝
    }

    await page.screenshot({
      path: localOutputPath,
      fullPage: false,
      type: 'jpeg',
      quality: 82
    });

    await context.close();
    return { ok: true, webPath, mode: isControlled ? 'controlled' : 'quick' };
  } catch (error) {
    await context.close();
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