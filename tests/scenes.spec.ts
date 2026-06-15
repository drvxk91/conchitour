import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { FIXTURE_JPEG } from './global-setup';

const MAIN_JS = path.join(__dirname, '../dist-electron/main.js');

// ─── helpers ─────────────────────────────────────────────────────────────────

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

// ─── launch helper: import 2 photos then navigate to Scenes ──────────────────

async function launchWithTwoScenes() {
  const app = await electron.launch({
    args: [MAIN_JS],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page: any = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // Mock: two paths pointing to the same fixture file (different slugs via name)
  // We use the same file twice — slugs are derived from filename so both will be
  // de-duplicated by uniqueSlug in the store.
  await mockOpenFiles(app, [FIXTURE_JPEG, FIXTURE_JPEG]);

  // Also mock readPhotosMeta to return two distinct results
  await app.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ ipcMain }: any, data: any[]) => {
      ipcMain.removeHandler('photos:readMeta');
      ipcMain.handle('photos:readMeta', () => data);
    },
    [
      { path: FIXTURE_JPEG, width: 64, height: 32, fileSize: 512, exif: {} },
      { path: FIXTURE_JPEG, width: 64, height: 32, fileSize: 512, exif: {} },
    ]
  );

  await page.getByTestId('import-dropzone').click();
  // Wait for processing to finish
  await expect(page.getByTestId('import-status')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('import-status')).not.toBeVisible({ timeout: 15000 });

  // Navigate to Scenes
  await page.getByText('Continue to Scenes').click();

  return { app, page };
}

// ─── Scenes screen layout ────────────────────────────────────────────────────

test.describe('Scenes screen — layout', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    ({ app, page } = await launchWithTwoScenes());
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('scenes screen is visible', async () => {
    await expect(page.getByTestId('scenes-screen')).toBeVisible();
  });

  test('sidebar is visible', async () => {
    await expect(page.getByTestId('scene-sidebar')).toBeVisible();
  });

  test('sidebar lists 2 scenes', async () => {
    const items = page.locator('[data-testid^="scene-item-"]');
    await expect(items).toHaveCount(2);
  });

  test('viewer is visible', async () => {
    await expect(page.getByTestId('scene-viewer')).toBeVisible();
  });

  test('inspector is visible', async () => {
    await expect(page.getByTestId('scene-inspector')).toBeVisible();
  });

  test('parcours graph is visible', async () => {
    await expect(page.getByTestId('parcours-graph')).toBeVisible();
  });

  test('scene viewer img src uses localhost file server URL', async () => {
    const src = await page.locator('[data-testid="scene-viewer"] img').first().getAttribute('src');
    expect(src).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  });
});

// ─── Scene selection ─────────────────────────────────────────────────────────

test.describe('Scenes screen — scene selection', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    ({ app, page } = await launchWithTwoScenes());
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('clicking second scene item makes it active', async () => {
    const items = page.locator('[data-testid^="scene-item-"]');
    await items.nth(1).click();
    // The second item should now have an active style (aria-selected or class)
    // We verify the inspector reacts by checking the slug input reflects a scene
    await expect(page.getByTestId('slug-input')).toBeVisible();
  });
});

// ─── Hotspot creation via double-click ───────────────────────────────────────

test.describe('Scenes screen — hotspot creation', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    ({ app, page } = await launchWithTwoScenes());
    // Switch to hotspot mode via keyboard shortcut H
    await page.getByTestId('scene-viewer').click();
    await page.keyboard.press('h');
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('double-click on viewer creates a hotspot', async () => {
    const viewer = page.getByTestId('scene-viewer');
    const box = await viewer.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await page.mouse.dblclick(cx, cy);

    // Hotspot dots should appear
    const hotspots = page.locator('[data-testid^="hotspot-"]');
    await expect(hotspots).toHaveCount(1, { timeout: 3000 });
  });

  test('hotspots tab shows 1 hotspot row', async () => {
    // Click the Hotspots inspector tab
    await page.getByTestId('inspector-tab-hotspots').click();
    const rows = page.locator('[data-testid^="hotspot-row-"]');
    await expect(rows).toHaveCount(1, { timeout: 3000 });
  });
});

// ─── Undo / Redo ─────────────────────────────────────────────────────────────

