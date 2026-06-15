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

// ─── Set North feature ────────────────────────────────────────────────────────

test.describe('Set North — toolbar', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    ({ app, page } = await launchWithScene());
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('Set North button is visible', async () => {
    await expect(page.getByTestId('toolbar-set-north')).toBeVisible();
  });

  test('clicking Set North enters north mode (Confirm/Cancel appear)', async () => {
    await page.getByTestId('toolbar-set-north').click();
    await expect(page.getByTestId('north-confirm')).toBeVisible({ timeout: 2000 });
    await expect(page.getByTestId('north-cancel')).toBeVisible({ timeout: 1000 });
  });

  test('heading display appears in toolbar during north mode', async () => {
    await expect(page.getByTestId('north-heading-display')).toBeVisible();
  });

  test('Cancel exits north mode without saving', async () => {
    await page.getByTestId('north-cancel').click();
    await expect(page.getByTestId('north-confirm')).not.toBeVisible({ timeout: 2000 });
  });

  test('N key toggles north mode on', async () => {
    await page.getByTestId('scene-viewer').click();
    await page.keyboard.press('n');
    await expect(page.getByTestId('north-confirm')).toBeVisible({ timeout: 2000 });
  });

  test('N key toggles north mode off', async () => {
    await page.getByTestId('scene-viewer').click();
    await page.keyboard.press('n');
    await expect(page.getByTestId('north-confirm')).not.toBeVisible({ timeout: 2000 });
  });
});

test.describe('Set North — confirm saves heading', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    ({ app, page } = await launchWithScene());
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('Confirm North saves the heading to the scene', async () => {
    // Enter north mode via keyboard
    await page.getByTestId('scene-viewer').click();
    await page.keyboard.press('n');
    await expect(page.getByTestId('north-confirm')).toBeVisible({ timeout: 2000 });

    // Drag to change heading (simulate a horizontal drag in the viewer)
    const viewer = page.getByTestId('scene-viewer');
    const box = await viewer.boundingBox();
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;

    // Drag 100px to the right to rotate heading
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 100, centerY, { steps: 10 });
    await page.mouse.up();

    // Read the heading display — it should have changed
    const displayText = await page.getByTestId('north-heading-display').textContent();
    const heading = parseFloat(displayText!);
    expect(heading).toBeGreaterThan(0);

    // Confirm
    await page.getByTestId('north-confirm').click();
    await expect(page.getByTestId('north-confirm')).not.toBeVisible({ timeout: 2000 });

    // The heading input in Meta tab should reflect the saved value
    await page.getByTestId('inspector-tab-meta').click();
    const inputValue = await page.getByTestId('heading-input').inputValue();
    expect(parseFloat(inputValue)).toBeGreaterThan(0);
  });
});
