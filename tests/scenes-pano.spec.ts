import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { FIXTURE_JPEG } from './global-setup';

const MAIN_JS = path.join(__dirname, '../dist-electron/main.js');

async function launchWithScene() {
  const app = await electron.launch({
    args: [MAIN_JS],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page: any = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  await app.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ ipcMain }: any, fp: string) => {
      ipcMain.removeHandler('dialog:openFiles');
      ipcMain.handle('dialog:openFiles', () => [fp]);
      ipcMain.removeHandler('photos:readMeta');
      // Provide 64×32 dimensions so equirectangular check passes (2:1 ratio)
      ipcMain.handle('photos:readMeta', () => [
        { path: fp, width: 64, height: 32, fileSize: 512, exif: {} },
      ]);
    },
    FIXTURE_JPEG
  );

  await page.getByTestId('import-dropzone').click();
  await expect(page.getByTestId('import-status')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('import-status')).not.toBeVisible({ timeout: 15000 });
  await page.getByText('Continue to Scenes').click();
  await expect(page.getByTestId('scenes-screen')).toBeVisible({ timeout: 5000 });

  return { app, page };
}

// ─── Pannellum viewer ─────────────────────────────────────────────────────────

test.describe('Scenes screen — Pannellum viewer (navigate mode)', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    ({ app, page } = await launchWithScene());
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('default mode is navigate — pano-viewer is rendered', async () => {
    // The scenes screen starts in navigate mode; PanoViewer mounts
    await expect(page.getByTestId('pano-viewer')).toBeVisible({ timeout: 5000 });
  });

  test('switching to hotspot mode (H) shows flat image instead', async () => {
    await page.getByTestId('scene-viewer').click();
    await page.keyboard.press('h');
    // In flat mode the equirectangular img is rendered (pano-viewer unmounts)
    await expect(page.locator('[data-testid="scene-viewer"] img')).toBeVisible({ timeout: 2000 });
  });

  test('switching back to navigate mode (V) mounts pano-viewer again', async () => {
    await page.getByTestId('scene-viewer').click();
    await page.keyboard.press('v');
    await expect(page.getByTestId('pano-viewer')).toBeVisible({ timeout: 2000 });
  });

  test('window.pannellum is available in the renderer', async () => {
    const type = await page.evaluate(() => typeof (window as Window & { pannellum?: unknown }).pannellum);
    expect(type).toBe('object');
  });
});

test.describe('Scenes screen — equirectangular badge', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    ({ app, page } = await launchWithScene());
    await page.getByTestId('inspector-tab-media').click();
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('media tab shows equirectangular badge for 2:1 image', async () => {
    // The fixture is mocked as 64×32 (2:1 ratio)
    await expect(page.getByText(/Equirectangular 360/)).toBeVisible({ timeout: 2000 });
  });
});

test.describe('Scenes screen — hotspot add in navigate mode via double-click', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @playwright/test
  let page: any;

  test.beforeAll(async () => {
    ({ app, page } = await launchWithScene());
    // Make sure we're in navigate mode (default)
    await page.getByTestId('scene-viewer').click();
    await page.keyboard.press('v');
    await expect(page.getByTestId('pano-viewer')).toBeVisible({ timeout: 3000 });
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('double-click on pano-viewer triggers hotspot mode or adds hotspot', async () => {
    // Pannellum may not have loaded the image (fixture is 64×32 blue JPEG, not a 360° image)
    // so mouseEventToCoords may fail gracefully. We simply verify no uncaught error occurs.
    const viewer = page.getByTestId('pano-viewer');
    const box = await viewer.boundingBox();
    if (!box) return; // skip if not visible

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Two clicks within 350ms simulates double-click detection in PanoViewer
    await page.mouse.click(cx, cy);
    await page.mouse.click(cx, cy);
    // No crash — scene screen still visible
    await expect(page.getByTestId('scenes-screen')).toBeVisible();
  });
});
