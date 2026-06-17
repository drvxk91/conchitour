import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';
import os from 'node:os';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';

const isDev = process.env.NODE_ENV === 'development';

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#fafaf9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  if (isDev) {
    await win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    await win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

let fileServerPort = 0;

app.whenReady().then(async () => {
  // A plain localhost HTTP server is the most reliable way to load local photos
  // into <img> elements in Electron. Custom protocol.handle() works for fetch()
  // but has subresource-loading quirks in Electron 33 that break <img> src.
  const fileServer = http.createServer(async (req, res) => {
    try {
      const filePath = decodeURIComponent(req.url!.slice(1));
      const ext = path.extname(filePath).toLowerCase();
      if (!['.jpg', '.jpeg', '.png'].includes(ext)) {
        res.writeHead(403).end();
        return;
      }
      const data = await fs.readFile(filePath);
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      res.writeHead(200, {
        'Content-Type': mime,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'private, max-age=3600',
      });
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });

  await new Promise<void>((resolve) => {
    fileServer.listen(0, '127.0.0.1', () => {
      fileServerPort = (fileServer.address() as { port: number }).port;
      resolve();
    });
  });

  setupAppMenu();
  await createWindow();
});

// Synchronous IPC so the renderer can get the port before rendering any image.
ipcMain.on('file-server:port', (event) => {
  event.returnValue = fileServerPort;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ------ IPC handlers ------

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Equirectangular images', extensions: ['jpg', 'jpeg', 'png'] }],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('project:load', async (_e, projectPath: string) => {
  const raw = await fs.readFile(projectPath, 'utf-8');
  return JSON.parse(raw);
});

ipcMain.handle('photos:readMeta', async (_e, filePaths: string[]) => {
  // Dynamic import handles ESM-only builds of exifr
  const mod = await import('exifr');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parse = ((mod.default?.parse ?? (mod as any).parse) as unknown as (src: string, opts: unknown) => Promise<Record<string, any> | null>).bind(mod.default ?? mod);

  const results: Array<{
    path: string;
    width: number;
    height: number;
    fileSize: number;
    exif?: {
      dateTime?: string;
      camera?: string;
      direction?: number;
      gps?: { lat: number; lng: number; altitude?: number };
    };
  }> = [];

  for (const filePath of filePaths) {
    try {
      const stats = await fs.stat(filePath);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: Record<string, any> | null = await parse(filePath, {
        tiff: true,
        exif: true,
        gps: true,
      }).catch(() => null);

      const exif: {
        dateTime?: string;
        camera?: string;
        direction?: number;
        gps?: { lat: number; lng: number; altitude?: number };
      } = {};

      if (raw?.DateTimeOriginal instanceof Date) {
        exif.dateTime = raw.DateTimeOriginal.toISOString();
      } else if (typeof raw?.DateTimeOriginal === 'string') {
        exif.dateTime = raw.DateTimeOriginal;
      }

      const make = typeof raw?.Make === 'string' ? raw.Make.trim() : '';
      const model = typeof raw?.Model === 'string' ? raw.Model.trim() : '';
      const camera = [make, model].filter(Boolean).join(' ');
      if (camera) exif.camera = camera;

      // GPSImgDirection (standard EXIF) or Insta360 XMP heading tags
      const dir = raw?.GPSImgDirection ?? raw?.Heading ?? raw?.['Insta360.Heading'] ?? raw?.Yaw;
      if (dir != null) {
        exif.direction = Number(dir);
      }

      if (raw?.latitude != null && raw?.longitude != null) {
        exif.gps = { lat: Number(raw.latitude), lng: Number(raw.longitude) };
        if (raw?.altitude != null) exif.gps.altitude = Number(raw.altitude);
      }

      results.push({
        path: filePath,
        width: Number(raw?.PixelXDimension ?? raw?.ExifImageWidth ?? 0),
        height: Number(raw?.PixelYDimension ?? raw?.ExifImageHeight ?? 0),
        fileSize: stats.size,
        exif: Object.keys(exif).length > 0 ? exif : undefined,
      });
    } catch {
      results.push({ path: filePath, width: 0, height: 0, fileSize: 0 });
    }
  }

  return results;
});

ipcMain.handle('photos:copyToProject', async (_e, filePaths: string[], destDir: string) => {
  await fs.mkdir(path.join(destDir, 'media'), { recursive: true });
  const results: string[] = [];
  for (const src of filePaths) {
    const name = path.basename(src);
    const dest = path.join(destDir, 'media', name);
    await fs.copyFile(src, dest);
    results.push(dest);
  }
  return results;
});

ipcMain.handle('tiles:generate', async (_e, _scenePath: string) => {
  // Placeholder — real sharp tile pipeline comes in a later sprint.
  await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  return true;
});

// ── Excel export ──────────────────────────────────────────────────────────────

ipcMain.handle('excel:export', async (_e, projectData: unknown) => {
  const result = await dialog.showSaveDialog({
    title: 'Export to Excel',
    defaultPath: 'conchitect-project.xlsx',
    filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proj = projectData as any;
  const wb = XLSX.utils.book_new();

  const langs: string[] = (proj.languages?.available ?? ['en']);

  // ── Sheet: Scenes ──
  const scenesHeader: string[] = [
    'scene_id', 'slug', 'lat', 'lng', 'altitude', 'heading', 'capture_height',
    'category_slugs',
    ...langs.flatMap((l: string) => [`title_${l}`, `description_${l}`, `alt_text_${l}`]),
  ];
  const scenesRows = (proj.scenes ?? []).map((s: any) => {
    const catSlugs = (s.categoryIds ?? [])
      .map((id: string) => (proj.categories ?? []).find((c: any) => c.id === id)?.slug ?? '')
      .filter(Boolean)
      .join(',');
    return [
      s.id, s.slug,
      s.geo?.lat ?? '', s.geo?.lng ?? '', s.geo?.altitude ?? '',
      s.heading ?? 0, s.captureHeightMeters ?? 1.6,
      catSlugs,
      ...langs.flatMap((l: string) => [
        s.title?.[l] ?? '',
        s.description?.[l] ?? '',
        s.altText?.[l] ?? '',
      ]),
    ];
  });
  const scenesSheet = XLSX.utils.aoa_to_sheet([scenesHeader, ...scenesRows]);
  XLSX.utils.book_append_sheet(wb, scenesSheet, 'Scenes');

  // ── Sheet: Categories ──
  const catHeader = ['slug', 'color', 'icon_svg_path', ...langs.map((l: string) => `name_${l}`)];
  const catRows = (proj.categories ?? []).map((c: any) => [
    c.slug, c.color, c.iconSvg ?? '',
    ...langs.map((l: string) => c.name?.[l] ?? ''),
  ]);
  const catSheet = XLSX.utils.aoa_to_sheet([catHeader, ...catRows]);
  XLSX.utils.book_append_sheet(wb, catSheet, 'Categories');

  // ── Sheet: Project ──
  const meta = proj.meta ?? {};
  const projHeader = ['name', 'creator', 'contact_email', 'copyright', 'publication_url', 'short_description'];
  const projRow = [
    meta.name ?? '', meta.creator ?? '', meta.contactEmail ?? '',
    meta.copyright ?? '', meta.publicationUrl ?? '', meta.shortDescription ?? '',
  ];
  const projSheet = XLSX.utils.aoa_to_sheet([projHeader, [projRow].flat()]);
  XLSX.utils.book_append_sheet(wb, projSheet, 'Project');

  // ── Sheet: Hotspots ──
  const hsHeader = [
    'scene_slug', 'hotspot_id', 'type', 'ath', 'atv', 'target_scene_slug',
    'url', 'mailto',
    ...langs.flatMap((l: string) => [`title_${l}`, `label_${l}`, `body_${l}`, `subject_${l}`]),
  ];
  const hsRows: unknown[][] = [];
  for (const scene of (proj.scenes ?? [])) {
    for (const hs of (scene.hotspots ?? [])) {
      const targetSlug = hs.type === 'link'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (proj.scenes ?? []).find((s: any) => s.id === hs.targetSceneId)?.slug ?? ''
        : '';
      hsRows.push([
        scene.slug, hs.id, hs.type,
        hs.ath ?? 0, hs.atv ?? 0,
        targetSlug,
        hs.url ?? '',
        hs.mailto ?? '',
        ...langs.flatMap((l: string) => [
          hs.title?.[l] ?? '',
          hs.label?.[l] ?? '',
          hs.body?.[l] ?? '',
          hs.subject?.[l] ?? '',
        ]),
      ]);
    }
  }
  const hsSheet = XLSX.utils.aoa_to_sheet([hsHeader, ...hsRows]);
  XLSX.utils.book_append_sheet(wb, hsSheet, 'Hotspots');

  // ── Sheet: SEO ──
  const seo = proj.seo ?? {};
  const seoHeader = ['meta_title', 'meta_description', 'keywords', 'schema_type', 'image_sitemap'];
  const seoRow = [
    seo.metaTitle ?? '', seo.metaDescription ?? '',
    (seo.keywords ?? []).join(', '),
    seo.schemaType ?? 'Place',
    seo.imageSitemap ? 'true' : 'false',
  ];
  const seoSheet = XLSX.utils.aoa_to_sheet([seoHeader, seoRow]);
  XLSX.utils.book_append_sheet(wb, seoSheet, 'SEO');

  // ── Sheet: Branding ──
  const branding = proj.branding ?? {};
  const startSceneSlug = (proj.scenes ?? []).find((s: any) => s.id === branding.startSceneId)?.slug ?? '';
  const brandingHeader = [
    'primary_color', 'accent_color', 'start_scene_slug',
    ...langs.map((l: string) => `intro_text_${l}`),
  ];
  const brandingRow = [
    branding.primaryColor ?? '', branding.accentColor ?? '', startSceneSlug,
    ...langs.map((l: string) => branding.introText?.[l] ?? ''),
  ];
  const brandingSheet = XLSX.utils.aoa_to_sheet([brandingHeader, brandingRow]);
  XLSX.utils.book_append_sheet(wb, brandingSheet, 'Branding');

  // ── Sheet: Modules ──
  const modules = proj.modules ?? {};
  const modHeader = ['vr', 'gyroscope', 'fullscreen', 'feedback_mailto', 'forms_enabled', 'deepl_api_key'];
  const modRow = [
    modules.vr ? 'true' : 'false',
    modules.gyroscope ? 'true' : 'false',
    modules.fullscreen ? 'true' : 'false',
    modules.feedbackMailto ?? '',
    modules.formsEnabled ? 'true' : 'false',
    modules.deeplApiKey ?? '',
  ];
  const modSheet = XLSX.utils.aoa_to_sheet([modHeader, modRow]);
  XLSX.utils.book_append_sheet(wb, modSheet, 'Modules');

  try {
    XLSX.writeFile(wb, result.filePath);
    return { canceled: false, path: result.filePath };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { canceled: false, path: '', error: msg };
  }
});

// ── Excel template download ────────────────────────────────────────────────────

ipcMain.handle('excel:download-template', async (_e, projectData: unknown) => {
  const result = await dialog.showSaveDialog({
    title: 'Download Excel template',
    defaultPath: 'conchitect-template.xlsx',
    filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proj = projectData as any;
  const langs: string[] = (proj?.languages?.available?.length ? proj.languages.available : ['en']);

  const wb = XLSX.utils.book_new();

  // ── Scenes ──
  const scenesH = [
    'scene_id', 'slug', 'lat', 'lng', 'altitude', 'heading', 'capture_height', 'category_slugs',
    ...langs.flatMap((l: string) => [`title_${l}`, `description_${l}`, `alt_text_${l}`]),
  ];
  const scenesEx = [
    '(scene-uuid)', 'lobby', 48.8584, 2.2945, 0, 0, 1.6, 'exterior',
    ...langs.flatMap(() => ['Lobby', 'Main entrance hall', 'Lobby panorama']),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([scenesH, scenesEx]), 'Scenes');

  // ── Categories ──
  const catH = ['slug', 'color', 'icon_svg_path', ...langs.map((l: string) => `name_${l}`)];
  const catEx = ['exterior', '#3B82F6', '', ...langs.map(() => 'Exterior')];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([catH, catEx]), 'Categories');

  // ── Project ──
  const projH = ['name', 'creator', 'contact_email', 'copyright', 'publication_url', 'short_description'];
  const projEx = ['My Tour', 'Studio Name', 'contact@studio.com', '© 2026 Studio', 'https://example.com', 'A virtual 360° tour'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([projH, projEx]), 'Project');

  // ── Hotspots ──
  const hsH = [
    'scene_slug', 'hotspot_id', 'type', 'ath', 'atv', 'target_scene_slug', 'url', 'mailto',
    ...langs.flatMap((l: string) => [`title_${l}`, `label_${l}`, `body_${l}`, `subject_${l}`]),
  ];
  const hsEx = [
    'lobby', '(hotspot-uuid)', 'link', 45, 0, 'garden', '', '',
    ...langs.flatMap(() => ['To garden', '', '', '']),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hsH, hsEx]), 'Hotspots');

  // ── SEO ──
  const seoH = ['meta_title', 'meta_description', 'keywords', 'schema_type', 'image_sitemap'];
  const seoEx = ['My Tour | Virtual Visit', 'Take a virtual tour of...', 'virtual tour, 360, panorama', 'Place', 'true'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([seoH, seoEx]), 'SEO');

  // ── Branding ──
  const brandH = ['primary_color', 'accent_color', 'start_scene_slug', ...langs.map((l: string) => `intro_text_${l}`)];
  const brandEx = ['#1e293b', '#3b82f6', 'lobby', ...langs.map(() => 'Welcome to our tour')];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([brandH, brandEx]), 'Branding');

  // ── Modules ──
  const modH = ['vr', 'gyroscope', 'fullscreen', 'feedback_mailto', 'forms_enabled', 'deepl_api_key'];
  const modEx = ['false', 'true', 'true', 'contact@example.com', 'false', ''];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([modH, modEx]), 'Modules');

  try {
    XLSX.writeFile(wb, result.filePath);
    return { canceled: false, path: result.filePath };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { canceled: false, path: '', error: msg };
  }
});

