import { run as runScreenshot } from './06_screenshot.js';
import { ensureDir } from '../utils/io.js';
import path from 'node:path';

async function main() {
  console.log('--- Starting Phase 2: Screenshot Engine ---');
  await ensureDir(path.resolve('output/reports'));
  await ensureDir(path.resolve('dist/assets/screenshots'));

  try {
    process.stdout.write('[1/1] Processing Screenshots & OG Images... \n');
    const stats = await runScreenshot();
    
    console.log(`\n      Targeted: ${stats.total} items`);
    console.log(`      Success : ${stats.success} items (OG + Screenshots)`);
    console.log(`      Failed  : ${stats.total - stats.success} items`);

    console.log('\n✅ Phase 2 Completed Successfully.');
  } catch (error) {
    console.error('\n❌ Phase 2 Engine Failed:');
    console.error(error);
    process.exit(1);
  }
}

main();