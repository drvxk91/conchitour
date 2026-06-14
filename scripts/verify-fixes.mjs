import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SHOTS = 'C:/Users/matth/AppData/Local/Temp/conchitect-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const MAIN_JS = path.join(ROOT, 'dist-electron/main.js');
const FIXTURE = path.join(ROOT, 'tests/fixtures/test.jpg');

const app = await electron.launch({
  args: [MAIN_JS],
  env: { ...process.env, NODE_ENV: 'production' },
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(800);

// 01 — import screen (empty)
await page.screenshot({ path: `${SHOTS}/01-import-empty.png` });
console.log('shot 01 done');

// Mock IPC so we control the photo path
await app.evaluate(
  ({ ipcMain }, fp) => {
    ipcMain.removeHandler('dialog:openFiles');
    ipcMain.handle('dialog:openFiles', () => [fp]);
    ipcMain.removeHandler('photos:readMeta');
    ipcMain.handle('photos:readMeta', () => [
      { path: fp, width: 64, height: 32, fileSize: 512, exif: {} },
    ]);
  },
  FIXTURE
);

// Import via click (file dialog is mocked)
await page.getByTestId('import-dropzone').click();
await page.waitForSelector('[data-testid="import-status"]', { timeout: 5000 });
await page.waitForSelector('[data-testid="import-status"]', { state: 'hidden', timeout: 15000 });
await page.waitForTimeout(500);

// 02 — import with thumbnail
await page.screenshot({ path: `${SHOTS}/02-import-thumbnails.png` });
const src = await page.locator('[data-testid="import-grid"] img').first().getAttribute('src');
console.log('thumbnail src:', src);
console.log('local:/// protocol OK:', src?.startsWith('local:///'));

// Navigate to Scenes
await page.getByText('Continue to Scenes').click();
await page.waitForTimeout(800);

// 03 — scenes screen (scene image visible?)
await page.screenshot({ path: `${SHOTS}/03-scenes.png` });
console.log('shot 03 done');

// Create a hotspot: H key + double-click
await page.getByTestId('scene-viewer').click();
await page.keyboard.press('h');
const box = await page.getByTestId('scene-viewer').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.dblclick(cx, cy);
await page.waitForTimeout(400);

// 04 — hotspot just created
await page.screenshot({ path: `${SHOTS}/04-hotspot-created.png` });
console.log('shot 04 done');

// Drag the hotspot 120px right, 60px up
const hs = await page.locator('[data-testid^="hotspot-"]').first().boundingBox();
const hx = hs.x + hs.width / 2;
const hy = hs.y + hs.height / 2;
await page.mouse.move(hx, hy);
await page.mouse.down();
await page.mouse.move(hx + 120, hy - 60, { steps: 12 });

// 05 — mid-drag (cursor should be grabbing)
await page.screenshot({ path: `${SHOTS}/05-hotspot-dragging.png` });
await page.mouse.up();
await page.waitForTimeout(300);

// 06 — after drag
await page.screenshot({ path: `${SHOTS}/06-hotspot-after-drag.png` });
console.log('shot 06 done');

// Verify position changed
const hsAfter = await page.locator('[data-testid^="hotspot-"]').first().boundingBox();
const moved = Math.abs((hsAfter.x + hsAfter.width / 2) - hx) > 10;
console.log('hotspot moved:', moved, `(${Math.round(hx)} → ${Math.round(hsAfter.x + hsAfter.width / 2)})`);

await app.close();
console.log('\nAll screenshots written to:', SHOTS);