// ── Excel import ──────────────────────────────────────────────────────────────

ipcMain.handle('excel:import', async (_e, projectData: unknown) => {
  const result = await dialog.showOpenDialog({
    title: 'Import from Excel',
    filters: [{ name: 'Excel workbook', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proj = projectData as any;
  const wb = XLSX.readFile(result.filePaths[0]);
  const langs: string[] = (proj.languages?.available ?? ['en']);

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const scenePatch: Record<string, Record<string, unknown>> = {};
  const catPatch: Record<string, Record<string, unknown>> = {};

  // ── Parse Scenes sheet ──
  const scenesWs = wb.Sheets['Scenes'];
  if (scenesWs) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(scenesWs, { header: 1 });
    const [header, ...dataRows] = rows as string[][];
    const col = (name: string) => header.indexOf(name);

    for (const row of dataRows) {
      if (!row.length) continue;
      const sceneId = String(row[col('scene_id')] ?? '').trim();
      const slugVal = String(row[col('slug')] ?? '').trim();
      const scene = sceneId
        ? (proj.scenes ?? []).find((s: any) => s.id === sceneId)
        : (proj.scenes ?? []).find((s: any) => s.slug === slugVal);

      if (!scene) {
        skipped++;
        const label = sceneId || slugVal;
        console.log(`[excel:import] Scene '${label}' not in project (skipped)`);
        continue;
      }

      const patch: Record<string, unknown> = {};

      const lat = parseFloat(String(row[col('lat')] ?? ''));
      const lng = parseFloat(String(row[col('lng')] ?? ''));
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        const altitude = parseFloat(String(row[col('altitude')] ?? ''));
        patch.geo = { lat, lng, ...(isNaN(altitude) ? {} : { altitude }) };
      }

      const heading = parseFloat(String(row[col('heading')] ?? ''));
      if (!isNaN(heading)) patch.heading = ((heading % 360) + 360) % 360;

      const captureH = parseFloat(String(row[col('capture_height')] ?? ''));
      if (!isNaN(captureH) && captureH > 0) patch.captureHeightMeters = captureH;

      const catSlugsStr = String(row[col('category_slugs')] ?? '').trim();
      if (catSlugsStr) {
        const ids = catSlugsStr.split(',')
          .map((s: string) => s.trim())
          .map((sl: string) => (proj.categories ?? []).find((c: any) => c.slug === sl)?.id)
          .filter(Boolean) as string[];
        patch.categoryIds = ids;
      }

      for (const l of langs) {
        const titleVal = String(row[col(`title_${l}`)] ?? '').trim();
        const descVal  = String(row[col(`description_${l}`)] ?? '').trim();
        const altVal   = String(row[col(`alt_text_${l}`)] ?? '').trim();
        if (titleVal) patch.title = { ...(scene.title ?? {}), [l]: titleVal };
        if (descVal)  patch.description = { ...(scene.description ?? {}), [l]: descVal };
        if (altVal)   patch.altText = { ...(scene.altText ?? {}), [l]: altVal };
      }

      if (Object.keys(patch).length) {
        scenePatch[scene.id] = patch;
        updated++;
      }
    }
  }

  // ── Parse Categories sheet ──
  const catsWs = wb.Sheets['Categories'];
  if (catsWs) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(catsWs, { header: 1 });
    const [header, ...dataRows] = rows as string[][];
    const col = (name: string) => header.indexOf(name);

    for (const row of dataRows) {
      if (!row.length) continue;
      const slugVal = String(row[col('slug')] ?? '').trim();
      const cat = (proj.categories ?? []).find((c: any) => c.slug === slugVal);
      if (!cat) { skipped++; continue; }

      const patch: Record<string, unknown> = {};
      const colorVal = String(row[col('color')] ?? '').trim();
      if (colorVal && /^#[0-9a-fA-F]{6}$/.test(colorVal)) patch.color = colorVal;

      const nameUpdates: Record<string, string> = { ...cat.name };
      for (const l of langs) {
        const val = String(row[col(`name_${l}`)] ?? '').trim();
        if (val) nameUpdates[l] = val;
      }
      if (JSON.stringify(nameUpdates) !== JSON.stringify(cat.name)) patch.name = nameUpdates;

      if (Object.keys(patch).length) {
        catPatch[cat.id] = patch;
        updated++;
      }
    }
  }

  return { canceled: false, updated, skipped, errors, scenePatch, catPatch };
});

// Temporary store for preview scene data (consumed by preview:getData immediately after window loads)
let pendingPreviewData: unknown = null;

ipcMain.handle('preview:open', async (_e, sourcePath: string, heading: number, sceneData?: unknown) => {
  pendingPreviewData = sceneData ?? null;

  const previewWin = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Preview — Conchitect',
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    const params = new URLSearchParams({ preview: sourcePath, heading: String(heading) });
    await previewWin.loadURL(`http://localhost:5173/?${params}`);
  } else {
    await previewWin.loadFile(path.join(__dirname, '../dist/index.html'), {
      query: { preview: sourcePath, heading: String(heading) },
    });
  }
  return true;
});

ipcMain.handle('preview:getData', async () => {
  const data = pendingPreviewData;
  pendingPreviewData = null;
  return data;
});

// ── App settings ──────────────────────────────────────────────────────────────

interface ConchitectSettings {
  krpanoPath: string;
  includeLicense: boolean;
  includeTestServer: boolean;
  useKrpanoTiles: boolean;
}

const DEFAULT_SETTINGS: ConchitectSettings = {
  krpanoPath: 'C:\\Users\\matth\\Documents\\krpano-dev\\krpano',
  includeLicense: false,
  includeTestServer: false,
  useKrpanoTiles: false,
};

async function readSettings(): Promise<ConchitectSettings> {
  try {
    const p = path.join(app.getPath('userData'), 'conchitect-settings.json');
    const raw = await fs.readFile(p, 'utf-8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(patch: Partial<ConchitectSettings>): Promise<void> {
  const current = await readSettings();
  const p = path.join(app.getPath('userData'), 'conchitect-settings.json');
  await fs.writeFile(p, JSON.stringify({ ...current, ...patch }, null, 2), 'utf-8');
}

ipcMain.handle('settings:get', () => readSettings());

ipcMain.handle('settings:set', async (_e, patch: Partial<ConchitectSettings>) => {
  await saveSettings(patch);
  return true;
});

// ── Project file format (.conchitect folder) ──────────────────────────────────

let currentProjectDir: string | null = null;

function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
}

function sendToRenderer(channel: string, ...args: unknown[]) {
  const w = getMainWindow();
  if (w) w.webContents.send(channel, ...args);
}

ipcMain.handle('project:get-current-path', () => currentProjectDir);

ipcMain.handle('project:new', async (_e, parentFolder: string, projectName: string) => {
  const slug = projectName.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '') || 'untitled';
  const projectDir = path.join(parentFolder, `${slug}.conchitect`);
  await fs.mkdir(path.join(projectDir, 'sources'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'cache'),   { recursive: true });
  await fs.mkdir(path.join(projectDir, 'assets'),  { recursive: true });
  const lock = { schemaVersion: 1, createdAt: new Date().toISOString(), lastModified: new Date().toISOString() };
  await fs.writeFile(path.join(projectDir, 'conchitect.lock'), JSON.stringify(lock, null, 2), 'utf-8');
  currentProjectDir = projectDir;
  return { projectDir };
});

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open Conchitect Project',
    properties: ['openDirectory'],
    buttonLabel: 'Open Project',
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const projectDir = result.filePaths[0];
  const projectJsonPath = path.join(projectDir, 'project.json');
  try {
    await fs.access(projectJsonPath);
  } catch {
    return { error: 'Not a valid Conchitect project (missing project.json)' };
  }

  const raw = await fs.readFile(projectJsonPath, 'utf-8');
  const project = JSON.parse(raw);

  // Resolve sourcePath from sourceFile when sourcePath is missing or stale
  if (Array.isArray(project.scenes)) {
    for (const scene of project.scenes) {
      if (scene.media?.sourceFile) {
        const resolved = path.join(projectDir, 'sources', scene.media.sourceFile);
        scene.media.sourcePath = resolved;
      }
    }
  }

  currentProjectDir = projectDir;
  return { projectDir, project };
});

