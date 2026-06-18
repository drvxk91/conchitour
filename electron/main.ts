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

// ── Tour preview server ───────────────────────────────────────────────────────
let tourPreviewServer: import('http').Server | null = null;
let tourPreviewPort  = 0;
let tourPreviewDir   = '';

const TOUR_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.xml':  'application/xml',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.txt':  'text/plain',
  '.json': 'application/json',
};

async function startTourPreviewServer(outputDir: string, defaultLang: string): Promise<number> {
  if (tourPreviewServer) { tourPreviewServer.close(); tourPreviewServer = null; }

  tourPreviewServer = http.createServer(async (req, res) => {
    const pathname = (req.url || '/').split('?')[0];

    // Route rewriting (mirrors generated server.js logic)
    let filePath: string | null = null;

    if (pathname === '/') {
      res.writeHead(302, { Location: `/${defaultLang}/` });
      res.end();
      return;
    }

    const langMatch    = pathname.match(/^\/([a-z]{2})\/?$/);
    const sceneMatch   = pathname.match(/^\/scene\/([^/]+)\/([a-z]{2})\/?$/);

    if (langMatch)  filePath = path.join(outputDir, langMatch[1], 'index.html');
    else if (sceneMatch) filePath = path.join(outputDir, sceneMatch[2], 'scene', sceneMatch[1], 'index.html');
    else filePath = path.join(outputDir, pathname.replace(/^\//, ''));

    try {
      const data = await fs.readFile(filePath);
      const ext  = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': TOUR_MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    } catch {
      // Fallback: serve default lang index (SPA-style 404)
      try {
        const fb = await fs.readFile(path.join(outputDir, defaultLang, 'index.html'));
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fb);
      } catch {
        res.writeHead(404).end('Not found');
      }
    }
  });

  return new Promise<number>((resolve) => {
    tourPreviewServer!.listen(0, '127.0.0.1', () => {
      tourPreviewPort = (tourPreviewServer!.address() as { port: number }).port;
      tourPreviewDir  = outputDir;
      resolve(tourPreviewPort);
    });
  });
}

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
    defaultPath: 'conchitour-project.xlsx',
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
    defaultPath: 'conchitour-template.xlsx',
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
    title: 'Preview — Conchitour',
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
  lastOutputDir: string;
  licenseInfo?: { name?: string; email?: string; domain?: string; type?: string; validUntil?: string };
}

