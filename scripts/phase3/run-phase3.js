import { run as runBuild } from './07_build.js';

async function main() {
  console.log('--- Starting Phase 3: SPA Build ---');
  try {
    process.stdout.write('[1/1] Building JSON Shards & Frontend Assets... ');
    const shardCount = await runBuild();
    console.log(`OK (${shardCount} shards generated)`);
    console.log('✅ Phase 3 Completed Successfully.');
  } catch (error) {
    console.error('\n❌ Phase 3 Build Failed:');
    console.error(error);
    process.exit(1);
  }
}

main();