ipcMain.handle('project:save', async (_e, projectData: unknown) => {
  if (!currentProjectDir) throw new Error('No project open — use Save As to create one');
  const p = path.join(currentProjectDir, 'project.json');
  await fs.writeFile(p, JSON.stringify(projectData, null, 2), 'utf-8');
  // Update lock timestamp
  try {
    const lockPath = path.join(currentProjectDir, 'conchitect.lock');
    const existing = JSON.parse(await fs.readFile(lockPath, 'utf-8').catch(() => '{}')).valueOf() as Record<string, unknown>;
    await fs.writeFile(lockPath, JSON.stringify({ ...existing, lastModified: new Date().toISOString() }, null, 2), 'utf-8');
  } catch { /* ignore */ }
  return true;
});

ipcMain.handle('project:save-as', async (_e, projectData: unknown) => {
  const pick = await dialog.showOpenDialog({
    title: 'Save Project As — choose parent folder',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Save Here',
  });
  if (pick.canceled || !pick.filePaths[0]) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projName = (projectData as any)?.meta?.name || 'untitled';
  const slug = projName.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '') || 'untitled';
  const destDir = path.join(pick.filePaths[0], `${slug}.conchitect`);

  // Copy sources and cache from current project if it exists
  if (currentProjectDir) {
    for (const sub of ['sources', 'cache', 'assets']) {
      try { await copyDir(path.join(currentProjectDir, sub), path.join(destDir, sub)); } catch { /* skip */ }
    }
  }

  await fs.mkdir(destDir, { recursive: true });
  const lock = { schemaVersion: 1, createdAt: new Date().toISOString(), lastModified: new Date().toISOString() };
  await fs.writeFile(path.join(destDir, 'conchitect.lock'), JSON.stringify(lock, null, 2), 'utf-8');
  await fs.writeFile(path.join(destDir, 'project.json'), JSON.stringify(projectData, null, 2), 'utf-8');

  currentProjectDir = destDir;
  return destDir;
});