const DEFAULT_SETTINGS: ConchitectSettings = {
  krpanoPath: 'C:\\Users\\matth\\Documents\\krpano-dev\\krpano',
  includeLicense: false,
  includeTestServer: false,
  useKrpanoTiles: false,
  lastOutputDir: '',
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
    title: 'Open Conchitour Project',
    properties: ['openDirectory'],
    buttonLabel: 'Open Project',
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const projectDir = result.filePaths[0];
  const projectJsonPath = path.join(projectDir, 'project.json');
  try {
    await fs.access(projectJsonPath);
  } catch {
    return { error: 'Not a valid Conchitour project (missing project.json)' };
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

// ── Multires tile detection ───────────────────────────────────────────────────

function readJpegDimensions(data: Buffer): { width: number; height: number } {
  if (data.length < 2 || data[0] !== 0xFF || data[1] !== 0xD8) return { width: 0, height: 0 };
  let i = 2;
  while (i + 3 < data.length) {
    if (data[i] !== 0xFF) break;
    const marker = data[i + 1];
    const segLen = data.readUInt16BE(i + 2);
    if (marker >= 0xC0 && marker <= 0xC3 && i + 8 < data.length) {
      return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
    }
    i += 2 + segLen;
  }
  return { width: 0, height: 0 };
}

interface TileLevel {
  num: number;
  tiledimagewidth: number;
  tiledimageheight: number;
  url: string;
}

interface TileInfo {
  tileSize: number;
  levels: TileLevel[]; // highest level first (full-res → preview)
}

// Inspects the tile directory produced by krpanotools and returns multires params.
// File layout: <slug>.tiles/<face>/l<N>/<row>/l<N>_<face>_<row>_<col>.jpg
// Edge tiles are smaller than tileSize, so we sum actual tile dimensions.
async function detectTileInfo(panosDir: string, slug: string): Promise<TileInfo | null> {
  const facesDir = path.join(panosDir, `${slug}.tiles`, 'f');
  try { await fs.access(facesDir); } catch { return null; }

  const levelDirs = (await fs.readdir(facesDir))
    .filter(d => /^l\d+$/.test(d))
    .sort((a, b) => parseInt(b.slice(1)) - parseInt(a.slice(1))); // highest level first
  if (levelDirs.length === 0) return null;

  // Detect tileSize from the first interior tile (top-left is always full-size)
  let tileSize = 512;
  try {
    const rows0 = (await fs.readdir(path.join(facesDir, levelDirs[0]))).filter(r => /^\d+$/.test(r)).sort();
    if (rows0.length > 0) {
      const files0 = (await fs.readdir(path.join(facesDir, levelDirs[0], rows0[0]))).filter(f => f.endsWith('.jpg')).sort();
      if (files0.length > 0) {
        const data = await fs.readFile(path.join(facesDir, levelDirs[0], rows0[0], files0[0]));
        const dims = readJpegDimensions(data);
        if (dims.width > 0) tileSize = dims.width;
      }
    }
  } catch { /* keep default 512 */ }

  const levels: TileLevel[] = [];
  for (const levelDir of levelDirs) {
    const levelNum = parseInt(levelDir.slice(1));
    try {
      const rows = (await fs.readdir(path.join(facesDir, levelDir)))
        .filter(r => /^\d+$/.test(r))
        .sort((a, b) => +a - +b);
      if (rows.length === 0) continue;

      const firstRowFiles = (await fs.readdir(path.join(facesDir, levelDir, rows[0])))
        .filter(f => f.endsWith('.jpg')).sort();
      if (firstRowFiles.length === 0) continue;

      // totalWidth = (numCols-1)*tileSize + lastColWidth (edge tile may be smaller)
      const lastColData = await fs.readFile(
        path.join(facesDir, levelDir, rows[0], firstRowFiles[firstRowFiles.length - 1]),
      );
      const lastColDims = readJpegDimensions(lastColData);
      const totalWidth = (firstRowFiles.length - 1) * tileSize + (lastColDims.width > 0 ? lastColDims.width : tileSize);

      // totalHeight = (numRows-1)*tileSize + lastRowHeight (edge row may be shorter)
      const lastRowFiles = (await fs.readdir(path.join(facesDir, levelDir, rows[rows.length - 1])))
        .filter(f => f.endsWith('.jpg')).sort();
      const lastRowData = await fs.readFile(
        path.join(facesDir, levelDir, rows[rows.length - 1], lastRowFiles[0]),
      );
      const lastRowDims = readJpegDimensions(lastRowData);
      const totalHeight = (rows.length - 1) * tileSize + (lastRowDims.height > 0 ? lastRowDims.height : tileSize);

      levels.push({
        num: levelNum,
        tiledimagewidth: totalWidth,
        tiledimageheight: totalHeight,
        url: `/panos/${slug}.tiles/%s/${levelDir}/%v/${levelDir}_%s_%v_%h.jpg`,
      });
    } catch { /* skip this level */ }
  }

  return levels.length > 0 ? { tileSize, levels } : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateKrpanoXml(project: any, tiledScenes: Map<string, TileInfo | null>): string {
  const lang: string = project.languages?.default || 'en';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scenes: any[] = project.scenes || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories: any[] = project.categories || [];
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

  xml += '  <include url="/skin/vtourskin.xml"/>\n\n';

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
    const useTiles = tiledScenes.has(scene.slug);
    const tileInfo = useTiles ? (tiledScenes.get(scene.slug) ?? null) : null;
    const ext: string = path.extname(scene.media?.sourcePath || '.jpg') || '.jpg';

    const thumbAttr = useTiles ? ` thumburl="/panos/${scene.slug}.tiles/preview.jpg"` : '';
    const latAttr   = scene.geo?.lat != null ? ` lat="${scene.geo.lat}"` : '';
    const lngAttr   = scene.geo?.lng != null ? ` lng="${scene.geo.lng}"` : '';

    xml += `  <scene name="${sName}" title="${sTitle}"${thumbAttr}${latAttr}${lngAttr} heading="${heading}">\n`;
    xml += `    <view hlookat="${hlookat.toFixed(1)}" vlookat="${vlookat.toFixed(1)}" fovtype="MFOV" fov="${fov.toFixed(1)}" maxpixelzoom="2.0" fovmin="50" fovmax="140"/>\n`;

    if (useTiles) {
      xml += `    <preview url="/panos/${scene.slug}.tiles/preview.jpg"/>\n`;
      if (tileInfo && tileInfo.levels.length > 0) {
        xml += `    <image type="CUBE" multires="true" tilesize="${tileInfo.tileSize}" baseindex="1">\n`;
        for (const lvl of tileInfo.levels) {
          xml += `      <level tiledimagewidth="${lvl.tiledimagewidth}" tiledimageheight="${lvl.tiledimageheight}">\n`;
          xml += `        <cube url="${lvl.url}"/>\n`;
          xml += `      </level>\n`;
        }
        xml += `    </image>\n`;
      } else {
        xml += `    <image><cube url="/panos/${scene.slug}.tiles/pano_%s.jpg"/></image>\n`;
      }
    } else {
      xml += `    <image><sphere url="/media/${xmlEsc(scene.slug)}${xmlEsc(ext)}" northoffset="${heading}"/></image>\n`;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const hs of ((scene.hotspots ?? []) as any[])) {
      const hsName = hotspotXmlName(hs.id);
      const ath: string = (hs.ath as number).toFixed(2);
      const atv: string = (hs.atv as number).toFixed(2);

      if (hs.type === 'link') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const targetScene = scenes.find((s: any) => s.id === hs.targetSceneId);
        if (!targetScene) continue;
        const linkedScene = sceneXmlName(targetScene.slug);
        const tooltip = xmlEsc(loc(targetScene.title, lang) || targetScene.slug);
        // Use target scene's primary category icon as hotspot pin
        const tCatId: string | undefined = (targetScene.categoryIds as string[])?.[0];
        const tCat = tCatId ? categories.find((c: any) => c.id === tCatId) : null;
        const iconUrl = tCat?.slug ? `/hotspots/cat-${tCat.slug}.svg` : '/hotspots/default.svg';
        xml += `    <hotspot name="${hsName}" type="image" url="${iconUrl}" ath="${ath}" atv="${atv}" width="40" height="48" edge="bottom" distorted="false" cursor="pointer" tooltip="${tooltip}" onclick="loadscene(${linkedScene},null,MERGE,BLEND(0.5));"/>\n`;
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateTourHtml(project: any, lang: string, startSceneSlug: string | null, tiledSlugs: Set<string>): string {
  const meta      = project.meta     || {};
  const seo       = project.seo      || {};
  const branding  = project.branding || {};
  const share     = project.share    || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scenes: any[]     = project.scenes     || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories: any[] = project.categories || [];
  const defaultLang: string  = project.languages?.default    || 'en';
  const allLangs: string[]   = project.languages?.available  || [defaultLang];

  const startScene = startSceneSlug
    ? scenes.find((s: any) => s.slug === startSceneSlug)
    : (scenes.find((s: any) => s.id === branding.startSceneId) ?? scenes[0]);

  const projectTitle = meta.name || 'Virtual Tour';
  const sceneTitle   = startScene ? (loc(startScene.title, lang) || startScene.slug) : '';
  const pageTitle    = xmlEsc(sceneTitle ? `${sceneTitle} — ${projectTitle}` : projectTitle);
  const description  = xmlEsc(startScene
    ? (loc(startScene.description, lang) || seo.metaDescription || '')
    : (seo.metaDescription || ''));
  const keywords: string[] = seo.keywords || [];
  const publicUrl    = String(meta.publicationUrl || '').replace(/\/$/, '');
  const canonicalPath = startSceneSlug ? `/scene/${startSceneSlug}/${lang}/` : `/${lang}/`;
  const canonicalUrl  = publicUrl ? publicUrl + canonicalPath : '';
  const primaryColor: string = branding.primaryColor || '#1a1a1a';
  const accentColor: string  = branding.accentColor  || '#3b82f6';
  const copyright = xmlEsc(meta.copyright || '');

  // Build per-lang scene data for the TOUR JS object (all scenes, current lang strings)
  const scenesData: Record<string, unknown> = {};
  for (const scene of scenes) {
    const ext = path.extname(scene.media?.sourcePath || '.jpg') || '.jpg';
    scenesData[scene.slug] = {
      title:       loc(scene.title, lang)       || scene.slug,
      description: loc(scene.description, lang) || '',
      categoryIds: scene.categoryIds || [],
      preview: tiledSlugs.has(scene.slug)
        ? `/panos/${scene.slug}.tiles/preview.jpg`
        : `/media/${scene.slug}${ext}`,
      gps: (scene.gps?.lat != null && scene.gps?.lng != null)
        ? { lat: scene.gps.lat, lng: scene.gps.lng }
        : null,
    };
  }

  // Categories keyed by ID
  const categoriesData: Record<string, unknown> = {};
  for (const cat of categories) {
    categoriesData[cat.id] = {
      name:    loc(cat.name, lang) || cat.slug,
      color:   cat.color || accentColor,
      iconSvg: cat.iconSvg || null,
    };
  }

  const tourDataJson = JSON.stringify({
    lang,
    defaultLang,
    allLangs,
    projectTitle,
    publicUrl: publicUrl || null,
    startScene: startSceneSlug,
    scenes: scenesData,
    categories: categoriesData,
  });

  const hasMap = scenes.some((s: any) => s.gps?.lat != null && s.gps?.lng != null);

  // OG / canonical
  let headExtras = '';
  if (canonicalUrl) {
    headExtras += `  <link rel="canonical" href="${xmlEsc(canonicalUrl)}">\n`;
    headExtras += `  <meta property="og:url" content="${xmlEsc(canonicalUrl)}">\n`;
  }
  headExtras += `  <meta property="og:title" content="${pageTitle}">\n`;
  if (description) headExtras += `  <meta property="og:description" content="${description}">\n`;
  headExtras += '  <meta property="og:type" content="website">\n';
  if (startScene && publicUrl && tiledSlugs.has(startScene.slug)) {
    headExtras += `  <meta property="og:image" content="${xmlEsc(publicUrl)}/panos/${startScene.slug}.tiles/preview.jpg">\n`;
  }
  if (keywords.length) headExtras += `  <meta name="keywords" content="${xmlEsc(keywords.join(', '))}">\n`;

  // Share bar
  let shareStyles = '';
  let shareBar    = '';
  const hasShare: boolean = !!(share.facebook || share.twitter || share.whatsapp || share.linkedin || share.email);
  if (hasShare) {
    shareStyles =
      `\n    #share-bar{position:fixed;bottom:16px;left:16px;z-index:100;display:flex;gap:8px}` +
      `#share-bar a{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;` +
      `background:rgba(0,0,0,.55);color:#fff;text-decoration:none;font-size:13px;font-family:sans-serif;transition:background .2s}` +
      `#share-bar a:hover{background:${accentColor}}`;
    const links: string[] = [];
    if (share.facebook) links.push(`<a href="#" onclick="window.open('https://facebook.com/sharer/sharer.php?u='+encodeURIComponent(location.href),'_blank','noopener,noreferrer');return false;" title="Facebook">f</a>`);
    if (share.twitter)  links.push(`<a href="#" onclick="window.open('https://x.com/intent/tweet?url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent(document.title),'_blank','noopener,noreferrer');return false;" title="X">X</a>`);
    if (share.whatsapp) links.push(`<a href="#" onclick="window.open('https://api.whatsapp.com/send?text='+encodeURIComponent(document.title)+'%20'+encodeURIComponent(location.href),'_blank','noopener,noreferrer');return false;" title="WhatsApp">W</a>`);
    if (share.linkedin) links.push(`<a href="#" onclick="window.open('https://linkedin.com/sharing/share-offsite/?url='+encodeURIComponent(location.href),'_blank','noopener,noreferrer');return false;" title="LinkedIn">in</a>`);
    if (share.email)    links.push(`<a href="#" onclick="location.href='mailto:?subject='+encodeURIComponent(document.title)+'&body='+encodeURIComponent(location.href);return false;" title="Email">@</a>`);
    shareBar = `  <div id="share-bar">${links.join('')}</div>\n`;
  }

  // For scene-specific deep-link pages, jump to the target scene on load
  const loadSceneCall = startSceneSlug
    ? `krp.call("loadscene(${sceneXmlName(startSceneSlug)},null,MERGE,BLEND(0.5));");`
    : '';

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
${description ? `  <meta name="description" content="${description}">\n` : ''}${headExtras}${hasMap ? '  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>\n' : ''}  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body{width:100%;height:100%;overflow:hidden;background:${primaryColor}}
    #pano{position:absolute;inset:0}
    #info-panel{
      position:fixed;right:0;top:0;bottom:0;width:340px;z-index:50;
      background:rgba(8,8,10,.9);
      backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
      color:#fff;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
      padding:52px 28px 32px 28px;
      display:flex;flex-direction:column;
      transform:translateX(100%);
      transition:transform .45s cubic-bezier(.22,1,.36,1);
      overflow-y:auto;
    }
    #info-panel.open{transform:translateX(0)}
    #panel-close{
      position:absolute;top:12px;right:12px;
      width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,.15);
      background:rgba(255,255,255,.08);color:#fff;font-size:18px;
      cursor:pointer;display:flex;align-items:center;justify-content:center;
      transition:background .2s;line-height:1;
    }
    #panel-close:hover{background:rgba(255,255,255,.2)}
    #panel-category{
      display:none;align-items:center;
      font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
      padding:4px 10px;border-radius:20px;align-self:flex-start;margin-bottom:14px;
      border:1px solid transparent;
    }
    #panel-title{font-size:23px;font-weight:700;line-height:1.2;margin-bottom:10px}
    #panel-rule{width:36px;height:2px;border-radius:1px;background:${accentColor};opacity:.7;margin-bottom:14px}
    #panel-desc{font-size:14px;line-height:1.7;color:rgba(255,255,255,.65);flex:1}
    #panel-toggle{
      position:fixed;top:50%;right:0;transform:translateY(-50%);z-index:51;
      background:rgba(8,8,10,.8);border:1px solid rgba(255,255,255,.12);border-right:none;
      border-radius:8px 0 0 8px;padding:14px 8px;cursor:pointer;color:rgba(255,255,255,.7);
      font-size:11px;writing-mode:vertical-rl;letter-spacing:.06em;text-transform:uppercase;
      font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      transition:right .45s cubic-bezier(.22,1,.36,1),background .2s,color .2s;
    }
    #panel-toggle:hover{background:rgba(255,255,255,.12);color:#fff}
    #panel-toggle.open{right:340px}${shareStyles}${hasMap ? `
    #map-btn{
      position:fixed;top:50%;left:0;transform:translateY(-50%);z-index:51;
      background:rgba(8,8,10,.8);border:1px solid rgba(255,255,255,.12);border-left:none;
      border-radius:0 8px 8px 0;padding:14px 8px;cursor:pointer;color:rgba(255,255,255,.7);
      font-size:11px;writing-mode:vertical-rl;letter-spacing:.06em;text-transform:uppercase;
      font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      transition:background .2s,color .2s;
    }
    #map-btn:hover{background:rgba(255,255,255,.12);color:#fff}
    #map-panel{
      position:fixed;left:0;top:0;bottom:0;width:360px;z-index:50;
      display:flex;flex-direction:column;
      transform:translateX(-100%);transition:transform .45s cubic-bezier(.22,1,.36,1);
    }
    #map-panel.open{transform:translateX(0)}
    #map-close{
      position:absolute;top:12px;right:12px;z-index:500;
      width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,.3);
      background:rgba(8,8,10,.85);color:#fff;font-size:18px;line-height:1;
      cursor:pointer;display:flex;align-items:center;justify-content:center;
    }
    #map-close:hover{background:rgba(255,255,255,.2)}
    #leaflet-map{flex:1}` : ''}
  </style>
