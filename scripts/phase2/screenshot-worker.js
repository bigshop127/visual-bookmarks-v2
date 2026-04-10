import path from 'node:path';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { resolvePolicy } from '../utils/domain-policy.js';
import { ensureDir } from '../utils/io.js';

chromium.use(stealthPlugin());
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true });
  return browserPromise;
}

export async function captureScreenshot(item, config) {
  const browser = await getBrowser();
  const targetUrl = item.finalUrl || item.normalizedUrl;
  const policy = await resolvePolicy(targetUrl);
  
  const context = await browser.newContext({
    viewport: config.app.defaultViewport || { width: 1280, height: 800 },
    serviceWorkers: 'block'
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
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    
    // 強制等待 8 秒，讓 Cloudflare 驗證轉圈圈跑完
    await page.waitForTimeout(8000); 

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