// Copy photo into project sources/ folder, returns relative path (sourceFile)
ipcMain.handle('project:copy-source', async (_e, srcPath: string) => {
  if (!currentProjectDir) return null;
  const sourcesDir = path.join(currentProjectDir, 'sources');
  await fs.mkdir(sourcesDir, { recursive: true });
  const name = path.basename(srcPath);
  // Avoid overwriting if same file
  const dest = path.join(sourcesDir, name);
  try { await fs.access(dest); return name; } catch { /* copy */ }
  await fs.copyFile(srcPath, dest);
  return name;
});

// Build file menu and send actions to renderer
function setupAppMenu() {
  const sendAction = (action: string) => sendToRenderer(`menu:${action}`);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'New Project…',  accelerator: 'CmdOrCtrl+N', click: () => sendAction('new-project') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => sendAction('open-project') },
        { type: 'separator' },
        { label: 'Save',          accelerator: 'CmdOrCtrl+S',       click: () => sendAction('save') },
        { label: 'Save As…',      accelerator: 'CmdOrCtrl+Shift+S', click: () => sendAction('save-as') },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
  ]));
}

ipcMain.handle('krpano:validate', async (_e, krpanoPath: string) => {
  const checks = [
    { file: 'krpanotools.exe',                                        label: 'krpanotools.exe' },
    { file: path.join('krpano Testing Server.exe'),                   label: 'krpano Testing Server.exe' },
    { file: path.join('viewer', 'krpano.js'),                         label: 'viewer/krpano.js' },
    { file: path.join('templates', 'xml', 'skin', 'vtourskin.xml'),   label: 'templates/xml/skin/vtourskin.xml' },
  ];
  const missing: string[] = [];
  for (const { file, label } of checks) {
    try { await fs.access(path.join(krpanoPath, file)); } catch { missing.push(label); }
  }
  return { valid: missing.length === 0, missing };
});

ipcMain.handle('krpano:license-status', async (_e, krpanoPath: string) => {
  const licensePath = path.join(krpanoPath, 'krpanolicense.xml');
  try {
    await fs.access(licensePath);
    return { present: true, path: licensePath };
  } catch {
    return { present: false, path: licensePath };
  }
});

