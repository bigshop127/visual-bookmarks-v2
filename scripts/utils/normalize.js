import normalizeUrl from 'normalize-url';
import { sha1 } from './hash.js';

// 解決 Chrome Windows FILETIME (微秒) 轉 ISO 的問題
export function fileTimeToISO(fileTime) {
  if (!fileTime || fileTime === '0') return null;
  const microseconds = BigInt(fileTime);
  const milliseconds = Number(microseconds / 1000n);
  const epochDiff = 11644473600000; // Windows 1601 到 Unix 1970 的毫秒差
  return new Date(milliseconds - epochDiff).toISOString();
}

export function normalizeBookmark(item, ignoreParams = []) {
  const normalizedUrl = normalizeUrl(item.url, {
    forceHttps: false,        // 不強制升級，避免壞掉的站點
    stripWWW: false,          // 保留 www
    removeTrailingSlash: true,// 統一尾斜線
    removeQueryParameters: ignoreParams.map((p) => new RegExp(`^${p}$`, 'i')),
    sortQueryParameters: true
  });

  const cleanTitle = (item.title || '').trim().replace(/\s+/g, ' ');
  const identityHash = sha1(normalizedUrl);
  const contentHash = sha1(JSON.stringify({
    title: cleanTitle,
    url: normalizedUrl,
    folderPath: item.folderPath
  }));

  return {
    ...item,
    cleanTitle,
    normalizedUrl,
    identityHash,
    contentHash
  };
}