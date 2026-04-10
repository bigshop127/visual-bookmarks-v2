import { run as runFetch } from './01_fetch.js';
import { run as runValidate } from './02_validate.js';
import { run as runNormalize } from './03_normalize.js';
import { run as runDiff } from './04_diff.js';
import { run as runMetadata } from './05_metadata.js';
import { ensureDir } from '../utils/io.js';
import path from 'node:path';

async function main() {
  console.log('--- Starting Phase 1: Data Pipeline ---');
  await ensureDir(path.resolve('output/reports'));

  try {
    process.stdout.write('[1/5] Fetching bookmarks... ');
    const countFetch = await runFetch();
    console.log(`OK (${countFetch} items)`);

    process.stdout.write('[2/5] Validating schema... ');
    const countValid = await runValidate();
    console.log(`OK (${countValid} valid)`);

    process.stdout.write('[3/5] Normalizing URLs & Dates... ');
    const countNorm = await runNormalize();
    console.log(`OK (${countNorm} normalized)`);

    process.stdout.write('[4/5] Diffing with State... ');
    const countDiff = await runDiff();
    console.log(`OK (${countDiff} needs update)`);

    console.log(`[5/5] Compiling Metadata results...`);
    await runMetadata();

    console.log('✅ Phase 1 Completed Successfully.');
  } catch (error) {
    console.error('\n❌ Phase 1 Pipeline Failed at a critical step:');
    console.error(error);
    process.exit(1);
  }
}

main();