ipcMain.handle('krpano:register', async (_e, krpanoPath: string, code: string) => {
  const toolPath = path.join(krpanoPath, 'krpanotools.exe');
  // Concatenate the multiline code into one string (krpanotools expects no linebreaks)
  const cleanCode = code.replace(/\s+/g, '');
  if (!cleanCode) return { ok: false, message: 'Registration code is empty.' };

  return new Promise<{ ok: boolean; message: string }>((resolve) => {
    const proc = spawn(toolPath, ['register', cleanCode], {
      cwd: krpanoPath,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { output += d.toString(); });

    proc.on('close', (exitCode) => {
      const msg = output.trim() || (exitCode === 0 ? 'License activated.' : 'Registration failed — check your code.');
      resolve({ ok: exitCode === 0, message: msg });
    });

    proc.on('error', (err) => {
      resolve({ ok: false, message: `Could not launch krpanotools: ${err.message}` });
    });
  });
});

// ── Tile cache helpers ────────────────────────────────────────────────────────

async function fileHash(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return crypto.createHash('md5').update(data).digest('hex');
}

async function hasValidCache(cacheDir: string, slug: string, srcHash: string): Promise<boolean> {
  try {
    const metaPath = path.join(cacheDir, slug, 'cache.json');
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
    return meta.srcHash === srcHash;
  } catch {
    return false;
  }
}

async function copyCacheTo(cacheDir: string, slug: string, destPanosDir: string): Promise<void> {
  const src = path.join(cacheDir, slug, 'tiles');
  const dest = path.join(destPanosDir, `${slug}.tiles`);
  await copyDir(src, dest);
}

async function buildCacheFor(
  cacheDir: string,
  slug: string,
  tilesDir: string,
  srcHash: string,
): Promise<void> {
  const cacheSlugDir = path.join(cacheDir, slug);
  await fs.mkdir(cacheSlugDir, { recursive: true });
  // Copy tiles into cache
  const cacheTilesDir = path.join(cacheSlugDir, 'tiles');
  await copyDir(tilesDir, cacheTilesDir);
  // Write metadata
  await fs.writeFile(
    path.join(cacheSlugDir, 'cache.json'),
    JSON.stringify({ slug, srcHash, cachedAt: new Date().toISOString() }, null, 2),
    'utf-8',
  );
}

// ── Compile state (survives renderer navigation) ──────────────────────────────

interface CompileLogEntry {
  msg: string;
  status: 'running' | 'ok' | 'error' | 'info';
}

interface CompileRunState {
  running: boolean;
  log: CompileLogEntry[];
  result?: { ok: boolean; outputDir?: string; fileCount?: number; sizeBytes?: number; error?: string };
  startedAt: number;
}

let compileRunState: CompileRunState | null = null;
let compileCancelToken = { canceled: false };

ipcMain.handle('compile:get-state', () => compileRunState);

ipcMain.handle('compile:cancel', () => {
  compileCancelToken.canceled = true;
  return true;
});

// ── Compile pipeline ──────────────────────────────────────────────────────────

function xmlEsc(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sceneXmlName(slug: string): string {
  return 'scene_' + slug.replace(/-/g, '_');
}

function hotspotXmlName(id: string): string {
  return 'hs_' + id.replace(/-/g, '');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loc(record: Record<string, string> | undefined | null, lang: string): string {
  if (!record) return '';
  return record[lang] || record['en'] || Object.values(record)[0] || '';
}

async function copyDir(src: string, dest: string): Promise<number> {
  let count = 0;
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
      count++;
    }
  }
  return count;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateKrpanoXml(project: any, tiledSlugs: Set<string>): string {
  const lang: string = project.languages?.default || 'en';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scenes: any[] = project.scenes || [];
  const modules = project.modules || {};
  const startSceneId: string | undefined = project.branding?.startSceneId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startScene = scenes.find((s: any) => s.id === startSceneId) ?? scenes[0];
  const startName: string = startScene ? sceneXmlName(startScene.slug) : '';
  const projectTitle = xmlEsc(project.meta?.name || 'Virtual Tour');
  const gyro = modules.gyroscope ? 'true' : 'false';
  const webvr = modules.vr ? 'true' : 'false';

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<krpano version="1.23" title="${projectTitle}">\n\n`;

  xml += '  <include url="skin/vtourskin.xml"/>\n\n';

  xml += '  <skin_settings\n';
  xml += '    maps="false"\n';
  xml += `    gyro="${gyro}"\n`;
  xml += `    webvr="${webvr}"\n`;
  xml += '    title="true"\n';
  xml += '    thumbs="true"\n';
  xml += '    thumbs_width="120" thumbs_height="80" thumbs_padding="10" thumbs_crop="0|40|240|160"\n';
  xml += '    thumbs_opened="false"\n';
  xml += '    deeplinking="false"\n';
  xml += '    loadscene_flags="MERGE"\n';
  xml += '    loadscene_blend="OPENBLEND(0.5, 0.0, 0.75, 0.05, linear)"\n';
  xml += '  />\n\n';

  if (startName) {
    xml += '  <action name="startup" autorun="preinit">\n';
    xml += `    loadscene(${startName});\n`;
    xml += '  </action>\n\n';
  }

  // Custom hotspot styles (text, external, video — link uses skin default arrow)
  xml += '  <style name="hs_text" type="text"\n';
  xml += '    css="font-family:sans-serif; color:#fff; font-size:13px; background:rgba(0,0,0,0.55); padding:4px 12px; border-radius:20px;"\n';
  xml += '    edge="bottom" zoom="false" distorted="false"/>\n\n';
  xml += '  <style name="hs_external" type="text"\n';
  xml += '    css="font-family:sans-serif; color:#93c5fd; font-size:13px; font-weight:bold; background:rgba(0,0,0,0.55); padding:4px 12px; border-radius:20px; cursor:pointer;"\n';
  xml += '    edge="bottom" zoom="false" distorted="false"/>\n\n';
  xml += '  <style name="hs_video" type="text"\n';
  xml += '    css="font-family:sans-serif; color:#fbbf24; font-size:13px; font-weight:bold; background:rgba(0,0,0,0.55); padding:4px 12px; border-radius:20px; cursor:pointer;"\n';
  xml += '    edge="bottom" zoom="false" distorted="false"/>\n\n';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const scene of scenes) {
    const sName = sceneXmlName(scene.slug);
    const sTitle = xmlEsc(loc(scene.title, lang) || scene.slug);
    const dv = scene.defaultView;
    const hlookat: number = dv?.hlookat ?? 0;
    const vlookat: number = dv?.vlookat ?? 0;
    const fov: number = dv?.fov ?? 90;
    const heading: number = scene.heading ?? 0;
    const useTiles = tiledSlugs.has(scene.slug);
    const ext: string = path.extname(scene.media?.sourcePath || '.jpg') || '.jpg';

    const thumbAttr = useTiles ? ` thumburl="panos/${scene.slug}.tiles/thumb.jpg"` : '';
    const latAttr   = scene.geo?.lat != null ? ` lat="${scene.geo.lat}"` : '';
    const lngAttr   = scene.geo?.lng != null ? ` lng="${scene.geo.lng}"` : '';

    xml += `  <scene name="${sName}" title="${sTitle}"${thumbAttr}${latAttr}${lngAttr} heading="${heading}">\n`;
    xml += `    <view hlookat="${hlookat.toFixed(1)}" vlookat="${vlookat.toFixed(1)}" fovtype="MFOV" fov="${fov.toFixed(1)}" maxpixelzoom="2.0" fovmin="50" fovmax="140"/>\n`;

    if (useTiles) {
      xml += `    <preview url="panos/${scene.slug}.tiles/preview.jpg"/>\n`;
      xml += `    <image><cube url="panos/${scene.slug}.tiles/pano_%s.jpg"/></image>\n`;
    } else {
      xml += `    <image><sphere url="media/${xmlEsc(scene.slug)}${xmlEsc(ext)}" northoffset="${heading}"/></image>\n`;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const hs of (scene.hotspots as any[])) {
      const hsName = hotspotXmlName(hs.id);
      const ath: string = (hs.ath as number).toFixed(2);
      const atv: string = (hs.atv as number).toFixed(2);

      if (hs.type === 'link') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const targetScene = scenes.find((s: any) => s.id === hs.targetSceneId);
        if (!targetScene) continue;
        const linkedScene = sceneXmlName(targetScene.slug);
        // No style — vtour skin applies its own arrow image to linked hotspots
        xml += `    <hotspot name="${hsName}" ath="${ath}" atv="${atv}" linkedscene="${linkedScene}"/>\n`;
      } else if (hs.type === 'text') {
        const label = xmlEsc(loc(hs.title, lang) || 'Info');
        xml += `    <hotspot name="${hsName}" ath="${ath}" atv="${atv}" style="hs_text" text="${label}"/>\n`;
      } else if (hs.type === 'external') {
        const label = xmlEsc(loc(hs.label, lang) || 'Link');
        const url = xmlEsc(hs.url || '');
        xml += `    <hotspot name="${hsName}" ath="${ath}" atv="${atv}" style="hs_external" text="${label}" onclick="openurl(${url}, _blank);"/>\n`;
      } else if (hs.type === 'video') {
        const label = xmlEsc(`▶ ${loc(hs.title, lang) || 'Video'}`);
        const url = xmlEsc(hs.url || '');
        xml += `    <hotspot name="${hsName}" ath="${ath}" atv="${atv}" style="hs_video" text="${label}"${url ? ` onclick="openurl(${url}, _blank);"` : ''}/>\n`;
      }
    }

    xml += '  </scene>\n\n';
  }

  xml += '</krpano>\n';
  return xml;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateHtml(project: any): string {
  const meta = project.meta || {};
  const seo = project.seo || {};
  const branding = project.branding || {};
  const share = project.share || {};
  const lang: string = project.languages?.default || 'en';

  const title = xmlEsc(seo.metaTitle || meta.name || 'Virtual Tour');
  const description = xmlEsc(seo.metaDescription || meta.shortDescription || '');
  const keywords: string[] = seo.keywords || [];
  const publicUrl = String(meta.publicationUrl || '');
  const primaryColor: string = branding.primaryColor || '#1a1a1a';
  const accentColor: string = branding.accentColor || '#3b82f6';
  const copyright = xmlEsc(meta.copyright || '');

  const hasShare: boolean = !!(share.facebook || share.twitter || share.whatsapp || share.linkedin || share.email);

  let ogTags = '';
  if (publicUrl) {
    ogTags += `  <meta property="og:url" content="${xmlEsc(publicUrl)}">\n`;
    ogTags += `  <meta property="og:title" content="${title}">\n`;
    if (description) ogTags += `  <meta property="og:description" content="${description}">\n`;
    ogTags += `  <meta property="og:type" content="website">\n`;
  }

  let shareStyles = '';
  let shareBar = '';
  if (hasShare) {
    shareStyles = `\n    #share-bar{position:fixed;bottom:16px;right:16px;z-index:100;display:flex;gap:8px}` +
      `#share-bar a{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;text-decoration:none;font-size:13px;font-family:sans-serif;transition:background .2s}` +
      `#share-bar a:hover{background:${accentColor}}`;
    const links: string[] = [];
    if (share.facebook) links.push(`<a href="#" onclick="window.open('https://facebook.com/sharer/sharer.php?u='+encodeURIComponent(location.href),'_blank','noopener,noreferrer');return false;" title="Facebook">f</a>`);
    if (share.twitter)  links.push(`<a href="#" onclick="window.open('https://x.com/intent/tweet?url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent(document.title),'_blank','noopener,noreferrer');return false;" title="X / Twitter">X</a>`);
    if (share.whatsapp) links.push(`<a href="#" onclick="window.open('https://api.whatsapp.com/send?text='+encodeURIComponent(document.title)+'%20'+encodeURIComponent(location.href),'_blank','noopener,noreferrer');return false;" title="WhatsApp">W</a>`);
    if (share.linkedin) links.push(`<a href="#" onclick="window.open('https://linkedin.com/sharing/share-offsite/?url='+encodeURIComponent(location.href),'_blank','noopener,noreferrer');return false;" title="LinkedIn">in</a>`);
    if (share.email)    links.push(`<a href="#" onclick="location.href='mailto:?subject='+encodeURIComponent(document.title)+'&body='+encodeURIComponent(location.href);return false;" title="Email">@</a>`);
    shareBar = `  <div id="share-bar">${links.join('')}</div>\n`;
  }

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
${description ? `  <meta name="description" content="${description}">\n` : ''}${keywords.length ? `  <meta name="keywords" content="${xmlEsc(keywords.join(', '))}">\n` : ''}${ogTags}  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body{width:100%;height:100%;overflow:hidden;background:${primaryColor}}
    #pano{width:100%;height:100%}${shareStyles}
  </style>
</head>
<body>
  <div id="pano"></div>
${shareBar}${copyright ? `  <div style="position:fixed;bottom:4px;left:50%;transform:translateX(-50%);font-family:sans-serif;font-size:11px;color:rgba(255,255,255,.4);pointer-events:none;z-index:50">${copyright}</div>\n` : ''}  <script src="krpano/krpano.js"></script>
  <script>embedpano({xml:"tour.xml",target:"pano",html5:"only",mobilescale:1.0,passQueryParameters:true});</script>
</body>
</html>`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateSitemap(project: any): string {
  const meta = project.meta || {};
  const baseUrl = String(meta.publicationUrl || '').replace(/\/$/, '');
  if (!baseUrl) return '';

  const lang: string = project.languages?.default || 'en';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scenes: any[] = project.scenes || [];
  const today = new Date().toISOString().split('T')[0];

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
  xml += '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';

  // Root URL
  xml += '  <url>\n';
  xml += `    <loc>${xmlEsc(baseUrl)}/</loc>\n`;
  xml += `    <lastmod>${today}</lastmod>\n`;
  xml += '    <changefreq>monthly</changefreq>\n';
  xml += '    <priority>1.0</priority>\n';
  xml += '  </url>\n';

  // Per-scene URLs with image annotations
  for (const scene of scenes) {
    const ext: string = path.extname(scene.media?.sourcePath || '.jpg') || '.jpg';
    const sceneUrl = `${xmlEsc(baseUrl)}/scene/${xmlEsc(scene.slug)}/`;
    const imgUrl = `${xmlEsc(baseUrl)}/media/${xmlEsc(scene.slug)}${xmlEsc(ext)}`;
    const caption = xmlEsc(loc(scene.title, lang) || scene.slug);
    const alt = xmlEsc(loc(scene.altText, lang) || caption);
    xml += '  <url>\n';
    xml += `    <loc>${sceneUrl}</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += '    <changefreq>monthly</changefreq>\n';
    xml += '    <priority>0.8</priority>\n';
    xml += '    <image:image>\n';
    xml += `      <image:loc>${imgUrl}</image:loc>\n`;
    xml += `      <image:caption>${caption}</image:caption>\n`;
    xml += `      <image:title>${alt}</image:title>\n`;
    xml += '    </image:image>\n';
    xml += '  </url>\n';
  }

  xml += '</urlset>\n';
  return xml;
}

