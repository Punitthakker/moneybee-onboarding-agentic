// npm run dev: starts infra in Docker, then the API (watch) and the web app (Vite) on the host.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.env')) spawnSync(process.execPath, ['scripts/setup.mjs'], { stdio: 'inherit' });
console.log('Starting mongo and redis in Docker...');
const up = spawnSync('docker', ['compose', 'up', '-d', '--wait', 'mongo', 'redis'], { stdio: 'inherit' });
if (up.status !== 0) {
  console.error('docker compose failed. Is Docker running?');
  process.exit(1);
}
const procs = [
  spawn('npm', ['run', 'dev', '-w', '@moneybee/api'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn('npm', ['run', 'dev', '-w', '@moneybee/web'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => procs.forEach((p) => p.kill('SIGINT'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log('\nUI: http://localhost:5173   API: http://localhost:4000\n');