</head>
<body>
  <div id="pano"></div>
  <aside id="info-panel">
    <button id="panel-close" aria-label="Close">&#x2715;</button>
    <div id="panel-category"></div>
    <h1 id="panel-title"></h1>
    <div id="panel-rule"></div>
    <p id="panel-desc"></p>
  </aside>
  <button id="panel-toggle">Info</button>
${hasMap ? `  <button id="map-btn">Map</button>
  <div id="map-panel">
    <button id="map-close" aria-label="Close">&#x2715;</button>
    <div id="leaflet-map"></div>
  </div>\n` : ''}${shareBar}${copyright ? `  <div style="position:fixed;bottom:4px;left:50%;transform:translateX(-50%);font-family:sans-serif;font-size:11px;color:rgba(255,255,255,.35);pointer-events:none;z-index:50">${copyright}</div>\n` : ''}  <script>
  var TOUR = ${tourDataJson};
  var _krpano    = null;
  var _curScene  = '';
  var _firstDone = false;

  function _showPanel(slug) {
    var scene = TOUR.scenes[slug];
    if (!scene) return;
    var catId = scene.categoryIds && scene.categoryIds[0];
    var cat   = catId ? TOUR.categories[catId] : null;
    var catEl = document.getElementById('panel-category');
    if (cat) {
      catEl.textContent = cat.name;
      var c = cat.color || '${accentColor}';
      catEl.style.cssText = 'display:inline-flex;align-items:center;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 10px;border-radius:20px;align-self:flex-start;margin-bottom:14px;border:1px solid ' + c + '55;background:' + c + '1a;color:' + c;
    } else {
      catEl.style.display = 'none';
    }
    document.getElementById('panel-title').textContent = scene.title || slug;
    document.getElementById('panel-desc').textContent  = scene.description || '';
    document.title = (scene.title || slug) + ' — ' + TOUR.projectTitle;
    document.getElementById('info-panel').classList.add('open');
    document.getElementById('panel-toggle').classList.add('open');
  }

  function _onScene(xmlName) {
    var slug = (xmlName || '').replace(/^scene_/, '');
    if (!slug || !TOUR.scenes[slug] || slug === _curScene) return;
    _curScene = slug;
    _showPanel(slug);
    var newPath = '/scene/' + slug + '/' + TOUR.lang + '/';
    if (window.location.pathname !== newPath) {
      try {
        if (!_firstDone) { history.replaceState({ scene: slug }, '', newPath); }
        else             { history.pushState  ({ scene: slug }, '', newPath); }
      } catch(e) {}
    }
    _firstDone = true;
  }

  window.addEventListener('popstate', function(e) {
    var slug = e.state && e.state.scene;
    if (slug && _krpano) _krpano.call('loadscene(scene_' + slug + ',null,MERGE,BLEND(0.5));');
  });

  document.getElementById('panel-close').addEventListener('click', function() {
    document.getElementById('info-panel').classList.remove('open');
    document.getElementById('panel-toggle').classList.remove('open');
  });
  document.getElementById('panel-toggle').addEventListener('click', function() {
    var open = document.getElementById('info-panel').classList.toggle('open');
    document.getElementById('panel-toggle').classList.toggle('open', open);
  });
  </script>
