import { spawn } from 'node:child_process';

async function main() {
  const port = 3000;
  console.log(`\n🚀 Starting local preview server...`);
  console.log(`👉 Open http://localhost:${port} in your browser`);
  
  spawn('npx', ['serve', 'dist', '-p', String(port)], {
    stdio: 'inherit',
    shell: true
  });
}

main();