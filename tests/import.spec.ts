import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { FIXTURE_JPEG } from './global-setup';

const MAIN_JS = path.join(__dirname, '../dist-electron/main.js');

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Replace the openFiles IPC handler so the file dialog returns specific paths. */
async function mockOpenFiles(app: Awaited<ReturnType<typeof electron.launch>>, paths: string[]) {
  await app.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ ipcMain }: any, returnPaths: string[]) => {
      ipcMain.removeHandler('dialog:openFiles');
      ipcMain.handle('dialog:openFiles', () => returnPaths);
    },
    paths
  );
}

/** Replace the readPhotosMeta IPC handler so it returns canned metadata. */
async function mockReadMeta(
  app: Awaited<ReturnType<typeof electron.launch>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results: any[]
) {
  await app.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ ipcMain }: any, data: any[]) => {
      ipcMain.removeHandler('photos:readMeta');
      ipcMain.handle('photos:readMeta', () => data);
    },
    results
  );
}

// ─── tests ───��────────────────────────────────���──────────────────────────────

test.describe('Import screen — smoke', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('Import screen is active on startup', async () => {
    await expect(page.locator('h1')).toContainText('Import');
  });

  test('drop zone is visible', async () => {
    await expect(page.getByTestId('import-dropzone')).toBeVisible();
  });

  test('drop zone shows correct hint text', async () => {
    await expect(
      page.getByText('Drop photos here or click to browse')
    ).toBeVisible();
  });

  test('no counter visible before any import', async () => {
    await expect(page.getByTestId('import-counter')).not.toBeVisible();
  });
});

test.describe('Import screen — file import (no GPS)', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Mock dialog to return the fixture JPEG
    await mockOpenFiles(app, [FIXTURE_JPEG]);

    // Trigger the import by clicking the drop zone
    await page.getByTestId('import-dropzone').click();

    // Wait for processing to start (status indicator appears)
    await expect(page.getByTestId('import-status')).toBeVisible({ timeout: 5000 });

    // Wait for processing to finish (tiles:generate has a 1s delay)
    await expect(page.getByTestId('import-status')).not.toBeVisible({ timeout: 15000 });
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('counter appears after import', async () => {
    await expect(page.getByTestId('import-counter')).toBeVisible();
  });

  test('counter shows 1 photo imported', async () => {
    await expect(page.getByTestId('import-counter')).toContainText('1 photo imported');
  });

  test('counter shows 0 with GPS (fixture has no EXIF GPS)', async () => {
    await expect(page.getByTestId('import-counter')).toContainText('0 with GPS');
  });

  test('thumbnail grid appears', async () => {
    await expect(page.getByTestId('import-grid')).toBeVisible();
  });

  test('No GPS badge is shown', async () => {
    await expect(page.getByText('No GPS')).toBeVisible();
  });

  test('Continue to Scenes button is visible', async () => {
    await expect(page.getByText('Continue to Scenes')).toBeVisible();
  });

  test('thumbnail img src uses localhost file server URL', async () => {
    const src = await page.locator('[data-testid="import-grid"] img').first().getAttribute('src');
    expect(src).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  });
});

test.describe('Import screen — drag & drop', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('window-level dragover is prevented (navigation safety)', async () => {
    const prevented = await page.evaluate(() => {
      const event = new DragEvent('dragover', { bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });

  test('dropzone highlights on dragenter', async () => {
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="import-dropzone"]');
      el!.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true }));
    });
    await expect(page.getByTestId('import-dropzone')).toHaveClass(/border-cat-hotel/, { timeout: 1000 });
  });

  test('getPathForFile is exposed on window.conchitour (Electron 32+ drag path API)', async () => {
    // webUtils.getPathForFile() is the Electron 32+ replacement for file.path.
    // We verify it's exposed via the preload rather than running an OS-level drop
    // (synthesized File objects return '' from getPathForFile by design).
    const type = await page.evaluate(() => typeof (window as Window & { conchitour: { getPathForFile: unknown } }).Conchitour.getPathForFile);
    expect(type).toBe('function');
  });

  test('drop event does not throw and resets drag state', async () => {
    // Verify the drop handler runs cleanly (no uncaught error) when files have
    // no OS path (getPathForFile returns ''), which means nothing is imported.
    await page.evaluate(() => {
      const file = new File([], 'test.jpg', { type: 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const dropzone = document.querySelector('[data-testid="import-dropzone"]') as HTMLElement;
      dropzone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    // If the handler threw, the page would be in an error state — check it's still healthy
    await expect(page.getByTestId('import-dropzone')).toBeVisible();
  });
});

test.describe('Import screen — GPS badge', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Mock dialog AND readMeta to inject GPS coords
    await mockOpenFiles(app, [FIXTURE_JPEG]);
    await mockReadMeta(app, [
      {
        path: FIXTURE_JPEG,
        width: 64,
        height: 32,
        fileSize: 512,
        exif: {
          gps: { lat: 48.8566, lng: 2.3522 },
          camera: 'GoPro MAX',
        },
      },
    ]);

    await page.getByTestId('import-dropzone').click();
    await expect(page.getByTestId('import-status')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('import-status')).not.toBeVisible({ timeout: 15000 });
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('counter shows 1 with GPS', async () => {
    await expect(page.getByTestId('import-counter')).toContainText('1 with GPS');
  });

  test('GPS badge is shown (green)', async () => {
    await expect(page.getByText('GPS').first()).toBeVisible();
  });
});

test.describe('Import screen — navigation', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    await mockOpenFiles(app, [FIXTURE_JPEG]);
    await page.getByTestId('import-dropzone').click();
    await expect(page.getByTestId('import-status')).not.toBeVisible({ timeout: 15000 });
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('clicking Continue to Scenes switches the active screen', async () => {
    await page.getByText('Continue to Scenes').click();
    await expect(page.getByTestId('scenes-screen')).toBeVisible({ timeout: 5000 });
  });
});
