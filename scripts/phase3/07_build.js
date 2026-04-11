import path from 'node:path';
import fs from 'fs-extra';
import { applyOverrides } from '../utils/overrides.js';
import { readJson, writeJson } from '../utils/io.js';
import { loadConfig } from '../utils/config.js';

function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
}

// ── 標題清理 ──────────────────────────────────
// "PHOTOS - Search Results For 'あずみ京平' - 禁漫天堂" → "あずみ京平"
// "あずみ京平 - 禁漫天堂"                               → "あずみ京平"
// 其他標題維持原樣
function cleanTitle(raw) {
  if (!raw) return raw;

  // 模式1：Search Results For '關鍵字'
  const m1 = raw.match(/Search Results For [''"「](.+?)[''"」]/i);
  if (m1) return m1[1].trim();

  // 模式2：關鍵字 - 網站名（去掉後綴）
  const m2 = raw.match(/^(.+?)\s*[-–|｜]\s*禁漫天堂/);
  if (m2) return m2[1].trim();

  const m3 = raw.match(/^(.+?)\s*[-–|｜]\s*18[Cc]omic/);
  if (m3) return m3[1].trim();

  return raw.trim();
}

export async function run() {
  const config = await loadConfig();
  const shardSize = config.pipeline.shardSize || 100;

  const normalized = await readJson(path.resolve('output/normalized/bookmarks.normalized.json'));
  const metadata   = await readJson(path.resolve('output/metadata/metadata-results.json'));
  const screenshots = await readJson(path.resolve('output/screenshots/screenshot-results.json'), { items: [] });
  const state      = await readJson(path.resolve('state/manifest.json'));

  const metadataById    = Object.fromEntries(metadata.items.map(i => [i.id, i]));
  const screenshotsById = Object.fromEntries(screenshots.items.map(i => [i.id, i]));

  let items = normalized.items.map((item) => {
    const meta = metadataById[item.id] || {};
    const shot = screenshotsById[item.id] || {};
    let domain = 'unknown';
    try { domain = new URL(meta.finalUrl || item.normalizedUrl).hostname.replace(/^www\./, ''); } catch {}

    const rawTitle = meta.title || item.cleanTitle;

    return {
      id: item.id,
      title: cleanTitle(rawTitle),           // ← 清理後的標題
      description: meta.description || '',
      normalizedUrl: item.normalizedUrl,
      finalUrl: meta.finalUrl || item.normalizedUrl,
      domain,
      tags: [],
      folderPath: item.folderPath,
      coverImage: shot.coverImage || meta.ogImage || 'https://placehold.co/600x400/1a1a24/555566?text=No+Image',
      sourceType: shot.sourceType || (meta.ogImage ? 'og' : 'fallback'),
      siteName: meta.siteName || domain,
      status: state.items[item.id]?.status || 'unknown',
      quarantine: state.items[item.id]?.quarantine || false,
      manualOverride: state.items[item.id]?.manualOverride || false,
      pinned: false, hidden: false, notes: ''
    };
  });

  items = await applyOverrides(items);
  const visibleItems = items.filter(i => !i.hidden);
  const shards = chunk(visibleItems, shardSize);

  const searchIndex = visibleItems.map(item => ({
    id: item.id, title: item.title, description: item.description,
    domain: item.domain, tags: item.tags, folderPath: item.folderPath.join(' / '), status: item.status
  }));

  // Atomic Deploy
  const stagingDir = path.resolve('dist-staging');
  await fs.ensureDir(stagingDir);
  await fs.emptyDir(stagingDir);

  const sourceScreenshots = path.resolve('dist/assets/screenshots');
  if (await fs.pathExists(sourceScreenshots)) {
    await fs.copy(sourceScreenshots, path.resolve(stagingDir, 'assets/screenshots'));
  }

  await fs.ensureDir(path.resolve(stagingDir, 'assets'));
  await fs.copy(path.resolve('node_modules/fuse.js/dist/fuse.mjs'), path.resolve(stagingDir, 'assets/fuse.mjs'));
  await fs.copy(path.resolve('src/styles/main.css'), path.resolve(stagingDir, 'main.css'));
  await fs.copy(path.resolve('src/app/app.js'),      path.resolve(stagingDir, 'app.js'));
  await fs.copy(path.resolve('src/index.html'),      path.resolve(stagingDir, 'index.html'));

  await fs.ensureDir(path.resolve(stagingDir, 'data/shards'));
  await writeJson(path.resolve(stagingDir, 'data/search-index.json'), searchIndex);
  await writeJson(path.resolve(stagingDir, 'data/report.json'), {
    total: visibleItems.length,
    failed: visibleItems.filter(i => i.status.includes('failed')).length,
    quarantined: visibleItems.filter(i => i.quarantine).length
  });
  await writeJson(path.resolve(stagingDir, 'data/build-manifest.json'), { shardCount: shards.length });
  await Promise.all(shards.map((s, i) => writeJson(path.resolve(stagingDir, `data/shards/items-${i+1}.json`), s)));

  const distDir = path.resolve('dist');
  if (await fs.pathExists(distDir)) await fs.remove(distDir);
  await fs.move(stagingDir, distDir);

  await writeJson(path.resolve('output/build/items.all.json'), visibleItems);
  return shards.length;
}
