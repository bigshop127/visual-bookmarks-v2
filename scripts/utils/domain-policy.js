import path from 'node:path';
import { readJson } from './io.js';

export async function resolvePolicy(urlString) {
  try {
    const policies = await readJson(path.resolve('rules/domain-policies.json'), []);
    const hostname = new URL(urlString).hostname.replace(/^www\./, '');
    return policies.find((p) => hostname === p.domain || hostname.endsWith(`.${p.domain}`)) || null;
  } catch {
    return null; // 若 URL 不合法，安全回退
  }
}