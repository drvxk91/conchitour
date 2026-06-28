import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SHOTS = 'C:/Users/matth/AppData/Local/Temp/conchitour-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const MAIN_JS = path.join(ROOT, 'dist-electron/main.js');
const FIXTURE = path.join(ROOT, 'tests/fixtures/test.jpg');

const electronApp = await electron.launch({
  args: [MAIN_JS],
  env: { ...process.env, NODE_ENV: 'production' },
});
const page = await electronApp.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(800);

// Get port and build URL
const port = await page.evaluate(() => window.conchitour?.getFileServerPort?.());
console.log('File server port:', port);

const encoded = FIXTURE.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
const fileUrl = `http://127.0.0.1:${port}/${encoded}`;
console.log('Testing file URL:', fileUrl);

// Test 1: fetch() from renderer
const fetchResult = await page.evaluate(async (url) => {
  try {
    const resp = await fetch(url);
    return { ok: resp.ok, status: resp.status, size: (await resp.arrayBuffer()).byteLength };
  } catch (e) {
    return { error: String(e) };
  }
}, fileUrl);
console.log('fetch() result:', fetchResult);

// Test 2: Playwright intercepts the img request (tells us if the request even leaves the renderer)
const responsePromise = page.waitForResponse(
  (resp) => resp.url().includes('127.0.0.1') && resp.url().includes('test.jpg'),
  { timeout: 4000 }
).catch(() => null);

const imgResult = await page.evaluate(async (url) => {
  return new Promise((resolve) => {
    const img = document.createElement('img');
    img.onload = () => resolve({ result: 'loaded', w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ result: 'error' });
    img.src = url;
    document.body.appendChild(img);
    setTimeout(() => resolve({ result: 'timeout' }), 5000);
  });
}, fileUrl);

const intercepted = await responsePromise;
console.log('<img> element result:', imgResult);
console.log('Playwright intercepted response:', intercepted ? `status=${intercepted.status()} url=${intercepted.url()}` : 'NOT INTERCEPTED (request never left renderer)');

// 01 — import screen (empty)
await page.screenshot({ path: `${SHOTS}/01-import-empty.png` });
console.log('shot 01 done');

// Mock IPC
await electronApp.evaluate(
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

await page.getByTestId('import-dropzone').click();
await page.waitForSelector('[data-testid="import-status"]', { timeout: 5000 });
await page.waitForSelector('[data-testid="import-status"]', { state: 'hidden', timeout: 15000 });
await page.waitForTimeout(500);

// 02 — import with thumbnail
await page.screenshot({ path: `${SHOTS}/02-import-thumbnails.png` });
const src = await page.locator('[data-testid="import-grid"] img').first().getAttribute('src');
console.log('thumbnail src:', src);

// Check if the thumbnail img actually loaded (naturalWidth > 0)
const thumbLoaded = await page.evaluate(() => {
  const img = document.querySelector('[data-testid="import-grid"] img');
  return img ? { complete: img.complete, naturalWidth: img.naturalWidth } : null;
});
console.log('thumbnail load state:', thumbLoaded);
console.log('shot 02 done');

// Navigate to Scenes
await page.getByText('Continue to Scenes').click();
await page.waitForTimeout(800);

// 03 — scenes screen
await page.screenshot({ path: `${SHOTS}/03-scenes.png` });
const viewerImgSrc = await page.locator('[data-testid="scene-viewer"] img').first().getAttribute('src');
const viewerImgState = await page.evaluate(() => {
  const img = document.querySelector('[data-testid="scene-viewer"] img');
  return img ? { complete: img.complete, naturalWidth: img.naturalWidth, visible: img.style.display !== 'none' } : null;
});
console.log('scene viewer img src:', viewerImgSrc);
console.log('scene viewer img state:', viewerImgState);
console.log('shot 03 done');

await electronApp.close();
console.log('\nAll screenshots written to:', SHOTS);