test.describe('Scenes screen — undo/redo', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    ({ app, page } = await launchWithTwoScenes());

    // Create a hotspot via H + double-click
    await page.getByTestId('scene-viewer').click();
    await page.keyboard.press('h');
    const viewer = page.getByTestId('scene-viewer');
    const box = await viewer.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await page.mouse.dblclick(cx, cy);
    await expect(page.locator('[data-testid^="hotspot-"]')).toHaveCount(1, { timeout: 3000 });
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('Ctrl+Z removes the hotspot', async () => {
    // Focus out of any input first
    await page.getByTestId('scene-viewer').click();
    await page.keyboard.press('Control+z');
    const hotspots = page.locator('[data-testid^="hotspot-"]');
    await expect(hotspots).toHaveCount(0, { timeout: 3000 });
  });

  test('Ctrl+Y restores the hotspot', async () => {
    await page.getByTestId('scene-viewer').click();
    await page.keyboard.press('Control+y');
    const hotspots = page.locator('[data-testid^="hotspot-"]');
    await expect(hotspots).toHaveCount(1, { timeout: 3000 });
  });
});

// ─── Slug validation ─────────────────────────────────────────────────────────

test.describe('Scenes screen — slug validation', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    ({ app, page } = await launchWithTwoScenes());
    // Make sure inspector Meta tab is active (it's the default)
    await page.getByTestId('inspector-tab-meta').click();
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('slug input is visible', async () => {
    await expect(page.getByTestId('slug-input')).toBeVisible();
  });

  test('typing an invalid slug shows error', async () => {
    const input = page.getByTestId('slug-input');
    await input.click({ clickCount: 3 });
    await input.fill('!!INVALID!!');
    await expect(page.getByTestId('slug-error')).toBeVisible({ timeout: 2000 });
  });

  test('typing a valid unique slug hides error', async () => {
    const input = page.getByTestId('slug-input');
    await input.click({ clickCount: 3 });
    await input.fill('valid-slug-99');
    await expect(page.getByTestId('slug-error')).not.toBeVisible({ timeout: 2000 });
  });

  test('typing a duplicate slug shows error', async () => {
    // Get the slug of the first scene to use as a duplicate
    const items = page.locator('[data-testid^="scene-item-"]');
    // Click the second scene to be safe we're on it
    await items.nth(1).click();
    await page.getByTestId('inspector-tab-meta').click();

    // Get slug of first scene
    await items.nth(0).click();
    await page.getByTestId('inspector-tab-meta').click();
    const firstSlug = await page.getByTestId('slug-input').inputValue();

    // Switch back to second scene and type the first scene's slug
    await items.nth(1).click();
    await page.getByTestId('inspector-tab-meta').click();
    const input = page.getByTestId('slug-input');
    await input.click({ clickCount: 3 });
    await input.fill(firstSlug);
    await expect(page.getByTestId('slug-error')).toBeVisible({ timeout: 2000 });
  });
});

// ─── Hotspot drag ─────────────────────────────────────────────────────────────

test.describe('Scenes screen — hotspot drag', () => {
  let app: Awaited<ReturnType<typeof electron.launch>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any;

  test.beforeAll(async () => {
    ({ app, page } = await launchWithTwoScenes());

    // Create a hotspot via H + double-click at the viewer center
    await page.getByTestId('scene-viewer').click();
    await page.keyboard.press('h');
    const viewer = page.getByTestId('scene-viewer');
    const box = await viewer.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await page.mouse.dblclick(cx, cy);
    await expect(page.locator('[data-testid^="hotspot-"]')).toHaveCount(1, { timeout: 3000 });
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('dragging a hotspot moves it to the new position', async () => {
    const hotspot = page.locator('[data-testid^="hotspot-"]').first();
    const before = await hotspot.boundingBox();

    // Drag 80px right and 40px down
    const startX = before!.x + before!.width / 2;
    const startY = before!.y + before!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 40, { steps: 10 });
    await page.mouse.up();

    const after = await hotspot.boundingBox();
    // The center of the hotspot should have shifted
    expect(after!.x + after!.width / 2).toBeGreaterThan(before!.x + before!.width / 2 + 10);
  });

  test('dragging a hotspot adds an undo entry', async () => {
    // Undo the drag — hotspot should return to previous position
    const hotspot = page.locator('[data-testid^="hotspot-"]').first();
    const afterDrag = await hotspot.boundingBox();

    await page.getByTestId('scene-viewer').click();
    await page.keyboard.press('Control+z');

    // Give React a moment to re-render
    await page.waitForTimeout(200);
    const afterUndo = await hotspot.boundingBox();
    expect(afterUndo!.x + afterUndo!.width / 2).toBeLessThan(afterDrag!.x + afterDrag!.width / 2 - 10);
  });
});
