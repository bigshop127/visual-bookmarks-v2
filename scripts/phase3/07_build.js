import path from 'node:path';
import fs from 'fs-extra';
import { applyOverrides } from '../utils/overrides.js';
import { readJson, writeJson } from '../utils/io.js';
import { loadConfig } from '../utils/config.js';

function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export async function run() {
  const config = await loadConfig();
  const shardSize = config.pipeline.shardSize || 100;

  const normalized = await readJson(path.resolve('output/normalized/bookmarks.normalized.json'));
  const metadata = await readJson(path.resolve('output/metadata/metadata-results.json'));
  const screenshots = await readJson(path.resolve('output/screenshots/screenshot-results.json'), { items: [] });
  const state = await readJson(path.resolve('state/manifest.json'));

  const metadataById = Object.fromEntries(metadata.items.map((item) => [item.id, item]));
  const screenshotsById = Object.fromEntries(screenshots.items.map((item) => [item.id, item]));

  let items = normalized.items.map((item) => {
    const meta = metadataById[item.id] || {};
    const shot = screenshotsById[item.id] || {};
    let domain = 'unknown';
    try {
      domain = new URL(meta.finalUrl || item.normalizedUrl).hostname.replace(/^www\./, '');
    } catch (e) {}

    return {
      id: item.id,
      title: meta.title || item.cleanTitle,
      description: meta.description || '',
      normalizedUrl: item.normalizedUrl,
      finalUrl: meta.finalUrl || item.normalizedUrl,
      domain,
      tags: [],
      folderPath: item.folderPath,
      // 將絕對路徑轉換為網頁相對路徑，避開部署破圖問題
      coverImage: shot.coverImage || meta.ogImage || './assets/placeholders/default-cover.svg',
      sourceType: shot.sourceType || (meta.ogImage ? 'og' : 'fallback'),
      siteName: meta.siteName || domain,
      status: state.items[item.id]?.status || 'unknown',
      quarantine: state.items[item.id]?.quarantine || false,
      manualOverride: state.items[item.id]?.manualOverride || false,
      pinned: false,
      hidden: false,
      notes: ''
    };
  });

  items = await applyOverrides(items);
  const visibleItems = items.filter((item) => !item.hidden);
  const shards = chunk(visibleItems, shardSize);

  const searchIndex = visibleItems.map((item) => ({
    id: item.id, title: item.title, description: item.description,
    domain: item.domain, tags: item.tags, folderPath: item.folderPath.join(' / '), status: item.status
  }));

  // ==============================
  // Atomic Deploy: Staging Swap 機制
  // ==============================
  const stagingDir = path.resolve('dist-staging');
  await fs.ensureDir(stagingDir);
  await fs.emptyDir(stagingDir);

  // 1. 複製圖片資產 (若有)
  const sourceScreenshots = path.resolve('dist/assets/screenshots');
  if (await fs.pathExists(sourceScreenshots)) {
    await fs.copy(sourceScreenshots, path.resolve(stagingDir, 'assets/screenshots'));
  }

  // 2. 複製 Fuse.js 到本地，實現離線架構
  await fs.ensureDir(path.resolve(stagingDir, 'assets'));
  await fs.copy(path.resolve('node_modules/fuse.js/dist/fuse.mjs'), path.resolve(stagingDir, 'assets/fuse.mjs'));

  // 3. 把 src 前端檔案拉平到 dist 中
  await fs.copy(path.resolve('src/styles/main.css'), path.resolve(stagingDir, 'main.css'));
  await fs.copy(path.resolve('src/app/app.js'), path.resolve(stagingDir, 'app.js'));
  await fs.copy(path.resolve('src/index.html'), path.resolve(stagingDir, 'index.html'));

  // 4. 寫入 Shard 與索引
  await fs.ensureDir(path.resolve(stagingDir, 'data/shards'));
  await writeJson(path.resolve(stagingDir, 'data/search-index.json'), searchIndex);
  await writeJson(path.resolve(stagingDir, 'data/report.json'), {
    total: visibleItems.length,
    failed: visibleItems.filter((item) => item.status.includes('failed')).length,
    quarantined: visibleItems.filter((item) => item.quarantine).length
  });
  
  // 5. 寫入 Build Manifest 供前端抓取 Shard 總數
  await writeJson(path.resolve(stagingDir, 'data/build-manifest.json'), { shardCount: shards.length });

  await Promise.all(
    shards.map((items, index) =>
      writeJson(path.resolve(stagingDir, `data/shards/items-${index + 1}.json`), items)
    )
  );

  // 6. 安全切換 (Swap) dist
  const distDir = path.resolve('dist');
  if (await fs.pathExists(distDir)) {
    await fs.remove(distDir);
  }
  await fs.move(stagingDir, distDir);

  await writeJson(path.resolve('output/build/items.all.json'), visibleItems);
  return shards.length;
}