// Generates a per-scene deep-link page at scene/<slug>/index.html (depth 2 from root).
// Assets use ../../ prefix. The krpano onready callback loads the specific scene.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateScenePageHtml(project: any, scene: any): string {
  const meta = project.meta || {};
  const seo = project.seo || {};
  const branding = project.branding || {};
  const lang: string = project.languages?.default || 'en';

  const sceneTitle = xmlEsc(loc(scene.title, lang) || scene.slug);
  const projectTitle = xmlEsc(meta.name || 'Virtual Tour');
  const pageTitle = `${sceneTitle} — ${projectTitle}`;
  const description = xmlEsc(loc(scene.description, lang) || seo.metaDescription || '');
  const publicUrl = String(meta.publicationUrl || '').replace(/\/$/, '');
  const canonicalUrl = publicUrl ? `${xmlEsc(publicUrl)}/scene/${xmlEsc(scene.slug)}/` : '';
  const primaryColor: string = branding.primaryColor || '#1a1a1a';
  const copyright = xmlEsc(meta.copyright || '');
  const xmlName = sceneXmlName(scene.slug);

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
${description ? `  <meta name="description" content="${description}">\n` : ''}${canonicalUrl ? `  <link rel="canonical" href="${canonicalUrl}">\n  <meta property="og:url" content="${canonicalUrl}">\n` : ''}  <meta property="og:title" content="${sceneTitle}">
  <meta property="og:type" content="website">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body{width:100%;height:100%;overflow:hidden;background:${primaryColor}}
    #pano{width:100%;height:100%}
  </style>
</head>
<body>
  <div id="pano"></div>
${copyright ? `  <div style="position:fixed;bottom:4px;left:50%;transform:translateX(-50%);font-family:sans-serif;font-size:11px;color:rgba(255,255,255,.4);pointer-events:none;z-index:50">${copyright}</div>\n` : ''}  <script src="../../krpano/krpano.js"></script>
  <script>embedpano({xml:"../../tour.xml",target:"pano",html5:"only",mobilescale:1.0,passQueryParameters:false,onready:function(krp){krp.call("loadscene(${xmlName},null,MERGE,BLEND(0.5));");}});</script>
</body>
</html>`;
}

function generateHtaccess(): string {
  return `# Generated by Conchitect
Options -Indexes
ErrorDocument 404 /404.html

<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>

<IfModule mod_headers.c>
  <FilesMatch "\\.(js|css|jpg|jpeg|png|gif|ico|woff2?)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "\\.html$">
    Header set Cache-Control "no-cache, no-store, must-revalidate"
  </FilesMatch>
</IfModule>
`;
}

function generateRedirects(): string {
  return `# Netlify — generated by Conchitect
