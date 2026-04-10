import path from 'node:path';
import { loadConfig } from '../utils/config.js';
import { readJson, writeJson } from '../utils/io.js';

export async function run() {
  const config = await loadConfig();
  const source = await readJson(path.resolve(config.env.bookmarksInput));

  // 1. 確認是否為擴充套件匯出的陣列格式
  if (!Array.isArray(source)) {
    throw new Error("書籤格式不符：請確保檔案為 JSON Array 格式。");
  }

  // 2. 尋找目標資料夾 (沒有 url 且 title 符合 ROOT_FOLDER_NAME)
  const targetFolder = source.find(item => item.title === config.env.rootFolderName && !item.url);

  if (!targetFolder) {
    throw new Error(`找不到資料夾："${config.env.rootFolderName}"。請打開 JSON 檔案確認精確名稱（包含大小寫與空白）。`);
  }

  // 3. 遞迴找出該資料夾下所有的子資料夾 ID
  const validFolderIds = new Set([String(targetFolder.id)]);
  let added;
  do {
    added = false;
    for (const item of source) {
      if (!item.url && validFolderIds.has(String(item.parentId)) && !validFolderIds.has(String(item.id))) {
        validFolderIds.add(String(item.id));
        added = true;
      }
    }
  } while (added);

  // 4. 收集所有屬於這些資料夾的書籤
  const items = source
    .filter(item => item.url && validFolderIds.has(String(item.parentId)))
    .map(item => ({
      id: String(item.id),
      title: item.title || '',
      url: item.url,
      folderPath: [config.env.rootFolderName],
      // 擴充套件已經轉好時間了，優先拿 UTC
      dateAdded: String(item.dateAddedUTC || item.dateAddedLocal || '')
    }));

  await writeJson(path.resolve('output/raw/bookmarks.raw.json'), { count: items.length, items });
  return items.length;
}