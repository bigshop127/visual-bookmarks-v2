import path from 'node:path';
import { readJson } from './io.js';

export async function applyOverrides(items) {
  const overrides = await readJson(path.resolve('rules/manual-overrides.json'), []);

  return items.map((item) => {
    const matched = overrides.find((rule) => {
      if (rule.match?.id) return String(rule.match.id) === String(item.id);
      if (rule.match?.domain) return item.domain === rule.match.domain;
      if (rule.match?.url) return item.finalUrl === rule.match.url || item.normalizedUrl === rule.match.url;
      // 支援用 folderPath 覆寫
      if (rule.match?.folderPath) return item.folderPath.join('/') === rule.match.folderPath;
      return false;
    });

    return matched ? { ...item, ...matched, manualOverride: true } : item;
  });
}