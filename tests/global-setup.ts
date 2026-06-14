import { execSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
export const FIXTURE_JPEG = path.join(FIXTURE_DIR, 'test.jpg');

// Minimal valid 1×1 JPEG (blue pixel) — no EXIF/GPS data.
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoH7gULCwsLCwsLCwsL' +
  'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwv/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQU' +
  'FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFgAB' +
  'AQEAAAAAAAAAAAAAAAAABgUEB//EAB8QAAIBBAMBAAAAAAAAAAAAAAABAgMEBREhMf/EABYBAQEBAAAAAAAAAA' +
  'AAAAAAAAAIDAf/EABcRAQEBAQAAAAAAAAAAAAAAAAABERL/2gAMAwEAAhEDEQA/ALFxzBtcPlptHoHYeNTWcn' +
  'uvJAAAB//Z';

export default async function globalSetup() {
  // Create fixture JPEG
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(FIXTURE_JPEG, Buffer.from(TINY_JPEG_B64, 'base64'));

  // Always rebuild to ensure the dist reflects the latest source
  console.log('\n[E2E] Building app for production…');
  execSync('npx vite build', {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 180_000,
    env: { ...process.env, NODE_ENV: 'production' },
  });
  console.log('[E2E] Build done.\n');
}
