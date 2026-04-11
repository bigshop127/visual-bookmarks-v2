import path from 'node:path';
import fs from 'fs-extra';
import axios from 'axios';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { resolvePolicy } from '../utils/domain-policy.js';
import { ensureDir } from '../utils/io.js';
import { loadConfig } from '../utils/config.js';

chromium.use(stealthPlugin());

// 每個 item 獨立建立 context，不共用 browser instance
// （launchPersistentContext 模式下沒有 browser 物件）

const POPUP_SELECTORS = [
  "button:has-text('我保證我已滿18歲')",
  "button:has-text('確定進入')",
  "button:has-text('Enter')",
  "button:has-text('I am 18')",
  "button:has-text('I am over 18')",
  "a:has-text('我已年滿18歲')",
  "a:has-text('進入')",
  ".age-verify button",
  "#age-verify button",
  "[class*='age'] button",
  "[class*='modal'] button[class*='confirm']",
  "[class*='popup'] button[class*='ok']",
];

async function dismissPopups(page, maxRounds = 3) {
  let totalClicked = 0;
  for (let round = 0; round < maxRounds; round++) {
    let clickedThisRound = 0;
    for (const selector of POPUP_SELECTORS) {
      try {
        const btn = page.locator(selector).first();
        const isVisible = await btn.isVisible({ timeout: 800 }).catch(() => false);
        if (!isVisible) continue;
        await btn.click({ timeout: 3000 });
        console.log(`  [popup] 關閉成功：${selector}`);
        clickedThisRound++;
        totalClicked++;
        await page.waitForTimeout(800);
      } catch { /* skip */ }
    }
    if (clickedThisRound === 0) break;
    await page.waitForTimeout(800);
  }
  return totalClicked;
}

async function isCloudflareChallenge(page) {
  return page.evaluate(() => {
    const title = document.title.toLowerCase();
    const body = document.body?.innerText || '';
    return (
      title.includes('just a moment') ||
      title.includes('checking your browser') ||
      body.includes('Performing security verification') ||
      body.includes('Verify you are human') ||
      !!document.querySelector('#cf-challenge-running, #cf-spinner, .cf-browser-verification')
    );
  }).catch(() => false);
}

async function waitForImages(page, timeoutMs = 8000) {
  return page.evaluate((timeout) => {
    return new Promise((resolve) => {
      const imgs = [...document.querySelectorAll('img')].filter(img => !img.complete);
      if (imgs.length === 0) return resolve();
      let done = 0;
      const check = () => { if (++done >= imgs.length) resolve(); };
      imgs.forEach(img => { img.onload = img.onerror = check; });
      setTimeout(resolve, timeout);
    });
  }, timeoutMs);
}

export async function downloadOgImage(ogUrl, itemId) {
  const localOutputPath = path.resolve(`dist/assets/screenshots/${itemId}.jpg`);
  const webPath = `./assets/screenshots/${itemId}.jpg`;
  try {
    await ensureDir(localOutputPath);
    const response = await axios.get(ogUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Referer': new URL(ogUrl).origin,
      },
    });
    await fs.outputFile(localOutputPath, response.data);
    return { ok: true, webPath };
  } catch (err) {
    console.error(`  [og-download] ❌ ${itemId}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

export async function captureScreenshot(item, config) {
  const targetUrl = item.finalUrl || item.normalizedUrl;
  const policy = await resolvePolicy(targetUrl);

  const chromeConfig = config.app.chrome;
  if (!chromeConfig?.userDataDir) {
    return { ok: false, error: 'app.config.json 缺少 chrome.userDataDir 設定' };
  }

  const localOutputPath = path.resolve(`dist/assets/screenshots/${item.id}.jpg`);
  const webPath = `./assets/screenshots/${item.id}.jpg`;
  await ensureDir(localOutputPath);

  // ── 使用本機 Chrome Profile 建立 PersistentContext ──────────────────
  // ⚠️  執行期間 Chrome 必須完全關閉
  const blockResourceTypes =
    policy?.blockResourceTypes ||
    config.pipeline.requestBlockResourceTypes ||
    ['media', 'font'];

  let context;
  try {
    context = await chromium.launchPersistentContext(chromeConfig.userDataDir, {
      executablePath: chromeConfig.executablePath,
      headless: true,
      args: [
        `--profile-directory=${chromeConfig.profileDirectory || 'Default'}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
      viewport: { width: 1280, height: 1600 },
      serviceWorkers: 'block',
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
    });
  } catch (err) {
    // Chrome 未關閉時會報 lock 錯誤，給出清楚提示
    if (err.message.includes('lock') || err.message.includes('user data')) {
      return { ok: false, error: '⚠️  請先完全關閉 Chrome 再執行 Phase 2！' };
    }
    return { ok: false, error: err.message };
  }

  const page = await context.newPage();

  await page.route('**/*', (route) => {
    if (blockResourceTypes.includes(route.request().resourceType())) return route.abort();
    return route.continue();
  });

  try {
    // 1. 載入頁面
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);

    // 2. 偵測 Cloudflare（已登入帳號通常直接過，但保留偵測邏輯）
    let cfRetries = 0;
    while (await isCloudflareChallenge(page) && cfRetries < 4) {
      console.log(`  [cf] Cloudflare 驗證中，等待... (${cfRetries + 1}/4)`);
      await page.waitForTimeout(5000);
      cfRetries++;
    }
    if (await isCloudflareChallenge(page)) {
      await context.close();
      return { ok: false, error: 'Cloudflare challenge not resolved（嘗試手動開 Chrome 登入後再跑）' };
    }

    // 3. 彈窗處理
    await dismissPopups(page, 3);
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await dismissPopups(page, 2);
    await page.waitForTimeout(500);

    // 4. 捲動 + 等待懶加載圖片真正載入
    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    const steps = Math.min(Math.ceil(pageHeight / 900), 12);

    for (let i = 1; i <= steps; i++) {
      await page.evaluate((pos) => window.scrollTo({ top: pos, behavior: 'instant' }),
        Math.floor(pageHeight * i / steps));
      await waitForImages(page, 2000);
      await page.waitForTimeout(500);
    }

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(800);
    await waitForImages(page, 5000);

    // 5. 截全頁
    await page.screenshot({
      path: localOutputPath,
      fullPage: true,
      type: 'jpeg',
      quality: 82,
    });

    await context.close();
    return { ok: true, webPath, mode: 'chrome-profile' };
  } catch (error) {
    console.error(`  [screenshot] ❌ ${item.id} (${targetUrl}): ${error.message}`);
    await context.close().catch(() => {});
    return { ok: false, error: error.message };
  }
}

// launchPersistentContext 模式下每個 item 自己開關 context
// 不需要全域 browser，closeBrowser 保留為空函式維持介面相容
export async function closeBrowser() {}