/*  /index.html  200
`;
}

function generateVercelJson(): string {
  return JSON.stringify({
    cleanUrls: true,
    trailingSlash: false,
    rewrites: [{ source: '/(.*)', destination: '/index.html' }],
    headers: [{
      source: '/(.*)\\.(?:js|css|jpg|jpeg|png|gif|ico|woff2?)',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    }],
  }, null, 2);
}

function generateWebConfig(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by Conchitect — IIS rewrite rules -->
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="SPA" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
    <staticContent>
      <mimeMap fileExtension=".xml" mimeType="application/xml" />
    </staticContent>
  </system.webServer>
</configuration>`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateRobotsTxt(project: any): string {
  const publicUrl = String(project.meta?.publicationUrl || '').replace(/\/$/, '');
  return `User-agent: *\nAllow: /\n${publicUrl ? `Sitemap: ${publicUrl}/sitemap.xml\n` : ''}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateReadmeTxt(project: any, includeLicense: boolean, krpanoPath: string): string {
  const name = project.meta?.name || 'Virtual Tour';
  const licenseSection = includeLicense
    ? '  Your krpanolicense.xml is included in the krpano/ folder.'
    : `  Your krpano license is NOT included.\n  Copy krpanolicense.xml from:\n    ${krpanoPath}\\krpanolicense.xml\n  into the krpano/ folder to remove the watermark.`;
  return `${name} — Virtual Tour
Generated by Conchitect
${'='.repeat(60)}

HOW TO PUBLISH
--------------

OPTION A — Apache / cPanel / OVH
  1. Upload all files to your web server root (FTP/SFTP)
  2. The .htaccess file handles URL routing automatically

OPTION B — Netlify
  1. Drag this folder into app.netlify.com/drop
  2. Or: connect your repo, set publish dir to this folder
  The _redirects file is pre-configured.

OPTION C — Vercel
  Run: npx vercel --prod (from this folder)
  vercel.json is pre-configured.

OPTION D — GitHub Pages
  Push this folder to a "docs/" subfolder in your repo,
  then enable Pages in Settings → Pages → "docs/" source.

KRPANO LICENSE
--------------
${licenseSection}

FILE STRUCTURE
--------------
  index.html         — main tour viewer
  tour.xml           — krpano scene configuration
  skin/              — krpano vtour skin
  krpano/            — krpano runtime (krpano.js)
  media/             — equirectangular panorama images
  panos/             — cube tile sets (if generated)
  scene/             — per-scene deep-link pages
  sitemap.xml        — search engine sitemap
  robots.txt         — crawler rules
  .htaccess          — Apache URL routing
  _redirects         — Netlify routing
  vercel.json        — Vercel routing
  web.config         — IIS routing
`;
}

function generateBat(krpanoPath: string): string {
  return `@echo off
cd /d "%~dp0"
start "" "${krpanoPath}\\krpano Testing Server.exe"
`;
}

ipcMain.handle('compile:run', async (event, projectData: unknown, outputDir: string) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const project = projectData as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scenes: any[] = project.scenes || [];
  const settings = await readSettings();
  const forceRegenTiles: boolean = (projectData as Record<string, unknown>)?.__forceRegenTiles === true;

  compileRunState = { running: true, log: [], startedAt: Date.now() };
  compileCancelToken = { canceled: false };
  const token = compileCancelToken;

  function progress(msg: string, status: 'running' | 'ok' | 'error' | 'info') {
    const entry: CompileLogEntry = { msg, status };
    if (compileRunState) compileRunState.log.push(entry);
    try { event.sender.send('compile:progress', { msg, status }); } catch { /* window closed */ }
  }

  function checkCancel() {
    if (token.canceled) throw new Error('Compile canceled');
  }

  try {
    progress('Starting compile…', 'running');

    // ── Create output structure ─────────────────────────────────────────────
    checkCancel();
    await fs.mkdir(path.join(outputDir, 'media'), { recursive: true });
    await fs.mkdir(path.join(outputDir, 'krpano'), { recursive: true });
    progress('Output folder ready', 'ok');

    // ── krpano runtime from installation ───────────────────────────────────
    const kPath = settings.krpanoPath;
    const viewerJs = path.join(kPath, 'viewer', 'krpano.js');
    const skinSrc  = path.join(kPath, 'templates', 'xml', 'skin');
    const licenseFile = path.join(kPath, 'krpanolicense.xml');
    const testServerExe = path.join(kPath, 'krpano Testing Server.exe');

    try {
      await fs.access(viewerJs);
      await fs.copyFile(viewerJs, path.join(outputDir, 'krpano', 'krpano.js'));
      progress('krpano.js copied from installation', 'ok');
    } catch {
      // Fallback to bundled assets/krpano/
      const assetSrc = isDev
        ? path.join(process.cwd(), 'assets', 'krpano')
        : path.join(process.resourcesPath, 'assets', 'krpano');
      try {
        await fs.access(assetSrc);
        const count = await copyDir(assetSrc, path.join(outputDir, 'krpano'));
        progress(`krpano runtime from assets/ (${count} files)`, 'info');
      } catch {
        progress('krpano.js not found — add viewer/krpano.js to krpano/ folder manually', 'info');
      }
    }

    // ── vtour skin ─────────────────────────────────────────────────────────
    try {
      await fs.access(skinSrc);
      const skinCount = await copyDir(skinSrc, path.join(outputDir, 'skin'));
      progress(`Skin copied (${skinCount} files)`, 'ok');
    } catch {
      progress('vtour skin not found — tour.xml skin include may fail', 'info');
    }

    // ── krpano plugins (webvr, gyro2, etc.) ────────────────────────────────
    // Drop the fs.access guard: copyDir already throws ENOENT if the source is missing,
    // and a bare catch {} was swallowing that error silently.
    const pluginsSrc = path.join(kPath, 'viewer', 'plugins');
    try {
      const pluginCount = await copyDir(pluginsSrc, path.join(outputDir, 'krpano', 'plugins'));
      if (pluginCount > 0) {
        progress(`Plugins copied (${pluginCount} files)`, 'ok');
      } else {
        progress(`Warning: viewer/plugins/ is empty at ${pluginsSrc}`, 'info');
      }
    } catch (err) {
      const msg = (err instanceof Error) ? err.message : String(err);
      progress(`Warning: plugins not copied — ${msg}`, 'info');
    }

    // ── License (opt-in) ───────────────────────────────────────────────────
    if (settings.includeLicense) {
      try {
        await fs.access(licenseFile);
        await fs.copyFile(licenseFile, path.join(outputDir, 'krpano', 'krpanolicense.xml'));
        progress('krpanolicense.xml included', 'ok');
      } catch {
        progress(`krpanolicense.xml not found at ${licenseFile} — download it from krpano.com/register`, 'info');
      }
    }

    // ── Copy scene images (sphere) ─────────────────────────────────────────
    checkCancel();
    let mediaCopied = 0;
    let mediaSkipped = 0;
    for (const scene of scenes) {
      const src: string | undefined = scene.media?.sourcePath;
      if (!src) { mediaSkipped++; continue; }
      try {
        await fs.access(src);
        const ext = path.extname(src) || '.jpg';
        await fs.copyFile(src, path.join(outputDir, 'media', `${scene.slug}${ext}`));
        mediaCopied++;
      } catch {
        progress(`Warning: media not found for "${scene.slug}"`, 'info');
        mediaSkipped++;
      }
    }
    progress(`Scene images: ${mediaCopied} copied${mediaSkipped > 0 ? `, ${mediaSkipped} skipped` : ''}`, mediaCopied > 0 ? 'ok' : 'info');

    // ── Tile generation via krpanotools ────────────────────────────────────
    checkCancel();
    const tiledSlugs = new Set<string>();
    if (settings.useKrpanoTiles) {
      const toolPath = path.join(kPath, 'krpanotools.exe');
      let toolOk = false;
      try { await fs.access(toolPath); toolOk = true; } catch { /* */ }

      if (toolOk) {
        const panosDir = path.join(outputDir, 'panos');
        await fs.mkdir(panosDir, { recursive: true });
        const cacheDir = currentProjectDir ? path.join(currentProjectDir, 'cache', 'tiles') : null;
        if (cacheDir) await fs.mkdir(cacheDir, { recursive: true });

        // Clean leftover temp folders from crashed/canceled prior compiles
        try {
          const tmpDirEntries = await fs.readdir(os.tmpdir());
          let cleaned = 0;
          for (const entry of tmpDirEntries) {
            if (entry.startsWith('conchitect-')) {
              const fp = path.join(os.tmpdir(), entry);
              try {
                const stat = await fs.stat(fp);
                if (stat.isDirectory()) await fs.rm(fp, { recursive: true, force: true });
                else await fs.unlink(fp);
                cleaned++;
              } catch { /* ignore */ }
            }
          }
          if (cleaned > 0) progress(`Cleaned ${cleaned} leftover temp folder(s)`, 'info');
        } catch { /* ignore */ }

        const tmpBase = path.join(os.tmpdir(), `conchitect-${Date.now()}`);
        await fs.mkdir(tmpBase, { recursive: true });

        const tileableScenes = scenes.filter((s: { media?: { sourcePath?: string } }) => s.media?.sourcePath);
        let tileSceneIdx = 0;

        for (const scene of scenes) {
          const src: string | undefined = scene.media?.sourcePath;
          if (!src) continue;
          checkCancel();
          tileSceneIdx++;
          try {
            const ext = path.extname(src) || '.jpg';
            const srcHash = await fileHash(src).catch(() => '');

            // Check cache first (unless force-regen)
            if (!forceRegenTiles && cacheDir && srcHash && await hasValidCache(cacheDir, scene.slug, srcHash)) {
              progress(`Tiles for "${scene.slug}" — from cache`, 'ok');
              await copyCacheTo(cacheDir, scene.slug, panosDir);
              tiledSlugs.add(scene.slug);
              continue;
            }

            progress(`Generating tiles for "${scene.slug}"…`, 'running');
            const tmpImg = path.join(tmpBase, `${scene.slug}${ext}`);
            await fs.copyFile(src, tmpImg);

            const sceneSlug = scene.slug;
            const sceneIndex = tileSceneIdx;
            const totalScenes = tileableScenes.length;

            const configPath = path.join(kPath, 'templates', 'multires.config');
            const HANG_TIMEOUT_MS = 30_000;
            await new Promise<void>((resolve, reject) => {
              const proc = spawn(toolPath, [
                'makepano',
                `-config=${configPath}`,
                `-outputpath=${panosDir}`,  // tiles land directly in outputDir/panos/
                '-xml=false',               // no xml → no "overwrite xml" prompt
                '-html=false',              // no html output needed
                tmpImg,
              ], {
                cwd: outputDir,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],  // no stdin → can't block on prompts
              });

              let lastOutputAt = Date.now();
              const hangChecker = setInterval(() => {
                if (Date.now() - lastOutputAt > HANG_TIMEOUT_MS) {
                  clearInterval(hangChecker);
                  proc.kill('SIGKILL');
                  progress(`krpanotools stuck for "${sceneSlug}" — no output for 30s, killed`, 'error');
                }
              }, 5000);

              proc.stdout?.on('data', (chunk: Buffer) => {
                lastOutputAt = Date.now();
                const lines = chunk.toString().split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
                for (const line of lines) {
                  try { event.sender.send('compile:progress', { msg: `  ${line}`, status: 'info' }); } catch { /* */ }
                  const pctMatch = line.match(/(\d+)%/);
                  if (pctMatch) {
                    try { event.sender.send('compile:tile-progress', {
                      sceneSlug, sceneIndex, totalScenes, percent: parseInt(pctMatch[1], 10),
                    }); } catch { /* */ }
                  }
                }
              });
              proc.stderr?.on('data', (chunk: Buffer) => {
                lastOutputAt = Date.now();
                const line = chunk.toString().trim();
                if (line) try { event.sender.send('compile:progress', { msg: `  ${line}`, status: 'info' }); } catch { /* */ }
              });
              proc.on('close', (code) => {
                clearInterval(hangChecker);
                if (code === 0) resolve();
                else reject(new Error(`krpanotools exited with code ${code}`));
              });
              proc.on('error', (err) => { clearInterval(hangChecker); reject(err); });
            });

            const generatedTilesDir = path.join(panosDir, `${scene.slug}.tiles`);
            tiledSlugs.add(scene.slug);
            progress(`Tiles ready for "${scene.slug}"`, 'ok');

            // Cache the result
            if (cacheDir && srcHash) {
              await buildCacheFor(cacheDir, scene.slug, generatedTilesDir, srcHash).catch(() => {});
            }
            await fs.unlink(tmpImg).catch(() => {});
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            progress(`Tile generation failed for "${scene.slug}": ${msg}`, 'info');
          }
        }
        await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
      } else {
        progress('krpanotools.exe not found — skipping tile generation', 'info');
      }
    }

    // ── tour.xml ───────────────────────────────────────────────────────────
    const tourXml = generateKrpanoXml(project, tiledSlugs);
    await fs.writeFile(path.join(outputDir, 'tour.xml'), tourXml, 'utf8');
    progress('tour.xml generated', 'ok');

    // ── index.html ─────────────────────────────────────────────────────────
    const indexHtml = generateHtml(project);
    await fs.writeFile(path.join(outputDir, 'index.html'), indexHtml, 'utf8');

    // 404.html = copy of index.html (SPA routing fallback)
    await fs.copyFile(path.join(outputDir, 'index.html'), path.join(outputDir, '404.html'));
    progress('index.html + 404.html generated', 'ok');

    // ── Per-scene deep-link pages ──────────────────────────────────────────
    const sceneOutDir = path.join(outputDir, 'scene');
    await fs.mkdir(sceneOutDir, { recursive: true });
    for (const scene of scenes) {
      const dir = path.join(sceneOutDir, scene.slug);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'index.html'), generateScenePageHtml(project, scene), 'utf8');
    }
    progress(`Per-scene pages: ${scenes.length} in scene/`, 'ok');

    // ── Rewrite configs ────────────────────────────────────────────────────
    await fs.writeFile(path.join(outputDir, '.htaccess'),   generateHtaccess(),     'utf8');
    await fs.writeFile(path.join(outputDir, '_redirects'),  generateRedirects(),    'utf8');
    await fs.writeFile(path.join(outputDir, 'vercel.json'), generateVercelJson(),   'utf8');
    await fs.writeFile(path.join(outputDir, 'web.config'),  generateWebConfig(),    'utf8');
    progress('Rewrite configs generated (.htaccess, _redirects, vercel.json, web.config)', 'ok');

    // ── Sitemap + robots.txt ───────────────────────────────────────────────
    const sitemap = generateSitemap(project);
    if (sitemap) {
      await fs.writeFile(path.join(outputDir, 'sitemap.xml'), sitemap, 'utf8');
      progress('sitemap.xml generated', 'ok');
    }
    await fs.writeFile(path.join(outputDir, 'robots.txt'), generateRobotsTxt(project), 'utf8');

    // ── README.txt ─────────────────────────────────────────────────────────
    await fs.writeFile(path.join(outputDir, 'README.txt'), generateReadmeTxt(project, settings.includeLicense, kPath), 'utf8');
    progress('README.txt generated', 'ok');

    // ── Optional testing server ────────────────────────────────────────────
    if (settings.includeTestServer) {
      try {
        await fs.access(testServerExe);
        await fs.copyFile(testServerExe, path.join(outputDir, 'krpano Testing Server.exe'));
        await fs.writeFile(path.join(outputDir, 'START_TESTING_SERVER.bat'), generateBat(kPath), 'utf8');
        progress('Testing server included', 'ok');
      } catch {
        progress('krpano Testing Server.exe not found — skipped', 'info');
      }
    }

    // ── Count output files + size ──────────────────────────────────────────
    let totalFiles = 0;
    let totalBytes = 0;
    async function countDir(dir: string) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) { await countDir(path.join(dir, e.name)); }
          else {
            totalFiles++;
            try {
              const st = await fs.stat(path.join(dir, e.name));
              totalBytes += st.size;
            } catch { /* */ }
          }
        }
      } catch { /* */ }
    }
    await countDir(outputDir);
    const sizeMb = (totalBytes / 1048576).toFixed(1);
    progress(`Done — ${totalFiles} files, ${sizeMb} MB`, 'ok');

    const result = { ok: true, outputDir, fileCount: totalFiles, sizeBytes: totalBytes };
    if (compileRunState) { compileRunState.running = false; compileRunState.result = result; }
    try { event.sender.send('compile:done', result); } catch { /* window closed */ }
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isCanceled = token.canceled;
    progress(isCanceled ? 'Compile canceled' : `Error: ${msg}`, isCanceled ? 'info' : 'error');
    const result = { ok: false, error: isCanceled ? 'Compile canceled' : msg };
    if (compileRunState) { compileRunState.running = false; compileRunState.result = result; }
    try { event.sender.send('compile:done', result); } catch { /* window closed */ }
    return result;
  }
});

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select output folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('shell:openFolder', async (_e, folderPath: string) => {
  await shell.openPath(folderPath);
});
