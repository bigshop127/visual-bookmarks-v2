import path from 'node:path';
import fs from 'fs-extra';
import { loadConfig } from '../utils/config.js';
import { readJson, writeJson } from '../utils/io.js';
import { validateAgainstSchema } from '../utils/schema.js';

async function main() {
  console.log('--- Starting Phase 0: Contract & Environment Validation ---');

  // 1. 驗證 Config 存在與正確性
  console.log('[1/4] Loading configurations...');
  const config = await loadConfig();

  // 2. 驗證 Source 來源檔案是否存在 (防禦 Actions 空跑)
  console.log('[2/4] Checking bookmark input source...');
  const sourcePath = path.resolve(config.env.bookmarksInput);
  if (!(await fs.pathExists(sourcePath))) {
    throw new Error(`Critical: Bookmark source file not found at ${sourcePath}. Please ensure the file is placed correctly.`);
  }

  // 3. 驗證 Rules 檔案是否存在
  console.log('[3/4] Validating rule files presence...');
  await readJson(path.resolve('rules/domain-policies.json'));
  // (可依序擴充 overrides 等驗證)

  // 4. 驗證 State Manifest Schema
  console.log('[4/4] Validating state manifest schema...');
  const manifestPath = path.resolve('state/manifest.json');
  const manifest = await readJson(manifestPath, { version: '1.0.0', items: {} });
  
  const manifestValidation = await validateAgainstSchema(
    path.resolve('schemas/state.schema.json'),
    manifest
  );

  if (!manifestValidation.valid) {
    throw new Error(`State manifest validation failed: ${JSON.stringify(manifestValidation.errors, null, 2)}`);
  }

  // 建立報告
  await writeJson(path.resolve('output/reports/phase0-report.json'), {
    status: 'success',
    timestamp: new Date().toISOString(),
    validatedSource: sourcePath
  });

  console.log('✅ Phase 0 Completed Successfully. System is ready for Phase 1.');
}

main().catch((error) => {
  console.error('\n❌ Phase 0 Failed:');
  console.error(error.message);
  process.exit(1);
});