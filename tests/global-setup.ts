import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
export const FIXTURE_JPEG = path.join(FIXTURE_DIR, 'test.jpg');

export default async function globalSetup() {
  // Generate fixture JPEG using sharp — produces a real 100×50 JPEG that
  // Chromium can decode, unlike hand-crafted minimal base64 data.
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
  await sharp({
    create: { width: 100, height: 50, channels: 3, background: { r: 64, g: 128, b: 192 } },
  })
    .jpeg({ quality: 80 })
    .toFile(FIXTURE_JPEG);

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
