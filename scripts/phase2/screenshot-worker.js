import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { chromium } from 'playwright';
import { resolvePolicy } from '../utils/domain-policy.js';
import { ensureDir } from '../utils/io.js';

let contextPromise = null;

function getChromeProfileDir() {
  const platform = os.platform();
  if (platform === 'win32') return path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default');
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Default');
  return path.join(os.homedir(), '.config', 'google-chrome', 'Default');
}

async function waitForRealContent(page, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const title = await page.title().catch(() => '');
    if (title.includes('Just a moment') || title.includes('Checking') || title.includes('Attention')) {
      await page.waitForTimeout(2000);
      continue;
    }
    const hasContent = await page.evaluate(() => document.body && document.body.innerText.length > 100).catch(() => false);
    if (hasContent) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function getContext() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const chromeProfile = getChromeProfileDir();
      const tmpDir = path.join(os.tmpdir(), 'vb-chrome-profile');
      const tmpDefault = path.join(tmpDir, 'Default');
      await fs.emptyDir(tmpDir);
      await fs.ensureDir(tmpDefault);

      for (const file of ['Network/Cookies', 'Network/Cookies-journal', 'Local Storage', 'Session Storage', 'Preferences']) {
        const src = path.join(chromeProfile, file);
        const dst = path.join(tmpDefault, file);
        if (await fs.pathExists(src)) await fs.copy(src, dst, { overwrite: true });
      }
      console.log(`  📂 Chrome Cookie 已複製到: ${tmpDir}`);

      const context = await chromium.launchPersistentContext(tmpDir, {
        channel: 'chrome',
        headless: false,
        args: ['--profile-directory=Default', '--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        locale: 'zh-TW'
      });

      console.log(`  🔑 正在通過 Cloudflare 驗證...`);
      const warmupPage = await context.newPage();
      await warmupPage.goto('https://18comic.vip/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForRealContent(warmupPage, 45000);

      try {
        const ageBtn = warmupPage.locator('text=我保證我已滿18歲');
        if (await ageBtn.isVisible({ timeout: 3000 })) {
          await ageBtn.click();
          await warmupPage.waitForTimeout(2000);
          console.log(`  ✅ 已通過年齡驗證`);
        }
      } catch {}

      await warmupPage.close();
      await new Promise(r => setTimeout(r, 3000));
      console.log(`  ✅ Cloudflare 驗證完成，開始截圖`);
      return context;
    })();
  }
  return contextPromise;
}

