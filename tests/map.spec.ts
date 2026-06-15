import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { FIXTURE_JPEG } from './global-setup';

const MAIN_JS = path.join(__dirname, '../dist-electron/main.js');

// ─── helper: launch with 2 scenes that have GPS coordinates ─────────────────

async function launchWithGeoScenes() {
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
      ipcMain.handle('dialog:openFiles', () => [fp, fp]);
      ipcMain.removeHandler('photos:readMeta');
      ipcMain.handle('photos:readMeta', () => [
        {
          path: fp, width: 64, height: 32, fileSize: 512,
          exif: { gps: { lat: 48.8566, lng: 2.3522 } },
        },
        {
          path: fp, width: 64, height: 32, fileSize: 512,
          exif: { gps: { lat: 48.8570, lng: 2.3530 } },
        },
      ]);
    },
    FIXTURE_JPEG
  );

  await page.getByTestId('import-dropzone').click();
  await expect(page.getByTestId('import-status')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('import-status')).not.toBeVisible({ timeout: 15000 });

  // Navigate to Scenes first, then to Map via sidebar
  await page.getByText('Continue to Scenes').click();
  await expect(page.getByTestId('scenes-screen')).toBeVisible({ timeout: 5000 });

  // Navigate to Map screen via sidebar link
  await page.getByTestId('nav-map').click();
  await expect(page.getByTestId('map-screen')).toBeVisible({ timeout: 5000 });

  return { app, page };
}

// ─── Map screen layout ────────────────────────────────────────────────────────

test.describe('Map screen — layout', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    ({ app, page } = await launchWithGeoScenes());
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('map screen is visible', async () => {
    await expect(page.getByTestId('map-screen')).toBeVisible();
  });

  test('right panel is visible', async () => {
    await expect(page.getByTestId('map-panel')).toBeVisible();
  });

  test('right panel lists 2 scene rows', async () => {
    const rows = page.locator('[data-testid^="map-scene-row-"]');
    await expect(rows).toHaveCount(2, { timeout: 3000 });
  });

  test('auto-compute button is visible', async () => {
    await expect(page.getByTestId('auto-compute-btn')).toBeVisible();
  });

  test('leaflet map container is rendered', async () => {
    await expect(page.getByTestId('leaflet-map')).toBeVisible({ timeout: 5000 });
  });
});

// ─── Auto-compute link hotspots ───────────────────────────────────────────────

test.describe('Map screen — auto-compute', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    ({ app, page } = await launchWithGeoScenes());
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('auto-compute button is enabled when scenes have GPS', async () => {
    const btn = page.getByTestId('auto-compute-btn');
    await expect(btn).toBeEnabled({ timeout: 3000 });
  });

  test('clicking auto-compute shows success feedback', async () => {
    await page.getByTestId('auto-compute-btn').click();
    // Result message appears in the result div (data-testid="auto-result")
    await expect(page.getByTestId('auto-result')).toBeVisible({ timeout: 3000 });
  });

  test('after auto-compute, switching to Scenes shows link hotspots', async () => {
    // Navigate to Scenes
    await page.getByTestId('nav-scenes').click();
    await expect(page.getByTestId('scenes-screen')).toBeVisible({ timeout: 3000 });

    // Switch to hotspot mode to see overlays
    await page.getByTestId('scene-viewer').click();
    await page.keyboard.press('h');

    // At least one link hotspot should exist on the active scene
    const hotspots = page.locator('[data-testid^="hotspot-"]');
    await expect(hotspots).toHaveCount(1, { timeout: 5000 });
  });
});

// ─── GPS coordinate inputs ────────────────────────────────────────────────────

test.describe('Map screen — coordinate inputs', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    ({ app, page } = await launchWithGeoScenes());
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('clicking a scene row in the panel expands it with coordinate inputs', async () => {
    const rows = page.locator('[data-testid^="map-scene-row-"]');
    await rows.first().click();

    // Lat and lng inputs should appear
    const latInputs = page.locator('[data-testid^="lat-input-"]');
    await expect(latInputs).toHaveCount(1, { timeout: 2000 });
  });
});
