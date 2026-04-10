import 'dotenv/config';
import path from 'node:path';
import { readJson } from './io.js';

export async function loadConfig() {
  // 嚴格讀取，若缺少設定檔會直接 throw Error
  const appConfig = await readJson(path.resolve('config/app.config.json'));
  const pipelineConfig = await readJson(path.resolve('config/pipeline.config.json'));

  return {
    app: appConfig,
    pipeline: pipelineConfig,
    env: {
      bookmarksInput: process.env.BOOKMARKS_INPUT || './input/bookmarks/chrome-bookmarks.json',
      rootFolderName: process.env.ROOT_FOLDER_NAME || 'VisualBookmarks'
    }
  };
}