export async function captureScreenshot(item, config) {
  const context = await getContext();
  const targetUrl = item.finalUrl || item.normalizedUrl;
  const policy = await resolvePolicy(targetUrl);

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  const blockResourceTypes = policy?.blockResourceTypes || config.pipeline.requestBlockResourceTypes || ['media'];
  await page.route('**/*', (route) => {
    if (blockResourceTypes.includes(route.request().resourceType())) return route.abort();
    return route.continue();
  });

  const localOutputPath = path.resolve(`dist/assets/screenshots/${item.id}.jpg`);
  const webPath = `./assets/screenshots/${item.id}.jpg`;
  await ensureDir(localOutputPath);

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const loaded = await waitForRealContent(page, 30000);
    if (!loaded) {
      await page.close();
      return { ok: false, error: 'Page did not load' };
    }

    // 充足的載入時間
    await page.waitForTimeout(5000);
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}

    // 年齡驗證
    try {
      const ageButton = page.locator('text=我保證我已滿18歲');
      if (await ageButton.isVisible({ timeout: 2000 })) {
        await ageButton.click();
        await page.waitForTimeout(2000);
      }
    } catch {}

    // 移除彈窗
    try {
      await page.evaluate(() => {
        document.querySelectorAll('[class*="modal"], [class*="popup"], [class*="overlay"], [id*="modal"], [id*="popup"]')
          .forEach(el => { const s = getComputedStyle(el); if (s.position === 'fixed' || s.position === 'absolute') el.remove(); });
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto';
      });
    } catch {}

    // 提取 metadata
    const extractedMeta = await page.evaluate(() => {
      const getMeta = (sel, attr = 'content') => { const el = document.querySelector(sel); return el ? el.getAttribute(attr) : null; };
      return {
        title: document.title || null,
        ogImage: getMeta('meta[property="og:image"]'),
        description: getMeta('meta[name="description"]') || getMeta('meta[property="og:description"]'),
        siteName: getMeta('meta[property="og:site_name"]')
      };
    });

    // 逐段捲動整頁，觸發所有 lazy-load 圖片
    const totalHeight = await page.evaluate(() => document.body.scrollHeight);
    const viewportH = 800;
    const chunks = Math.ceil(totalHeight / viewportH);
    for (let i = 1; i <= Math.min(chunks, 30); i++) {
      await page.evaluate(({pos}) => window.scrollTo(0, pos), { pos: i * viewportH });
      await page.waitForTimeout(2000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);

    // ====== 強制載入所有 lazy 圖片 ======
    await page.evaluate(() => {
      document.querySelectorAll('img').forEach(img => {
        // 常見 lazy-load 屬性
        const realSrc = img.getAttribute('data-original') 
          || img.getAttribute('data-src') 
          || img.getAttribute('data-lazy-src')
          || img.getAttribute('data-lazy');
        if (realSrc && !img.src.includes(realSrc)) {
          img.src = realSrc;
        }
        img.loading = 'eager';
        img.removeAttribute('loading');
      });
      // 停用 IntersectionObserver（部分 lazy-load 庫用這個）
      if (window.IntersectionObserver) {
        window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      }
    });

    // 等圖片實際載入，最多等 15 秒
    for (let retry = 0; retry < 6; retry++) {
      await page.waitForTimeout(2500);
      const imgStats = await page.evaluate(() => {
        const imgs = Array.from(document.images).filter(img => img.src && img.width > 20);
        const loaded = imgs.filter(img => img.complete && img.naturalWidth > 0);
        return { total: imgs.length, loaded: loaded.length };
      });
      const loadRate = imgStats.total > 0 ? imgStats.loaded / imgStats.total : 1;
      console.log(`    📷 [${item.id}] 圖片載入: ${imgStats.loaded}/${imgStats.total} (${(loadRate * 100).toFixed(0)}%)`);
      if (loadRate >= 0.85) break;
    }

    // 取得最終頁面高度
    const scrollHeight = await page.evaluate(() => Math.max(
      document.body.scrollHeight, document.documentElement.scrollHeight
    ));
    const captureHeight = Math.min(scrollHeight, 12000);

    // 用 CDP 暫時把 viewport 高度設成整頁高度，再截圖
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: captureHeight,
      deviceScaleFactor: 1,
      mobile: false
    });
    await page.waitForTimeout(1500); // 等重新排版

    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 85
    });

    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.detach();
    fs.writeFileSync(localOutputPath, Buffer.from(data, 'base64'));

    const stat = await fs.stat(localOutputPath);
    if (stat.size < 5000) {
      await fs.remove(localOutputPath);
      await page.close();
      return { ok: false, error: `Screenshot too small: ${stat.size} bytes`, extractedMeta };
    }

    await page.close();
    console.log(`  ✓ [${item.id}] 截圖成功 (${(stat.size / 1024).toFixed(0)}KB): ${targetUrl}`);
    return { ok: true, webPath, mode: 'chrome', extractedMeta };
  } catch (error) {
    if (await fs.pathExists(localOutputPath)) await fs.remove(localOutputPath);
    try { await page.close(); } catch {}
    console.warn(`  ✗ [${item.id}] 截圖失敗: ${error.message.slice(0, 120)}`);
    return { ok: false, error: error.message };
  }
}

export async function closeBrowser() {
  if (contextPromise) {
    const context = await contextPromise;
    await context.close();
    contextPromise = null;
  }
  await fs.remove(path.join(os.tmpdir(), 'vb-chrome-profile')).catch(() => {});
}