${hasMap ? `  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
  var _lmap = null;
  function _openMap() {
    var p = document.getElementById('map-panel');
    p.classList.add('open');
    if (_lmap) { setTimeout(function(){ _lmap.invalidateSize(); }, 300); return; }
    setTimeout(function() {
      _lmap = L.map('leaflet-map');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
        attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom:19
      }).addTo(_lmap);
      var bounds = [];
      Object.keys(TOUR.scenes).forEach(function(slug) {
        var sc = TOUR.scenes[slug];
        if (!sc.gps) return;
        var catId = sc.categoryIds && sc.categoryIds[0];
        var cat   = catId ? TOUR.categories[catId] : null;
        var color = cat ? cat.color : '#6b7280';
        var m = L.circleMarker([sc.gps.lat, sc.gps.lng], {
          radius:9, fillColor:color, color:'#fff', weight:2, opacity:1, fillOpacity:0.9
        });
        m.bindTooltip(sc.title || slug, {direction:'top'});
        m.on('click', function() {
          if (_krpano) _krpano.call('loadscene(scene_'+slug+',null,MERGE,BLEND(0.5));');
          _closeMap();
        });
        m.addTo(_lmap);
        bounds.push([sc.gps.lat, sc.gps.lng]);
      });
      if (bounds.length === 1) { _lmap.setView(bounds[0], 15); }
      else if (bounds.length > 1) { _lmap.fitBounds(bounds, {padding:[32,32]}); }
    }, 300);
  }
  function _closeMap() {
    document.getElementById('map-panel').classList.remove('open');
  }
  document.getElementById('map-btn').addEventListener('click', function() {
    document.getElementById('map-panel').classList.contains('open') ? _closeMap() : _openMap();
  });
  document.getElementById('map-close').addEventListener('click', _closeMap);
  </script>\n` : ''}  <script src="/krpano/krpano.js"></script>
  <script>embedpano({xml:"/tour.xml",basepath:"/",target:"pano",html5:"only",mobilescale:1.0,passQueryParameters:false,onready:function(krp){
    _krpano = krp;
    ${loadSceneCall}
    setInterval(function(){ var s=krp.get('xml.scene'); if(s&&s!==_curScene) _onScene(s); }, 250);
  }});</script>
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

  // Root URL (default lang entry point)
  xml += '  <url>\n';
  xml += `    <loc>${xmlEsc(baseUrl)}/${xmlEsc(lang)}/</loc>\n`;
  xml += `    <lastmod>${today}</lastmod>\n`;
  xml += '    <changefreq>monthly</changefreq>\n';
  xml += '    <priority>1.0</priority>\n';
  xml += '  </url>\n';

  // Per-scene URLs with image annotations — one entry per scene per lang
  for (const scene of scenes) {
    const ext: string = path.extname(scene.media?.sourcePath || '.jpg') || '.jpg';
    const sceneUrl = `${xmlEsc(baseUrl)}/scene/${xmlEsc(scene.slug)}/${xmlEsc(lang)}/`;
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

function generateHotspotSvg(color: string, label: string, iconSvg?: string | null): string {
  const c = /^#[0-9a-fA-F]{3,6}$/.test(color) ? color : '#555555';
  let inner = '';
  if (iconSvg) {
    const m = iconSvg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
    if (m) {
      // centre a 24×24 icon at (20,20) → translate(8,8)
      inner = `<g transform="translate(8,8)" fill="white" stroke="none">${m[1]}</g>`;
    }
  }
  if (!inner) {
    const letter = xmlEsc((label || '?').charAt(0).toUpperCase());
    inner = `<text x="20" y="25" text-anchor="middle" dominant-baseline="auto" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="white">${letter}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48">
  <defs><filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000" flood-opacity="0.45"/></filter></defs>
  <path d="M20,2 C10.06,2 2,10.06 2,20 C2,31 20,46 20,46 C20,46 38,31 38,20 C38,10.06 29.94,2 20,2Z" fill="${c}" filter="url(#sh)"/>
  <circle cx="20" cy="20" r="10" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>
  ${inner}
</svg>`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateServerJs(project: any): string {
  const defaultLang: string = project.languages?.default || 'en';
  const allLangs: string[]  = project.languages?.available || [defaultLang];
  return `'use strict';
/**
 * Conchitour virtual tour server
 * Usage: npm install && node server.js
 * PORT environment variable overrides default 3000.
 */
var express = require('express');
var path    = require('path');
var fs      = require('fs');
var app     = express();
var PORT    = parseInt(process.env.PORT || '3000', 10);
var LANGS   = ${JSON.stringify(allLangs)};
var DEFAULT = ${JSON.stringify(defaultLang)};
var ROOT    = __dirname;

// Strict routing: /en and /en/ are distinct routes (prevents redirect loops)
app.set('strict routing', true);

// Long-lived static assets — redirect:false so only our explicit routes issue redirects
['panos','krpano','skin','media','plugins'].forEach(function(dir) {
  app.use('/' + dir, express.static(path.join(ROOT, dir), { maxAge: '365d', redirect: false }));
});
// tour.xml, sitemap.xml, robots.txt — no cache, no auto-redirects
app.use(express.static(ROOT, { index: false, maxAge: 0, redirect: false }));

// Root → default language
app.get('/', function(_req, res) { res.redirect(302, '/' + DEFAULT + '/'); });

// /:lang  (no trailing slash) → add trailing slash
app.get('/:lang', function(req, res, next) {
  if (!LANGS.includes(req.params.lang)) return next();
  res.redirect(302, '/' + req.params.lang + '/');
});

// /:lang/
app.get('/:lang/', function(req, res, next) {
  if (!LANGS.includes(req.params.lang)) return next();
  var file = path.join(ROOT, req.params.lang, 'index.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  next();
});

// /scene/:slug/:lang  (no trailing slash) → add trailing slash
app.get('/scene/:slug/:lang', function(req, res, next) {
  if (!LANGS.includes(req.params.lang)) return next();
  res.redirect(302, '/scene/' + req.params.slug + '/' + req.params.lang + '/');
});

// /scene/:slug/:lang/
app.get('/scene/:slug/:lang/', function(req, res, next) {
  if (!LANGS.includes(req.params.lang)) return next();
  var file = path.join(ROOT, req.params.lang, 'scene', req.params.slug, 'index.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  // Scene not found in this lang → try default lang
  var fb = path.join(ROOT, DEFAULT, 'scene', req.params.slug, 'index.html');
  if (fs.existsSync(fb)) return res.redirect(302, '/scene/' + req.params.slug + '/' + DEFAULT + '/');
  next();
});

// 404 → serve tour root for the default language
app.use(function(_req, res) {
  var fb = path.join(ROOT, DEFAULT, 'index.html');
  if (fs.existsSync(fb)) return res.status(404).sendFile(fb);
  res.status(404).send('Not found');
});

app.listen(PORT, function() {
  console.log('Conchitour \\u2192 http://localhost:' + PORT + '/' + DEFAULT + '/');
});
`;
}

function generateNpmPackageJson(): string {
  return JSON.stringify({
    name: 'conchitour-tour',
    version: '1.0.0',
    private: true,
    description: 'Conchitour virtual tour — Express server',
    main: 'server.js',
    scripts: { start: 'node server.js' },
    dependencies: { express: '^4.21.0' },
  }, null, 2) + '\n';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateRobotsTxt(project: any): string {
  const publicUrl = String(project.meta?.publicationUrl || '').replace(/\/$/, '');
  return `User-agent: *\nAllow: /\n${publicUrl ? `Sitemap: ${publicUrl}/sitemap.xml\n` : ''}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateReadmeTxt(project: any, includeLicense: boolean, krpanoPath: string): string {
  const name = project.meta?.name || 'Virtual Tour';
  const defaultLang: string = project.languages?.default || 'en';
  const licenseSection = includeLicense
    ? '  Your krpanolicense.xml is included in the krpano/ folder.'
    : `  Your krpano license is NOT included.\n  Copy krpanolicense.xml from:\n    ${krpanoPath}\\krpanolicense.xml\n  into the krpano/ folder to remove the watermark.`;
  return `${name} — Virtual Tour
Generated by Conchitour
${'='.repeat(60)}

HOW TO START THE SERVER
-----------------------

This tour requires Node.js (https://nodejs.org) to run.

  1. Open a terminal in this folder
  2. Run: npm install
  3. Run: npm start   (or: node server.js)
  4. Open: http://localhost:3000/${defaultLang}/

To change the port:  PORT=8080 node server.js

Deploy on a VPS (OVH, DigitalOcean, Hetzner, etc.):
  - Upload this entire folder to your server
  - Install Node.js on the server
  - Run: npm install && node server.js
  - Use nginx or Apache as a reverse proxy to port 3000

URL STRUCTURE
-------------
  /                           → redirects to /${defaultLang}/
  /${defaultLang}/                 → tour entry point
  /scene/<slug>/${defaultLang}/    → direct link to a specific scene

KRPANO LICENSE
--------------
${licenseSection}

FILE STRUCTURE
--------------
  server.js          — Express server (entry point)
  package.json       — Node.js dependencies
  tour.xml           — krpano scene configuration
  skin/              — krpano vtour skin
  krpano/            — krpano runtime (krpano.js)
  media/             — equirectangular panorama images
  panos/             — cube tile sets (if generated)
  <lang>/            — per-language HTML pages
  sitemap.xml        — search engine sitemap
  robots.txt         — crawler rules
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
      const pluginCount = await copyDir(pluginsSrc, path.join(outputDir, 'plugins'));
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
    const tiledScenes = new Map<string, TileInfo | null>();
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

            // 1. Tiles already in output folder → skip entirely (Force regen overrides)
            if (!forceRegenTiles) {
              const outTilesDir = path.join(panosDir, `${scene.slug}.tiles`);
              try {
                await fs.access(path.join(outTilesDir, 'f'));
                progress(`Tiles for "${scene.slug}" — already in output, skipped`, 'ok');
                tiledScenes.set(scene.slug, await detectTileInfo(panosDir, scene.slug));
                continue;
              } catch { /* not there yet, check project cache */ }
            }

            // 2. Project cache hit → copy without running krpanotools
            if (!forceRegenTiles && cacheDir && srcHash && await hasValidCache(cacheDir, scene.slug, srcHash)) {
              progress(`Tiles for "${scene.slug}" — from cache`, 'ok');
              await copyCacheTo(cacheDir, scene.slug, panosDir);
              tiledScenes.set(scene.slug, await detectTileInfo(panosDir, scene.slug));
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
            tiledScenes.set(scene.slug, await detectTileInfo(panosDir, scene.slug));
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
    const tourXml = generateKrpanoXml(project, tiledScenes);
    await fs.writeFile(path.join(outputDir, 'tour.xml'), tourXml, 'utf8');
    progress('tour.xml generated', 'ok');

    // ── Per-language HTML pages ────────────────────────────────────────────
    const langs: string[] = project.languages?.available?.length
      ? project.languages.available
      : [project.languages?.default || 'en'];
    const tiledSlugsSet = new Set(tiledScenes.keys());

    // ── Hotspot category icons ──────────────────────────────────────────────
    const hotspotsDir = path.join(outputDir, 'hotspots');
    await fs.mkdir(hotspotsDir, { recursive: true });
    await fs.writeFile(path.join(hotspotsDir, 'default.svg'), generateHotspotSvg('#6b7280', '?'), 'utf8');
    for (const cat of (project.categories || []) as Array<{ slug?: string; color?: string; name?: Record<string, string> | string; iconSvg?: string }>) {
      if (!cat.slug) continue;
      const label = typeof cat.name === 'string' ? cat.name : (Object.values(cat.name || {})[0] || cat.slug);
      await fs.writeFile(
        path.join(hotspotsDir, `cat-${cat.slug}.svg`),
        generateHotspotSvg(cat.color || '#6b7280', label, cat.iconSvg),
        'utf8'
      );
    }
    progress(`Hotspot icons generated (${(project.categories || []).length} categories)`, 'ok');

    for (const lang of langs) {
      const langDir = path.join(outputDir, lang);
      await fs.mkdir(langDir, { recursive: true });

      // /:lang/index.html — tour entry point for this language
      const rootHtml = generateTourHtml(project, lang, null, tiledSlugsSet);
      await fs.writeFile(path.join(langDir, 'index.html'), rootHtml, 'utf8');

      // /:lang/scene/:slug/index.html — per-scene deep-link
      const sceneLangDir = path.join(langDir, 'scene');
      await fs.mkdir(sceneLangDir, { recursive: true });
      for (const scene of scenes) {
        const dir = path.join(sceneLangDir, scene.slug);
        await fs.mkdir(dir, { recursive: true });
        const sceneHtml = generateTourHtml(project, lang, scene.slug, tiledSlugsSet);
        await fs.writeFile(path.join(dir, 'index.html'), sceneHtml, 'utf8');
      }
    }
    progress(`HTML pages: ${langs.length} lang(s) × ${scenes.length + 1} pages`, 'ok');

    // ── Express server ─────────────────────────────────────────────────────
    await fs.writeFile(path.join(outputDir, 'server.js'),    generateServerJs(project), 'utf8');
    await fs.writeFile(path.join(outputDir, 'package.json'), generateNpmPackageJson(),  'utf8');
    progress('server.js + package.json generated', 'ok');

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

    // Auto-start preview server so the user can see the tour immediately
    const defaultLang: string = project.languages?.default || 'en';
    let previewUrl: string | undefined;
    try {
      const port = await startTourPreviewServer(outputDir, defaultLang);
      previewUrl = `http://localhost:${port}/${defaultLang}/`;
      progress(`Preview server: ${previewUrl}`, 'ok');
    } catch { /* preview server is optional */ }

    // Persist output dir in the project lock file (per-project, not global)
    if (currentProjectDir) {
      try {
        const lockPath = path.join(currentProjectDir, 'conchitect.lock');
        const existing = JSON.parse(await fs.readFile(lockPath, 'utf-8').catch(() => '{}')).valueOf() as Record<string, unknown>;
        await fs.writeFile(lockPath, JSON.stringify({ ...existing, lastOutputDir: outputDir }, null, 2), 'utf-8');
      } catch { /* non-fatal */ }
    }

    const result = { ok: true, outputDir, fileCount: totalFiles, sizeBytes: totalBytes, previewUrl };
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

ipcMain.handle('dialog:openProjectFolder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select project location',
    buttonLabel: 'Choose location',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('project:default-output-dir', async () => {
  if (!currentProjectDir) return null;
  // Check lock file for a previously used output dir for this project
  try {
    const lockPath = path.join(currentProjectDir, 'conchitect.lock');
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as Record<string, unknown>;
    if (lock.lastOutputDir && typeof lock.lastOutputDir === 'string') return lock.lastOutputDir;
  } catch { /* fall through */ }
  // Suggest a sibling folder: <parent>/<projectSlug>-web
  const parent = path.dirname(currentProjectDir);
  const base   = path.basename(currentProjectDir).replace(/\.conchitect$/, '');
  return path.join(parent, `${base}-web`);
});

ipcMain.handle('shell:openFolder', async (_e, folderPath: string) => {
  await shell.openPath(folderPath);
});

ipcMain.handle('shell:openUrl', async (_e, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle('tour-server:start', async (_e, outputDir: string, defaultLang: string) => {
  try {
    const port = await startTourPreviewServer(outputDir, defaultLang || 'en');
    return { ok: true, port, url: `http://localhost:${port}/${defaultLang || 'en'}/` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('tour-server:stop', async () => {
  if (tourPreviewServer) { tourPreviewServer.close(); tourPreviewServer = null; tourPreviewPort = 0; }
  return true;
});

ipcMain.handle('tour-server:status', async () => {
  if (!tourPreviewServer) return null;
  const defaultLang = tourPreviewDir
    ? (await fs.readdir(tourPreviewDir).then(
        (entries) => entries.find((e) => /^[a-z]{2}$/.test(e)) ?? 'en'
      ).catch(() => 'en'))
    : 'en';
  return { port: tourPreviewPort, url: `http://localhost:${tourPreviewPort}/${defaultLang}/`, dir: tourPreviewDir };
});
