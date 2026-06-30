import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { marked } from 'marked';
import {
  checkLicenseStatus,
  activateLicense,
  startTrial,
  deactivateThisMachine,
  getLocalLicense,
} from './license/gate';
import { getTrialState, consumeTrialAiCall } from './license/trial';
import { TRIAL_LIMITS } from '../src/types/license';

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
let initialLicenseStatus: import('../src/types/license').LicenseGateStatus = 'none';

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
    const pageMatch    = pathname.match(/^\/page\/([^/]+)\/([a-z]{2})\/?$/);
    const pageNoLang   = pathname.match(/^\/page\/([^/]+)\/?$/);

    if (langMatch)       filePath = path.join(outputDir, langMatch[1], 'index.html');
    else if (sceneMatch) filePath = path.join(outputDir, sceneMatch[2], 'scene', sceneMatch[1], 'index.html');
    else if (pageMatch)  filePath = path.join(outputDir, 'page', pageMatch[1], pageMatch[2], 'index.html');
    else if (pageNoLang) filePath = path.join(outputDir, 'page', pageNoLang[1], defaultLang, 'index.html');
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
  cleanupOldPreviews().catch(() => {});

  // One-shot migration: copy user data from the old conchitect-app userData folder
  // (Electron derives the folder from package.json "name"; renaming it loses the data)
  try {
    const oldUserData = path.join(app.getPath('appData'), 'conchitect-app');
    const newUserData = app.getPath('userData'); // conchitour-app
    await fs.access(oldUserData); // throws if old folder doesn't exist
    const newLicense = path.join(newUserData, 'license.json');
    let needsMigration = false;
    try { await fs.access(newLicense); } catch { needsMigration = true; }
    if (needsMigration) {
      await fs.mkdir(newUserData, { recursive: true });
      const entries = await fs.readdir(oldUserData);
      for (const entry of entries) {
        const src = path.join(oldUserData, entry);
        const dst = path.join(newUserData, entry);
        try { await fs.access(dst); } catch {
          await fs.copyFile(src, dst);
          console.log(`[migration] conchitect-app → conchitour-app: copied ${entry}`);
        }
      }
    }
  } catch { /* old folder absent — nothing to migrate */ }

  // Check license before showing main window so renderer gets initial status immediately
  initialLicenseStatus = await checkLicenseStatus().catch(() => 'none' as const);

  await createWindow();

  // Background heartbeat: re-check every 24h, notify renderer if status degrades
  setInterval(async () => {
    try {
      const status = await checkLicenseStatus();
      if (status === 'expired' || status === 'invalid') {
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send('license:status-changed', status),
        );
      }
    } catch { /* ignore */ }
  }, 24 * 60 * 60 * 1000);
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

app.on('before-quit', () => {
  if (tourPreviewServer) {
    try { tourPreviewServer.close(); } catch { /* ignore */ }
    tourPreviewServer = null;
    tourPreviewPort = 0;
  }
  // Async temp dir cleanup happens on next launch — don't block quit
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
        const d = Number(dir);
        exif.direction = ((d % 360) + 360) % 360;
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

// ── Image compression for AI vision ──────────────────────────────────────────

ipcMain.handle('media:compress-for-ai', async (_e, args: {
  sourcePath: string;
  targetWidth: number;
  quality: number;
}) => {
  try {
    const sharpMod = (await import(/* @vite-ignore */ 'sharp')).default;
    const buf = await sharpMod(args.sourcePath)
      .resize({ width: args.targetWidth, fit: 'inside' })
      .jpeg({ quality: args.quality })
      .toBuffer();
    return {
      ok: true,
      dataUrl: 'data:image/jpeg;base64,' + buf.toString('base64'),
      bytes: buf.length,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// ── Excel backup (auto-save to projectDir/backups/) ───────────────────────────

ipcMain.handle('excel:backup', async (_e, projectData: unknown, projectDir: string) => {
  try {
    const backupsDir = path.join(projectDir, 'backups');
    await fs.mkdir(backupsDir, { recursive: true });

    const proj = projectData as Record<string, unknown>;
    const slug = (proj?.meta as Record<string, string> | undefined)?.name?.replace(/[^a-z0-9]/gi, '-').toLowerCase() ?? 'project';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${slug}-backup-${ts}.xlsx`;
    const filePath = path.join(backupsDir, filename);

    const wb = XLSX.utils.book_new();
    const langs: string[] = ((proj.languages as Record<string, unknown>)?.available as string[]) ?? ['en'];
    const scenes = (proj.scenes as unknown[]) ?? [];

    const sceneHeader = ['slug', 'heading', 'gps_lat', 'gps_lng',
      ...langs.flatMap((l: string) => [`title_${l}`, `description_${l}`, `altText_${l}`]),
    ];
    const sceneRows = scenes.map((s) => {
      const sc = s as Record<string, unknown>;
      const geo = sc.geo as Record<string, number> | undefined;
      return [
        sc.slug ?? '', sc.heading ?? 0,
        geo?.lat ?? '', geo?.lng ?? '',
        ...langs.flatMap((l: string) => {
          const t = sc.title as Record<string, string> | undefined;
          const d = sc.description as Record<string, string> | undefined;
          const a = sc.altText as Record<string, string> | undefined;
          return [t?.[l] ?? '', d?.[l] ?? '', a?.[l] ?? ''];
        }),
      ];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sceneHeader, ...sceneRows]), 'Scenes');
    XLSX.writeFile(wb, filePath);

    // Keep only last 20 backups
    const all = await fs.readdir(backupsDir);
    const xlsxFiles = all
      .filter((f) => f.endsWith('.xlsx'))
      .sort()
      .reverse();
    for (const old of xlsxFiles.slice(20)) {
      await fs.unlink(path.join(backupsDir, old)).catch(() => {});
    }
    const cleaned = Math.max(0, xlsxFiles.length - 20);

    const stat = await fs.stat(filePath);
    return { ok: true, path: filePath, filename, bytes: stat.size, cleaned };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
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
      .join(';');
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
  const modHeader = ['vr', 'gyroscope', 'fullscreen', 'feedback_mailto', 'forms_enabled'];
  const modRow = [
    modules.vr ? 'true' : 'false',
    modules.gyroscope ? 'true' : 'false',
    modules.fullscreen ? 'true' : 'false',
    modules.feedbackMailto ?? '',
    modules.formsEnabled ? 'true' : 'false',
  ];
  const modSheet = XLSX.utils.aoa_to_sheet([modHeader, modRow]);
  XLSX.utils.book_append_sheet(wb, modSheet, 'Modules');

  // ── Sheet: Pages ──
  const pagesExportHeader = [
    'id', 'slug', 'built_in', 'enabled', 'show_in_footer', 'order',
    ...langs.map((l: string) => `title_${l}`),
    ...langs.map((l: string) => `content_${l}`),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pagesExportRows = (proj.pages ?? []).map((p: any) => [
    p.id, p.slug, p.builtIn ?? '', p.enabled ? 'true' : 'false',
    p.showInFooter ? 'true' : 'false', p.order ?? 0,
    ...langs.map((l: string) => p.title?.[l] ?? ''),
    ...langs.map((l: string) => p.content?.[l] ?? ''),
  ]);
  const pagesExportSheet = XLSX.utils.aoa_to_sheet([pagesExportHeader, ...pagesExportRows]);
  XLSX.utils.book_append_sheet(wb, pagesExportSheet, 'Pages');

  // ── Sheet: Analytics ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analytics: any = (proj as any).analytics ?? {};
  const gaEventsExport: Record<string, boolean> = analytics.events ?? {};
  const analyticsHeader = [
    'enabled', 'measurement_id', 'anonymize_ip', 'respect_cookie_consent',
    'ev_scene_view', 'ev_scene_change', 'ev_tour_started', 'ev_tour_completed',
    'ev_hotspot_click', 'ev_link_hotspot_click', 'ev_external_link_click',
    'ev_info_hotspot_open', 'ev_video_play', 'ev_form_open', 'ev_form_submit',
    'ev_map_open', 'ev_map_marker_click', 'ev_share_click', 'ev_language_change',
    'ev_cookie_accepted', 'ev_info_panel_open', 'ev_fullscreen_enter',
  ];
  const analyticsRow = [
    analytics.enabled ? 'true' : 'false',
    analytics.measurementId ?? '',
    analytics.anonymizeIp !== false ? 'true' : 'false',
    analytics.respectCookieConsent !== false ? 'true' : 'false',
    gaEventsExport.scene_view !== false ? 'true' : 'false',
    gaEventsExport.scene_change !== false ? 'true' : 'false',
    gaEventsExport.tour_started !== false ? 'true' : 'false',
    gaEventsExport.tour_completed ? 'true' : 'false',
    gaEventsExport.hotspot_click !== false ? 'true' : 'false',
    gaEventsExport.link_hotspot_click !== false ? 'true' : 'false',
    gaEventsExport.external_link_click !== false ? 'true' : 'false',
    gaEventsExport.info_hotspot_open !== false ? 'true' : 'false',
    gaEventsExport.video_play !== false ? 'true' : 'false',
    gaEventsExport.form_open !== false ? 'true' : 'false',
    gaEventsExport.form_submit !== false ? 'true' : 'false',
    gaEventsExport.map_open !== false ? 'true' : 'false',
    gaEventsExport.map_marker_click !== false ? 'true' : 'false',
    gaEventsExport.share_click !== false ? 'true' : 'false',
    gaEventsExport.language_change !== false ? 'true' : 'false',
    gaEventsExport.cookie_accepted !== false ? 'true' : 'false',
    gaEventsExport.info_panel_open ? 'true' : 'false',
    gaEventsExport.fullscreen_enter ? 'true' : 'false',
  ];
  const analyticsSheet = XLSX.utils.aoa_to_sheet([analyticsHeader, analyticsRow]);
  XLSX.utils.book_append_sheet(wb, analyticsSheet, 'Analytics');

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
  const modH = ['vr', 'gyroscope', 'fullscreen', 'feedback_mailto', 'forms_enabled'];
  const modEx = ['false', 'true', 'true', 'contact@example.com', 'false'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([modH, modEx]), 'Modules');

  // ── Pages ──
  const pagesTplH = [
    'id', 'slug', 'built_in', 'enabled', 'show_in_footer', 'order',
    ...langs.map((l: string) => `title_${l}`),
    ...langs.map((l: string) => `content_${l}`),
  ];
  const pagesTplEx = [
    'page-privacy', 'privacy', 'privacy', 'false', 'true', '0',
    ...langs.map(() => 'Privacy Policy'),
    ...langs.map(() => '# Privacy Policy\n\nYour policy text here.'),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([pagesTplH, pagesTplEx]), 'Pages');

  // ── Analytics ──
  const gaH = [
    'enabled', 'measurement_id', 'anonymize_ip', 'respect_cookie_consent',
    'ev_scene_view', 'ev_scene_change', 'ev_tour_started', 'ev_tour_completed',
    'ev_hotspot_click', 'ev_link_hotspot_click', 'ev_external_link_click',
    'ev_info_hotspot_open', 'ev_video_play', 'ev_form_open', 'ev_form_submit',
    'ev_map_open', 'ev_map_marker_click', 'ev_share_click', 'ev_language_change',
    'ev_cookie_accepted', 'ev_info_panel_open', 'ev_fullscreen_enter',
  ];
  const gaEx = [
    'false', 'G-XXXXXXXXXX', 'true', 'true',
    'true', 'true', 'true', 'false',
    'true', 'true', 'true',
    'true', 'true', 'true', 'true',
    'true', 'true', 'true', 'true',
    'true', 'false', 'false',
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([gaH, gaEx]), 'Analytics');

  try {
    XLSX.writeFile(wb, result.filePath);
    return { canceled: false, path: result.filePath };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { canceled: false, path: '', error: msg };
  }
});

// ── Excel import ──────────────────────────────────────────────────────────────

interface ImportChange {
  id: string;
  entityType: 'scene' | 'category' | 'page' | 'analytics' | 'hotspot' | 'project' | 'modules' | 'ai_context';
  entityId: string;
  parentId?: string;
  entityLabel: string;
  field: string;
  oldValue: string;
  newValue: string;
  patchValue: unknown;
}

interface ImportValidationError {
  entityLabel: string;
  field: string;
  value: string;
  message: string;
}

function getCellString(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && 'richText' in v) {
    return (v as ExcelJS.CellRichTextValue).richText.map((rt) => rt.text).join('');
  }
  if (typeof v === 'object' && 'formula' in v) {
    const res = (v as ExcelJS.CellFormulaValue).result;
    if (res === null || res === undefined || res instanceof Error) return '';
    return String(res);
  }
  if (typeof v === 'object' && 'sharedFormula' in v) {
    const res = (v as ExcelJS.CellSharedFormulaValue).result;
    if (res === null || res === undefined || res instanceof Error) return '';
    return String(res);
  }
  return String(v);
}

function wsToRows(ws: ExcelJS.Worksheet): string[][] {
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const arr: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      while (arr.length < colNumber - 1) arr.push('');
      arr.push(getCellString(cell));
    });
    out.push(arr);
  });
  return out;
}

ipcMain.handle('excel:import', async (_e, projectData: unknown) => {
  const result = await dialog.showOpenDialog({
    title: 'Import from Excel',
    filters: [{ name: 'Excel workbook', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true, changes: [], validationErrors: [] };

  const filePath = result.filePaths[0];

  // Step 1: Read raw bytes with specific error detection
  let fileBuffer: Buffer;
  try {
    const stat = await fs.stat(filePath);
    if (stat.size === 0) {
      return { canceled: false, changes: [], validationErrors: [], error: 'The selected file is empty.' };
    }
    fileBuffer = await fs.readFile(filePath);
  } catch (fsErr: unknown) {
    const err = fsErr as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return { canceled: false, changes: [], validationErrors: [], error: 'File not found. It may have been moved or deleted.' };
    if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') return { canceled: false, changes: [], validationErrors: [], error: 'File is locked by another application. Close it in Excel and try again.' };
    return { canceled: false, changes: [], validationErrors: [], error: `Cannot read file: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Step 2: Parse with ExcelJS (same library used for export — avoids SheetJS/extLst mismatch)
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(fileBuffer);
  } catch (parseErr: unknown) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.error('[excel:import] parse failed:', parseErr);
    return { canceled: false, changes: [], validationErrors: [], error: `Cannot parse Excel file: ${msg}` };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proj = projectData as any;
  const langs: string[] = (proj.languages?.available ?? ['en']);
  const defaultLang: string = proj.languages?.default ?? 'en';
  try {

  const changes: ImportChange[] = [];
  const validationErrors: ImportValidationError[] = [];

  function pushChange(
    entityType: ImportChange['entityType'],
    entityId: string,
    entityLabel: string,
    field: string,
    oldDisplay: string,
    newDisplay: string,
    patchValue: unknown,
    parentId?: string,
  ) {
    if (oldDisplay === newDisplay) return;
    changes.push({ id: `${entityType}:${entityId}:${field}`, entityType, entityId, parentId, entityLabel, field, oldValue: oldDisplay, newValue: newDisplay, patchValue });
  }

  // ── Parse Scenes sheet ──
  const scenesWs = wb.getWorksheet('Scenes');
  if (scenesWs) {
    const rows = wsToRows(scenesWs);
    const [header, ...dataRows] = rows;
    const col = (name: string) => header.indexOf(name);

    for (const row of dataRows) {
      if (!row.length) continue;
      const sceneId = String(row[col('scene_id')] ?? '').trim();
      const slugVal = String(row[col('slug')] ?? '').trim();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scene: any = sceneId
        ? (proj.scenes ?? []).find((s: any) => s.id === sceneId)
        : (proj.scenes ?? []).find((s: any) => s.slug === slugVal);
      if (!scene) continue;

      const label: string = scene.title?.[defaultLang] ?? scene.title?.en ?? scene.slug;

      // GPS — try both column name conventions
      const latStr = String(row[col('gps_lat')] ?? row[col('lat')] ?? '').trim();
      const lngStr = String(row[col('gps_lng')] ?? row[col('lng')] ?? '').trim();
      if (latStr || lngStr) {
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        if (isNaN(lat) || lat < -90 || lat > 90) {
          validationErrors.push({ entityLabel: label, field: 'gps_lat', value: latStr, message: 'Latitude must be a number between -90 and 90.' });
        } else if (isNaN(lng) || lng < -180 || lng > 180) {
          validationErrors.push({ entityLabel: label, field: 'gps_lng', value: lngStr, message: 'Longitude must be a number between -180 and 180.' });
        } else {
          const altStr = String(row[col('altitude')] ?? '').trim();
          const alt = parseFloat(altStr);
          const newGeo = { lat, lng, ...(isNaN(alt) ? {} : { altitude: alt }) };
          const oldGeo = scene.geo;
          const oldDisplay = oldGeo?.lat != null ? `${Number(oldGeo.lat).toFixed(5)}, ${Number(oldGeo.lng).toFixed(5)}` : '—';
          const newDisplay = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          pushChange('scene', scene.id, label, 'geo', oldDisplay, newDisplay, newGeo);
        }
      }

      // Heading
      const headingStr = String(row[col('heading')] ?? '').trim();
      if (headingStr) {
        const headingNum = parseFloat(headingStr);
        if (isNaN(headingNum)) {
          validationErrors.push({ entityLabel: label, field: 'heading', value: headingStr, message: 'Heading must be a number (0–360).' });
        } else {
          const normalized = ((headingNum % 360) + 360) % 360;
          pushChange('scene', scene.id, label, 'heading',
            scene.heading != null ? `${Number(scene.heading).toFixed(1)}°` : '—',
            `${normalized.toFixed(1)}°`, normalized,
          );
        }
      }

      // Capture height (legacy column — skip gracefully if absent)
      const capHStr = String(row[col('capture_height')] ?? '').trim();
      if (capHStr) {
        const capH = parseFloat(capHStr);
        if (isNaN(capH) || capH <= 0) {
          validationErrors.push({ entityLabel: label, field: 'capture_height', value: capHStr, message: 'Capture height must be a positive number (meters).' });
        } else {
          pushChange('scene', scene.id, label, 'captureHeightMeters',
            scene.captureHeightMeters != null ? `${scene.captureHeightMeters}m` : '—',
            `${capH}m`, capH,
          );
        }
      }

      // Visibility radius
      const vrStr = String(row[col('visibility_radius')] ?? '').trim();
      if (vrStr) {
        const vr = parseFloat(vrStr);
        if (isNaN(vr) || vr < 0) {
          validationErrors.push({ entityLabel: label, field: 'visibility_radius', value: vrStr, message: 'Visibility radius must be a positive number.' });
        } else if (vr !== (scene.visibilityRadius ?? 0) || scene.visibilityRadius == null) {
          pushChange('scene', scene.id, label, 'visibilityRadius',
            scene.visibilityRadius != null ? String(scene.visibilityRadius) : '—',
            String(vr), vr,
          );
        }
      }

      // Category slugs (separator: ; or ,)
      const catSlugsStr = String(row[col('category_slugs')] ?? '').trim();
      if (catSlugsStr) {
        const slugArr = catSlugsStr.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ids = slugArr.map((sl: string) => (proj.categories ?? []).find((c: any) => c.slug === sl)?.id).filter(Boolean) as string[];
        const badSlugs = slugArr.filter((sl: string) => !(proj.categories ?? []).find((c: any) => c.slug === sl));
        if (badSlugs.length > 0) {
          validationErrors.push({ entityLabel: label, field: 'category_slugs', value: catSlugsStr, message: `Unknown category slugs: ${badSlugs.join(', ')}` });
        }
        if (ids.length > 0) {
          const oldIds: string[] = scene.categoryIds ?? [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const oldDisplay = oldIds.map((id: string) => (proj.categories ?? []).find((c: any) => c.id === id)?.slug ?? id).join(';') || '—';
          const newDisplay = ids.map((id: string) => (proj.categories ?? []).find((c: any) => c.id === id)?.slug ?? id).join(';');
          pushChange('scene', scene.id, label, 'categoryIds', oldDisplay, newDisplay, ids);
        }
      }

      // Localized fields
      for (const l of langs) {
        const titleVal = String(row[col(`title_${l}`)] ?? '').trim();
        if (titleVal && titleVal !== (scene.title?.[l] ?? '')) {
          pushChange('scene', scene.id, label, `title.${l}`, scene.title?.[l] || '—', titleVal, titleVal);
        }
        const descVal = String(row[col(`description_${l}`)] ?? '').trim();
        if (descVal && descVal !== (scene.description?.[l] ?? '')) {
          pushChange('scene', scene.id, label, `description.${l}`, scene.description?.[l] || '—', descVal, descVal);
        }
        // Support both column name conventions for alt text
        const altVal = String(row[col(`altText_${l}`)] ?? row[col(`alt_text_${l}`)] ?? '').trim();
        if (altVal && altVal !== (scene.altText?.[l] ?? '')) {
          pushChange('scene', scene.id, label, `altText.${l}`, scene.altText?.[l] || '—', altVal, altVal);
        }
      }
    }
  }

  // ── Parse Categories sheet ──
  const catsWs = wb.getWorksheet('Categories');
  if (catsWs) {
    const rows = wsToRows(catsWs);
    const [header, ...dataRows] = rows;
    const col = (name: string) => header.indexOf(name);

    for (const row of dataRows) {
      if (!row.length) continue;
      const slugVal = String(row[col('slug')] ?? '').trim();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cat: any = (proj.categories ?? []).find((c: any) => c.slug === slugVal);
      if (!cat) continue;

      const label: string = cat.name?.[defaultLang] ?? cat.name?.en ?? cat.slug;

      const colorVal = String(row[col('color')] ?? '').trim();
      if (colorVal) {
        if (!/^#[0-9a-fA-F]{6}$/.test(colorVal)) {
          validationErrors.push({ entityLabel: label, field: 'color', value: colorVal, message: 'Color must be in #RRGGBB format (e.g. #FF5500).' });
        } else {
          pushChange('category', cat.id, label, 'color', cat.color || '—', colorVal, colorVal);
        }
      }

      for (const l of langs) {
        const nameVal = String(row[col(`name_${l}`)] ?? '').trim();
        if (nameVal && nameVal !== (cat.name?.[l] ?? '')) {
          pushChange('category', cat.id, label, `name.${l}`, cat.name?.[l] || '—', nameVal, nameVal);
        }
      }
    }
  }

  // ── Parse Pages sheet ──
  const pagesWs = wb.getWorksheet('Pages');
  if (pagesWs) {
    const rows = wsToRows(pagesWs);
    const [header, ...dataRows] = rows;
    const col = (name: string) => header.indexOf(name);

    for (const row of dataRows) {
      if (!row.length) continue;
      const idVal   = String(row[col('id')]   ?? '').trim();
      const slugVal = String(row[col('slug')] ?? '').trim();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page: any = idVal
        ? (proj.pages ?? []).find((p: any) => p.id === idVal)
        : (proj.pages ?? []).find((p: any) => p.slug === slugVal);
      if (!page) continue;

      const label: string = page.title?.[defaultLang] ?? page.title?.en ?? page.slug;

      const enabledStr = String(row[col('enabled')] ?? '').trim().toLowerCase();
      if (enabledStr) {
        if (enabledStr !== 'true' && enabledStr !== 'false') {
          validationErrors.push({ entityLabel: label, field: 'enabled', value: enabledStr, message: 'Must be "true" or "false".' });
        } else {
          const newV = enabledStr === 'true';
          if (newV !== page.enabled) pushChange('page', page.id, label, 'enabled', String(page.enabled ?? false), enabledStr, newV);
        }
      }

      const footerStr = String(row[col('show_in_footer')] ?? '').trim().toLowerCase();
      if (footerStr) {
        if (footerStr !== 'true' && footerStr !== 'false') {
          validationErrors.push({ entityLabel: label, field: 'show_in_footer', value: footerStr, message: 'Must be "true" or "false".' });
        } else {
          const newV = footerStr === 'true';
          if (newV !== page.showInFooter) pushChange('page', page.id, label, 'showInFooter', String(page.showInFooter ?? false), footerStr, newV);
        }
      }

      const orderStr = String(row[col('order')] ?? '').trim();
      if (orderStr) {
        const orderNum = parseInt(orderStr, 10);
        if (isNaN(orderNum)) {
          validationErrors.push({ entityLabel: label, field: 'order', value: orderStr, message: 'Order must be a whole number.' });
        } else if (orderNum !== page.order) {
          pushChange('page', page.id, label, 'order', String(page.order ?? '—'), String(orderNum), orderNum);
        }
      }

      for (const l of langs) {
        const titleVal = String(row[col(`title_${l}`)] ?? '').trim();
        if (titleVal && titleVal !== (page.title?.[l] ?? '')) {
          pushChange('page', page.id, label, `title.${l}`, page.title?.[l] || '—', titleVal, titleVal);
        }
        const contentVal = String(row[col(`content_${l}`)] ?? '').trim();
        if (contentVal && contentVal !== (page.content?.[l] ?? '')) {
          const oldSnip = page.content?.[l] ? `${String(page.content[l]).slice(0, 60)}…` : '—';
          const newSnip = `${contentVal.slice(0, 60)}…`;
          pushChange('page', page.id, label, `content.${l}`, oldSnip, newSnip, contentVal);
        }
      }
    }
  }

  // ── Parse Analytics sheet ──
  const analyticsWs = wb.getWorksheet('Analytics');
  if (analyticsWs) {
    const rows = wsToRows(analyticsWs);
    const headerRow = rows[0];
    if (headerRow) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cur: any = proj.analytics ?? {};
      const evKeys = [
        'scene_view', 'scene_change', 'tour_started', 'tour_completed',
        'hotspot_click', 'link_hotspot_click', 'external_link_click',
        'info_hotspot_open', 'video_play', 'form_open', 'form_submit',
        'map_open', 'map_marker_click', 'share_click', 'language_change',
        'cookie_accepted', 'info_panel_open', 'fullscreen_enter',
      ] as const;

      function parseAnalyticsBool(key: string, projKey: string, val: string) {
        const v = val.toLowerCase();
        if (v !== 'true' && v !== 'false') return;
        const newV = v === 'true';
        if (newV !== cur[projKey]) pushChange('analytics', 'analytics', 'Analytics', projKey, String(cur[projKey] ?? false), v, newV);
      }

      if (headerRow[0] === 'setting') {
        // Key/value format (export-styled): rows of [setting, value]
        const kvMap: Record<string, string> = {};
        for (let i = 1; i < rows.length; i++) {
          const k = String(rows[i][0] ?? '').trim();
          const v = String(rows[i][1] ?? '').trim();
          if (k) kvMap[k] = v;
        }
        parseAnalyticsBool('enabled', 'enabled', kvMap['enabled'] ?? '');
        const midStr = kvMap['measurement_id'] ?? '';
        if (midStr && midStr !== (cur.measurementId ?? '')) {
          if (!/^G-[A-Z0-9]+$/.test(midStr)) validationErrors.push({ entityLabel: 'Analytics', field: 'measurement_id', value: midStr, message: 'Measurement ID should start with "G-" followed by uppercase letters/numbers.' });
          pushChange('analytics', 'analytics', 'Analytics', 'measurementId', cur.measurementId || '—', midStr, midStr);
        }
        parseAnalyticsBool('anonymizeIp', 'anonymizeIp', kvMap['anonymize_ip'] ?? '');
        parseAnalyticsBool('respectCookieConsent', 'respectCookieConsent', kvMap['respect_cookie_consent'] ?? '');
        for (const k of evKeys) {
          const evStr = (kvMap[`event_${k}`] ?? '').toLowerCase();
          if (evStr !== 'true' && evStr !== 'false') continue;
          const newV = evStr === 'true';
          const oldV: boolean = cur.events?.[k] ?? false;
          if (newV !== oldV) pushChange('analytics', 'analytics', 'Analytics', `events.${k}`, String(oldV), evStr, newV);
        }
      } else {
        // Columnar format (backward compat with old export)
        const aRow = rows[1];
        if (aRow) {
          const col = (name: string) => headerRow.indexOf(name);
          parseAnalyticsBool('enabled', 'enabled', String(aRow[col('enabled')] ?? ''));
          const midStr = String(aRow[col('measurement_id')] ?? '').trim();
          if (midStr && midStr !== (cur.measurementId ?? '')) {
            if (!/^G-[A-Z0-9]+$/.test(midStr)) validationErrors.push({ entityLabel: 'Analytics', field: 'measurement_id', value: midStr, message: 'Measurement ID should start with "G-" followed by uppercase letters/numbers.' });
            pushChange('analytics', 'analytics', 'Analytics', 'measurementId', cur.measurementId || '—', midStr, midStr);
          }
          parseAnalyticsBool('anonymizeIp', 'anonymizeIp', String(aRow[col('anonymize_ip')] ?? ''));
          parseAnalyticsBool('respectCookieConsent', 'respectCookieConsent', String(aRow[col('respect_cookie_consent')] ?? ''));
          for (const k of evKeys) {
            const idx = col(`ev_${k}`);
            if (idx < 0) continue;
            const evStr = String(aRow[idx] ?? '').toLowerCase();
            if (evStr !== 'true' && evStr !== 'false') continue;
            const newV = evStr === 'true';
            const oldV: boolean = cur.events?.[k] ?? false;
            if (newV !== oldV) pushChange('analytics', 'analytics', 'Analytics', `events.${k}`, String(oldV), evStr, newV);
          }
        }
      }
    }
  }

  // ── Parse Project sheet ──
  const projMetaWs = wb.getWorksheet('Project');
  if (projMetaWs) {
    const rows = wsToRows(projMetaWs);
    const [header, dataRow] = rows;
    if (header && dataRow) {
      const col = (name: string) => header.indexOf(name);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cur: any = proj.meta ?? {};

      function pushMeta(excelKey: string, projKey: string, isUrl = false) {
        const val = String(dataRow[col(excelKey)] ?? '').trim();
        const old = String(cur[projKey] ?? '');
        if (val === old) return;
        if (isUrl && val && !val.includes('://')) {
          validationErrors.push({ entityLabel: 'Project', field: excelKey, value: val, message: 'URL must contain "://".' });
          return;
        }
        pushChange('project', 'meta', 'Project', projKey, old || '—', val || '(cleared)', val);
      }

      pushMeta('name', 'name');
      pushMeta('creator', 'creator');
      pushMeta('contact_email', 'contactEmail');
      pushMeta('copyright', 'copyright');
      pushMeta('publication_url', 'publicationUrl', true);
      pushMeta('short_description', 'shortDescription');
    }
  }

  // ── Parse Modules sheet ──
  const modsWs = wb.getWorksheet('Modules');
  if (modsWs) {
    const rows = wsToRows(modsWs);
    const [headerRow, ...kvRows] = rows;
    if (headerRow?.[0] === 'key') {
      const kvMap: Record<string, string> = {};
      for (const row of kvRows) {
        const k = String(row[0] ?? '').trim();
        const v = String(row[1] ?? '').trim();
        if (k) kvMap[k] = v;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cur: any = proj.modules ?? {};

      const boolModules: [string, string][] = [
        ['vr', 'vr'], ['gyroscope', 'gyroscope'], ['fullscreen', 'fullscreen'],
        ['forms_enabled', 'formsEnabled'], ['cookie_consent', 'cookieConsent'],
      ];
      for (const [excelKey, projKey] of boolModules) {
        const v = (kvMap[excelKey] ?? '').toLowerCase();
        if (v !== 'true' && v !== 'false') continue;
        const newV = v === 'true';
        if (newV !== !!cur[projKey]) pushChange('modules', 'modules', 'Modules', projKey, String(!!cur[projKey]), v, newV);
      }

      const textModules: [string, string][] = [
        ['feedback_mailto', 'feedbackMailto'],
      ];
      for (const [excelKey, projKey] of textModules) {
        const val = kvMap[excelKey] ?? '';
        const old = cur[projKey] ?? '';
        if (val !== old) pushChange('modules', 'modules', 'Modules', projKey, old || '—', val || '(cleared)', val);
      }
    }
  }

  // ── Parse AI Context sheet ──
  const aiWs = wb.getWorksheet('AI Context');
  if (aiWs) {
    const rows = wsToRows(aiWs);
    const [headerRow, ...kvRows] = rows;
    if (headerRow?.[0] === 'setting') {
      const kvMap: Record<string, string> = {};
      for (const row of kvRows) {
        const k = String(row[0] ?? '').trim();
        const v = String(row[1] ?? '').trim();
        if (k) kvMap[k] = v;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cur: any = proj.aiContext ?? {};

      const listFields: [string, string, string[]][] = [
        ['tone', 'tone', ['marketing', 'factual', 'storytelling', 'poetic', 'educational']],
        ['audience', 'audience', ['general', 'professional', 'luxury', 'youth', 'family', 'senior']],
        ['length', 'length', ['short', 'medium', 'long']],
      ];
      for (const [excelKey, projKey, allowed] of listFields) {
        const val = kvMap[excelKey] ?? '';
        if (!val || val === (cur[projKey] ?? '')) continue;
        if (!allowed.includes(val)) {
          validationErrors.push({ entityLabel: 'AI Context', field: excelKey, value: val, message: `Must be one of: ${allowed.join(', ')}` });
        } else {
          pushChange('ai_context', 'ai_context', 'AI Context', projKey, cur[projKey] || '—', val, val);
        }
      }

      const textFields: [string, string][] = [
        ['theme', 'theme'], ['custom_instructions', 'customInstructions'], ['project_context', 'projectContext'],
      ];
      for (const [excelKey, projKey] of textFields) {
        const val = kvMap[excelKey] ?? '';
        const old = String(cur[projKey] ?? '');
        if (val === old) continue;
        const oldSnip = old ? `${old.slice(0, 60)}…` : '—';
        const newSnip = val ? `${val.slice(0, 60)}…` : '(cleared)';
        pushChange('ai_context', 'ai_context', 'AI Context', projKey, oldSnip, newSnip, val);
      }
    }
  }

  // ── Parse Hotspots sheet ──
  const hotspotsWs = wb.getWorksheet('Hotspots');
  if (hotspotsWs) {
    const rows = wsToRows(hotspotsWs);
    const [header, ...dataRows] = rows;
    const col = (name: string) => header.indexOf(name);

    for (const row of dataRows) {
      if (!row.length) continue;
      const hotspotId = String(row[col('id')] ?? '').trim();
      const sceneSlugVal = String(row[col('scene_slug')] ?? '').trim();
      if (!hotspotId || !sceneSlugVal) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scene: any = (proj.scenes ?? []).find((s: any) => s.slug === sceneSlugVal);
      if (!scene) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hotspot: any = (scene.hotspots ?? []).find((h: any) => h.id === hotspotId);
      if (!hotspot) continue;

      const hTitle = hotspot.title?.[defaultLang] ?? hotspot.title?.en ?? '';
      const label = hTitle ? `${sceneSlugVal} / ${hTitle}` : `${sceneSlugVal} / ${hotspotId.slice(0, 8)}`;

      // ath
      const athStr = String(row[col('ath')] ?? '').trim();
      if (athStr) {
        const ath = parseFloat(athStr);
        if (isNaN(ath) || ath < -180 || ath > 180) {
          validationErrors.push({ entityLabel: label, field: 'ath', value: athStr, message: 'Horizontal angle (ath) must be between -180 and 180.' });
        } else if (Math.abs(ath - (hotspot.ath ?? 0)) > 0.001) {
          pushChange('hotspot', hotspotId, label, 'ath', `${hotspot.ath}°`, `${ath}°`, ath, scene.id);
        }
      }

      // atv
      const atvStr = String(row[col('atv')] ?? '').trim();
      if (atvStr) {
        const atv = parseFloat(atvStr);
        if (isNaN(atv) || atv < -90 || atv > 90) {
          validationErrors.push({ entityLabel: label, field: 'atv', value: atvStr, message: 'Vertical angle (atv) must be between -90 and 90.' });
        } else if (Math.abs(atv - (hotspot.atv ?? 0)) > 0.001) {
          pushChange('hotspot', hotspotId, label, 'atv', `${hotspot.atv}°`, `${atv}°`, atv, scene.id);
        }
      }

      // target_scene_slug → targetSceneId
      if (col('target_scene_slug') >= 0) {
        const targetSlugStr = String(row[col('target_scene_slug')] ?? '').trim();
        if (targetSlugStr) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const targetScene: any = (proj.scenes ?? []).find((s: any) => s.slug === targetSlugStr);
          if (!targetScene) {
            validationErrors.push({ entityLabel: label, field: 'target_scene_slug', value: targetSlugStr, message: `Scene "${targetSlugStr}" not found in this project.` });
          } else if (targetScene.id !== (hotspot.targetSceneId ?? '')) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const oldSlug = (proj.scenes ?? []).find((s: any) => s.id === hotspot.targetSceneId)?.slug ?? hotspot.targetSceneId ?? '—';
            pushChange('hotspot', hotspotId, label, 'targetSceneId', oldSlug, targetSlugStr, targetScene.id, scene.id);
          }
        } else if (!targetSlugStr && hotspot.targetSceneId) {
          // Explicitly cleared
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const oldSlug = (proj.scenes ?? []).find((s: any) => s.id === hotspot.targetSceneId)?.slug ?? '—';
          pushChange('hotspot', hotspotId, label, 'targetSceneId', oldSlug, '(cleared)', null, scene.id);
        }
      }

      // url
      const urlStr = String(row[col('url')] ?? '').trim();
      if (col('url') >= 0 && urlStr !== (hotspot.url ?? '')) {
        if (urlStr && (!urlStr.includes('://') || urlStr.length <= 8)) {
          validationErrors.push({ entityLabel: label, field: 'url', value: urlStr, message: 'URL must contain "://" and be at least 9 characters (e.g. https://example.com).' });
        } else {
          pushChange('hotspot', hotspotId, label, 'url', hotspot.url || '—', urlStr || '(cleared)', urlStr, scene.id);
        }
      }

      // Localized title, body
      for (const l of langs) {
        const titleVal = String(row[col(`title_${l}`)] ?? '').trim();
        if (titleVal && titleVal !== (hotspot.title?.[l] ?? '')) {
          pushChange('hotspot', hotspotId, label, `title.${l}`, hotspot.title?.[l] || '—', titleVal, titleVal, scene.id);
        }
        const bodyVal = String(row[col(`body_${l}`)] ?? '').trim();
        if (bodyVal && bodyVal !== (hotspot.body?.[l] ?? '')) {
          const oldSnip = hotspot.body?.[l] ? `${String(hotspot.body[l]).slice(0, 60)}…` : '—';
          pushChange('hotspot', hotspotId, label, `body.${l}`, oldSnip, `${bodyVal.slice(0, 60)}…`, bodyVal, scene.id);
        }
      }
    }
  }

  return { canceled: false, changes, validationErrors };
  } catch (parseErr: unknown) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    return { canceled: false, changes: [], validationErrors: [], error: `Import failed: ${msg}` };
  }
});

// ── Git commit ────────────────────────────────────────────────────────────────

ipcMain.handle('project:git-commit', async (_e, projectDir: string, message: string) => {
  try {
    execFileSync('git', ['-C', projectDir, 'add', '-A'], { timeout: 10_000 });
    const out = execFileSync('git', ['-C', projectDir, 'commit', '-m', message], { timeout: 10_000 });
    const sha = out.toString().match(/\[[\w /]+\s+([a-f0-9]+)\]/)?.[1];
    return { ok: true, sha };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ── Excel full export (exceljs styled) ───────────────────────────────────────

function applyHeaderRow(ws: ExcelJS.Worksheet, headerRow: ExcelJS.Row) {
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 20;
  // Lock header cells — they stay protected even when sheet is protected
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.protection = { locked: true, hidden: false };
  });
}

// ── Validation helpers ────────────────────────────────────────────────────────

const BOOL_VALIDATION: ExcelJS.DataValidation = {
  type: 'list',
  allowBlank: false,
  formulae: ['"true,false"'],
  showErrorMessage: true,
  errorStyle: 'stop',
  errorTitle: 'Invalid value',
  error: 'Only "true" or "false" are accepted.',
};

function decimalValidation(min: number, max: number, title: string, msg: string): ExcelJS.DataValidation {
  return {
    type: 'decimal',
    operator: 'between',
    allowBlank: true,
    formulae: [min, max],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: title,
    error: msg,
  };
}

function listValidation(values: string[]): ExcelJS.DataValidation {
  return {
    type: 'list',
    allowBlank: false,
    formulae: [`"${values.join(',')}"`],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: 'Invalid value',
    error: `Allowed: ${values.join(', ')}`,
  };
}

function slugValidationFor(addr: string): ExcelJS.DataValidation {
  return {
    type: 'custom',
    allowBlank: true,
    formulae: [`AND(EXACT(${addr},LOWER(${addr})),ISERROR(FIND(" ",${addr})),ISERROR(FIND(".",${addr})),LEN(${addr})>=2,LEN(${addr})<=50)`],
    showErrorMessage: true,
    errorStyle: 'warning',
    errorTitle: 'Invalid slug',
    error: 'Lowercase only, no spaces or dots, 2–50 chars (a-z 0-9 - _)',
  };
}

function colorValidationFor(addr: string): ExcelJS.DataValidation {
  return {
    type: 'custom',
    allowBlank: true,
    formulae: [`AND(LEN(${addr})=7,LEFT(${addr},1)="#")`],
    showErrorMessage: true,
    errorStyle: 'warning',
    errorTitle: 'Invalid color',
    error: 'Must be a hex color in #RRGGBB format (e.g. #3B82F6)',
  };
}

function urlValidationFor(addr: string): ExcelJS.DataValidation {
  return {
    type: 'custom',
    allowBlank: true,
    formulae: [`OR(${addr}="",AND(LEN(${addr})>8,ISNUMBER(SEARCH("://",${addr}))))`],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: 'Invalid URL',
    error: 'URL must contain "://" and be at least 9 characters (e.g. https://example.com).',
  };
}

function noSpacesValidationFor(addr: string): ExcelJS.DataValidation {
  return {
    type: 'custom',
    allowBlank: true,
    formulae: [`ISERROR(FIND(" ",${addr}))`],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: 'No spaces allowed',
    error: 'No spaces allowed. Separate multiple values with semicolons (;).',
  };
}

/** Column config for finalizeSheet. Keys match ws.columns[*].key */
type ColCfg = {
  locked?: boolean;         // keep this column read-only
  bool?: boolean;           // true/false list
  decimal?: [number, number, string, string]; // [min, max, title, msg]
  list?: string[];          // list of allowed values
  slug?: boolean;           // slug custom formula (per cell)
  color?: boolean;          // hex color custom formula (per cell)
  url?: boolean;            // URL format validation
  noSpaces?: boolean;       // no spaces allowed (for semicolon-separated fields)
};

/** Protect a key-value sheet where cells were already set locked/unlocked per-row. */
async function ws_protectKv(ws: ExcelJS.Worksheet) {
  await ws.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    deleteColumns: false,
    deleteRows: false,
    sort: true,
    autoFilter: true,
  });
}

async function finalizeSheet(ws: ExcelJS.Worksheet, cfg: Record<string, ColCfg>) {
  const colCount = ws.columnCount;
  const rowCount = ws.rowCount;

  for (let r = 2; r <= rowCount; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= colCount; c++) {
      const colKey = ws.getColumn(c).key as string | undefined;
      const cell = row.getCell(c);
      const colCfg = colKey ? (cfg[colKey] ?? {}) : {};

      // Protection: locked columns stay locked, all others unlocked for editing
      cell.protection = { locked: colCfg.locked === true, hidden: false };

      // Apply validation
      if (colCfg.bool) {
        cell.dataValidation = BOOL_VALIDATION;
      } else if (colCfg.decimal) {
        const [min, max, title, msg] = colCfg.decimal;
        cell.dataValidation = decimalValidation(min, max, title, msg);
      } else if (colCfg.list) {
        cell.dataValidation = listValidation(colCfg.list);
      } else if (colCfg.slug) {
        cell.dataValidation = slugValidationFor(cell.address);
      } else if (colCfg.color) {
        cell.dataValidation = colorValidationFor(cell.address);
      } else if (colCfg.url) {
        cell.dataValidation = urlValidationFor(cell.address);
      } else if (colCfg.noSpaces) {
        cell.dataValidation = noSpacesValidationFor(cell.address);
      }
    }
  }

  await ws.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    deleteColumns: false,
    deleteRows: false,
    sort: true,
    autoFilter: true,
  });
}

ipcMain.handle('excel:export-styled', async (_e, projectData: unknown) => {
  const result = await dialog.showSaveDialog({
    title: 'Export project to Excel',
    defaultPath: 'conchitour-project.xlsx',
    filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proj = projectData as any;
  const langs: string[] = proj.languages?.available ?? ['en'];
  const defaultLang: string = proj.languages?.default ?? 'en';
  const scenes = (proj.scenes ?? []) as Record<string, unknown>[];
  const categories = (proj.categories ?? []) as Record<string, unknown>[];
  const hotspots: { sceneSlug: string; h: Record<string, unknown> }[] = [];
  for (const sc of scenes) {
    for (const h of ((sc.hotspots ?? []) as Record<string, unknown>[])) {
      hotspots.push({ sceneSlug: sc.slug as string, h });
    }
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Conchitour';
  wb.created = new Date();

  const generatedBy = `Generated by Conchitour on ${new Date().toISOString().split('T')[0]}`;

  // ── Sheet: Project ──────────────────────────────────────────────────────
  const wsPrj = wb.addWorksheet('Project', { tabColor: { argb: 'FF185FA5' } });
  wsPrj.columns = [
    { header: 'name', key: 'name', width: 30 },
    { header: 'creator', key: 'creator', width: 25 },
    { header: 'contact_email', key: 'contact_email', width: 30 },
    { header: 'copyright', key: 'copyright', width: 30 },
    { header: 'publication_url', key: 'publication_url', width: 35 },
    { header: 'short_description', key: 'short_description', width: 40 },
    { header: 'default_language', key: 'default_language', width: 16 },
    { header: 'available_languages', key: 'available_languages', width: 20 },
  ];
  applyHeaderRow(wsPrj, wsPrj.getRow(1));
  wsPrj.addRow({
    name: proj.meta?.name ?? '',
    creator: proj.meta?.creator ?? '',
    contact_email: proj.meta?.contactEmail ?? '',
    copyright: proj.meta?.copyright ?? '',
    publication_url: proj.meta?.publicationUrl ?? '',
    short_description: proj.meta?.shortDescription ?? '',
    default_language: defaultLang,
    available_languages: langs.join(', '),
  });
  wsPrj.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Sheet: Scenes ────────────────────────────────────────────────────────
  const wsScn = wb.addWorksheet('Scenes', { tabColor: { argb: 'FF1D9E75' } });
  const scnCols: Partial<ExcelJS.Column>[] = [
    { header: 'slug', key: 'slug', width: 22 },
    { header: 'heading', key: 'heading', width: 10 },
    { header: 'gps_lat', key: 'gps_lat', width: 12 },
    { header: 'gps_lng', key: 'gps_lng', width: 12 },
    { header: 'category_slugs', key: 'category_slugs', width: 22 },
    { header: 'visibility_radius', key: 'visibility_radius', width: 16 },
    ...langs.flatMap((l) => [
      { header: `title_${l}`, key: `title_${l}`, width: 28 },
      { header: `description_${l}`, key: `description_${l}`, width: 40 },
      { header: `altText_${l}`, key: `altText_${l}`, width: 35 },
    ]),
  ];
  wsScn.columns = scnCols;
  applyHeaderRow(wsScn, wsScn.getRow(1));
  for (const s of scenes) {
    const geo = s.geo as Record<string, number> | undefined;
    const catSlugs = ((s.categoryIds ?? []) as string[])
      .map((id) => categories.find((c) => c.id === id)?.slug ?? id)
      .join(';');
    const row: Record<string, unknown> = {
      slug: s.slug ?? '',
      heading: s.heading ?? 0,
      gps_lat: geo?.lat ?? '',
      gps_lng: geo?.lng ?? '',
      category_slugs: catSlugs,
      visibility_radius: s.visibilityRadius ?? '',
    };
    for (const l of langs) {
      row[`title_${l}`] = (s.title as Record<string, string>)?.[l] ?? '';
      row[`description_${l}`] = (s.description as Record<string, string>)?.[l] ?? '';
      row[`altText_${l}`] = (s.altText as Record<string, string>)?.[l] ?? '';
    }
    const added = wsScn.addRow(row);
    // Conditional formatting: highlight empty default title in light red
    const titleCol = `title_${defaultLang}`;
    const titleCell = added.getCell(titleCol);
    if (!titleCell.value) {
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    }
  }
  wsScn.views = [{ state: 'frozen', ySplit: 1 }];
  await finalizeSheet(wsScn, {
    slug:              { slug: true },
    heading:           { decimal: [0, 360, 'Invalid heading', 'Heading must be 0–360 degrees.'] },
    gps_lat:           { decimal: [-90, 90, 'Invalid GPS latitude', 'Latitude must be between -90 and 90.'] },
    gps_lng:           { decimal: [-180, 180, 'Invalid GPS longitude', 'Longitude must be between -180 and 180.'] },
    category_slugs:    { noSpaces: true },
    visibility_radius: { decimal: [0, 999999, 'Invalid radius', 'Visibility radius must be a positive number.'] },
    ...Object.fromEntries(langs.flatMap((l) => [
      [`title_${l}`,       {}],
      [`description_${l}`, {}],
      [`altText_${l}`,     {}],
    ])),
  });

  // Inline list validation for target_scene_slug dropdown.
  // Cross-sheet references (e.g. _Lookups!$A$2:$A$N) cause SheetJS to fail on re-import
  // because ExcelJS writes them in extLst XML which SheetJS cannot parse.
  // Instead: build a comma-separated string; fall back to slug-format if too long.
  const sceneSlugList = scenes.map((s) => String(s.slug ?? '')).filter(Boolean);
  const sceneSlugFormula = sceneSlugList.length > 0 ? `"${sceneSlugList.join(',')}"` : null;
  const targetSceneCfg: ColCfg = sceneSlugFormula && sceneSlugFormula.length <= 253
    ? { list: sceneSlugList }
    : sceneSlugList.length > 0
      ? { slug: true }  // too many scenes for inline list; validate slug format at least
      : {};

  // ── Sheet: Hotspots ──────────────────────────────────────────────────────
  const wsHs = wb.addWorksheet('Hotspots', { tabColor: { argb: 'FF8B5CF6' } });
  wsHs.columns = [
    { header: 'scene_slug', key: 'scene_slug', width: 22 },
    { header: 'id', key: 'id', width: 36 },
    { header: 'type', key: 'type', width: 10 },
    { header: 'ath', key: 'ath', width: 8 },
    { header: 'atv', key: 'atv', width: 8 },
    { header: 'target_scene_slug', key: 'target_scene_slug', width: 22 },
    { header: 'url', key: 'url', width: 40 },
    ...langs.flatMap((l) => [
      { header: `title_${l}`, key: `title_${l}`, width: 28 },
      { header: `body_${l}`, key: `body_${l}`, width: 35 },
    ]),
  ];
  applyHeaderRow(wsHs, wsHs.getRow(1));
  for (const { sceneSlug, h } of hotspots) {
    const row: Record<string, unknown> = {
      scene_slug: sceneSlug,
      id: h.id ?? '',
      type: h.type ?? '',
      ath: h.ath ?? 0,
      atv: h.atv ?? 0,
      target_scene_slug: (h as Record<string, unknown>).targetSceneId
        ? (scenes.find((s) => s.id === (h as Record<string, unknown>).targetSceneId)?.slug ?? '')
        : '',
      url: (h as Record<string, unknown>).url ?? '',
    };
    for (const l of langs) {
      row[`title_${l}`] = (h.title as Record<string, string>)?.[l] ?? '';
      row[`body_${l}`] = (h.body as Record<string, string>)?.[l] ?? '';
    }
    wsHs.addRow(row);
  }
  wsHs.views = [{ state: 'frozen', ySplit: 1 }];
  await finalizeSheet(wsHs, {
    scene_slug:        { locked: true },   // read-only: identifies which scene the hotspot belongs to
    id:                { locked: true },
    type:              { list: ['link', 'text', 'video', 'form'] },
    ath:               { decimal: [-180, 180, 'Invalid ath', 'Horizontal angle (ath) must be between -180 and 180.'] },
    atv:               { decimal: [-90, 90, 'Invalid atv', 'Vertical angle (atv) must be between -90 and 90.'] },
    target_scene_slug: targetSceneCfg,
    url:               { url: true },
    ...Object.fromEntries(langs.flatMap((l) => [
      [`title_${l}`, {}],
      [`body_${l}`,  {}],
    ])),
  });

  // ── Sheet: Categories ────────────────────────────────────────────────────
  const wsCat = wb.addWorksheet('Categories', { tabColor: { argb: 'FFBA7517' } });
  wsCat.columns = [
    { header: 'slug', key: 'slug', width: 22 },
    { header: 'color', key: 'color', width: 10 },
    { header: 'built_in', key: 'built_in', width: 10 },
    ...langs.map((l) => ({ header: `name_${l}`, key: `name_${l}`, width: 22 })),
  ];
  applyHeaderRow(wsCat, wsCat.getRow(1));
  for (const c of categories) {
    const row: Record<string, unknown> = {
      slug: c.slug ?? '',
      color: c.color ?? '',
      built_in: c.builtIn ? 'true' : 'false',
    };
    for (const l of langs) row[`name_${l}`] = (c.name as Record<string, string>)?.[l] ?? '';
    wsCat.addRow(row);
  }
  wsCat.views = [{ state: 'frozen', ySplit: 1 }];
  await finalizeSheet(wsCat, {
    slug:     { slug: true },
    color:    { color: true },
    built_in: { locked: true },
    ...Object.fromEntries(langs.map((l) => [`name_${l}`, {}])),
  });

  // ── Sheet: Pages ─────────────────────────────────────────────────────────
  const wsPages = wb.addWorksheet('Pages', { tabColor: { argb: 'FF3B82F6' } });
  wsPages.columns = [
    { header: 'slug', key: 'slug', width: 18 },
    { header: 'enabled', key: 'enabled', width: 10 },
    { header: 'show_in_footer', key: 'show_in_footer', width: 14 },
    { header: 'order', key: 'order', width: 8 },
    { header: 'built_in', key: 'built_in', width: 10 },
    ...langs.flatMap((l) => [
      { header: `title_${l}`, key: `title_${l}`, width: 28 },
      { header: `content_${l}`, key: `content_${l}`, width: 50 },
    ]),
  ];
  applyHeaderRow(wsPages, wsPages.getRow(1));
  for (const p of ((proj.pages ?? []) as Record<string, unknown>[])) {
    const row: Record<string, unknown> = {
      slug: p.slug ?? '',
      enabled: p.enabled ? 'true' : 'false',
      show_in_footer: p.showInFooter ? 'true' : 'false',
      order: p.order ?? 0,
      built_in: p.builtIn ?? '',
    };
    for (const l of langs) {
      row[`title_${l}`] = (p.title as Record<string, string>)?.[l] ?? '';
      row[`content_${l}`] = (p.content as Record<string, string>)?.[l] ?? '';
    }
    wsPages.addRow(row);
  }
  wsPages.views = [{ state: 'frozen', ySplit: 1 }];
  await finalizeSheet(wsPages, {
    slug:           { slug: true },
    enabled:        { bool: true },
    show_in_footer: { bool: true },
    order:          { decimal: [0, 999, 'Invalid order', 'Order must be a positive integer.'] },
    built_in:       { locked: true },
    ...Object.fromEntries(langs.flatMap((l) => [
      [`title_${l}`,   {}],
      [`content_${l}`, {}],
    ])),
  });

  // ── Sheet: Modules ───────────────────────────────────────────────────────
  const wsMod = wb.addWorksheet('Modules');
  wsMod.columns = [
    { header: 'key', key: 'key', width: 28 },
    { header: 'value', key: 'value', width: 40 },
  ];
  applyHeaderRow(wsMod, wsMod.getRow(1));
  const mods = (proj.modules ?? {}) as Record<string, unknown>;
  // Bool keys lock down to true/false list; others are free text
  const MOD_BOOL_KEYS = new Set(['vr', 'gyroscope', 'fullscreen', 'forms_enabled', 'cookie_consent']);
  const modEntries: [string, unknown][] = [
    ['vr', mods.vr],
    ['gyroscope', mods.gyroscope],
    ['fullscreen', mods.fullscreen],
    ['feedback_mailto', mods.feedbackMailto ?? ''],
    ['forms_enabled', mods.formsEnabled],
    ['cookie_consent', mods.cookieConsent ?? false],
  ];
  for (const [k, v] of modEntries) {
    const addedRow = wsMod.addRow({ key: k, value: String(v ?? '') });
    addedRow.getCell('key').protection = { locked: true, hidden: false };
    const valCell = addedRow.getCell('value');
    valCell.protection = { locked: false, hidden: false };
    if (MOD_BOOL_KEYS.has(k)) valCell.dataValidation = BOOL_VALIDATION;
  }
  wsMod.views = [{ state: 'frozen', ySplit: 1 }];
  await ws_protectKv(wsMod);

  // ── Sheet: Analytics ────────────────────────────────────────────────────
  const wsAna = wb.addWorksheet('Analytics');
  wsAna.columns = [
    { header: 'setting', key: 'setting', width: 32 },
    { header: 'value', key: 'value', width: 20 },
  ];
  applyHeaderRow(wsAna, wsAna.getRow(1));
  const ga = (proj.analytics ?? {}) as Record<string, unknown>;
  const gaEvents = (ga.events ?? {}) as Record<string, boolean>;
  const ANA_BOOL_SETTINGS = new Set(['enabled', 'anonymize_ip', 'respect_cookie_consent']);
  const anaRows: [string, string, boolean][] = [
    ['enabled', String(ga.enabled ?? 'false'), true],
    ['measurement_id', String(ga.measurementId ?? ''), false],
    ['anonymize_ip', String(ga.anonymizeIp ?? 'true'), true],
    ['respect_cookie_consent', String(ga.respectCookieConsent ?? 'true'), true],
    ...Object.entries(gaEvents).map(([k, v]) => [`event_${k}`, String(v), true] as [string, string, boolean]),
  ];
  for (const [setting, value, isBool] of anaRows) {
    const addedRow = wsAna.addRow({ setting, value });
    addedRow.getCell('setting').protection = { locked: true, hidden: false };
    const valCell = addedRow.getCell('value');
    valCell.protection = { locked: false, hidden: false };
    if (isBool) valCell.dataValidation = BOOL_VALIDATION;
  }
  wsAna.views = [{ state: 'frozen', ySplit: 1 }];
  await ws_protectKv(wsAna);

  // ── Sheet: AI Context ────────────────────────────────────────────────────
  const wsAi = wb.addWorksheet('AI Context');
  wsAi.columns = [
    { header: 'setting', key: 'setting', width: 28 },
    { header: 'value', key: 'value', width: 40 },
  ];
  applyHeaderRow(wsAi, wsAi.getRow(1));
  const aiCtx = (proj.aiContext ?? {}) as Record<string, unknown>;
  const AI_CTX_VALIDATIONS: Record<string, ExcelJS.DataValidation> = {
    tone:     listValidation(['marketing', 'factual', 'storytelling', 'poetic', 'educational']),
    audience: listValidation(['general', 'professional', 'luxury', 'youth', 'family', 'senior']),
    length:   listValidation(['short', 'medium', 'long']),
  };
  const aiCtxRows: [string, unknown][] = [
    ['tone', aiCtx.tone ?? 'marketing'],
    ['audience', aiCtx.audience ?? 'general'],
    ['theme', aiCtx.theme ?? 'Tourism'],
    ['length', aiCtx.length ?? 'medium'],
    ['custom_instructions', aiCtx.customInstructions ?? ''],
    ['project_context', aiCtx.projectContext ?? ''],
  ];
  for (const [setting, value] of aiCtxRows) {
    const addedRow = wsAi.addRow({ setting, value: String(value ?? '') });
    addedRow.getCell('setting').protection = { locked: true, hidden: false };
    const valCell = addedRow.getCell('value');
    valCell.protection = { locked: false, hidden: false };
    if (AI_CTX_VALIDATIONS[setting]) valCell.dataValidation = AI_CTX_VALIDATIONS[setting];
  }
  wsAi.views = [{ state: 'frozen', ySplit: 1 }];
  await ws_protectKv(wsAi);

  // ── Sheet: Notes ─────────────────────────────────────────────────────────
  const wsNotes = wb.addWorksheet('Notes');
  wsNotes.columns = [
    { header: 'scene_slug', key: 'scene_slug', width: 22 },
    { header: 'note', key: 'note', width: 80 },
  ];
  applyHeaderRow(wsNotes, wsNotes.getRow(1));
  for (const s of scenes) wsNotes.addRow({ scene_slug: s.slug ?? '', note: '' });
  wsNotes.views = [{ state: 'frozen', ySplit: 1 }];
  await finalizeSheet(wsNotes, {
    scene_slug: { locked: true },
    note:       {},
  });

  // ── Project sheet: unlock data row ───────────────────────────────────────
  await finalizeSheet(wsPrj, {
    name:                {},
    creator:             {},
    contact_email:       {},
    copyright:           {},
    publication_url:     {},
    short_description:   {},
    default_language:    {},
    available_languages: {},
  });

  // ── Footer comment on Project sheet ─────────────────────────────────────
  const footerCell = wsPrj.getCell(`A${wsPrj.rowCount + 2}`);
  footerCell.value = generatedBy;
  footerCell.font = { italic: true, color: { argb: 'FF94A3B8' }, size: 9 };

  try {
    await wb.xlsx.writeFile(result.filePath);
    return { canceled: false, path: result.filePath };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { canceled: false, error: msg };
  }
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

interface ConchitourSettings {
  krpanoPath: string;
  includeLicense: boolean;
  includeTestServer: boolean;
  useKrpanoTiles: boolean;
  lastOutputDir: string;
  licenseInfo?: { name?: string; email?: string; domain?: string; type?: string; validUntil?: string };
}

const DEFAULT_SETTINGS: ConchitourSettings = {
  krpanoPath: 'C:\\Users\\matth\\Documents\\krpano-dev\\krpano',
  includeLicense: false,
  includeTestServer: false,
  useKrpanoTiles: false,
  lastOutputDir: '',
};

async function readSettings(): Promise<ConchitourSettings> {
  const newPath = path.join(app.getPath('userData'), 'conchitour-settings.json');
  const oldPath = path.join(app.getPath('userData'), 'conchitect-settings.json');
  // One-shot migration: copy old settings file if new one doesn't exist yet
  try {
    await fs.access(newPath);
  } catch {
    try {
      const oldRaw = await fs.readFile(oldPath, 'utf-8');
      await fs.writeFile(newPath, oldRaw, 'utf-8');
      console.log('[migration] copied conchitect-settings.json → conchitour-settings.json');
    } catch { /* no old file either — first run */ }
  }
  try {
    const raw = await fs.readFile(newPath, 'utf-8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(patch: Partial<ConchitourSettings>): Promise<void> {
  const current = await readSettings();
  const p = path.join(app.getPath('userData'), 'conchitour-settings.json');
  await fs.writeFile(p, JSON.stringify({ ...current, ...patch }, null, 2), 'utf-8');
}

ipcMain.handle('settings:get', () => readSettings());

ipcMain.handle('settings:set', async (_e, patch: Partial<ConchitourSettings>) => {
  await saveSettings(patch);
  return true;
});

// ── Project file format (.Conchitour folder) ──────────────────────────────────

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
  const projectDir = path.join(parentFolder, `${slug}.conchitour`);
  await fs.mkdir(path.join(projectDir, 'sources'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'cache'),   { recursive: true });
  await fs.mkdir(path.join(projectDir, 'assets'),  { recursive: true });
  const lock = { schemaVersion: 1, createdAt: new Date().toISOString(), lastModified: new Date().toISOString() };
  await fs.writeFile(path.join(projectDir, 'conchitour.lock'), JSON.stringify(lock, null, 2), 'utf-8');
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
    const lockPath = path.join(currentProjectDir, 'conchitour.lock');
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
  const destDir = path.join(pick.filePaths[0], `${slug}.conchitour`);

  // Copy sources and cache from current project if it exists
  if (currentProjectDir) {
    for (const sub of ['sources', 'cache', 'assets']) {
      try { await copyDir(path.join(currentProjectDir, sub), path.join(destDir, sub)); } catch { /* skip */ }
    }
  }

  await fs.mkdir(destDir, { recursive: true });
  const lock = { schemaVersion: 1, createdAt: new Date().toISOString(), lastModified: new Date().toISOString() };
  await fs.writeFile(path.join(destDir, 'conchitour.lock'), JSON.stringify(lock, null, 2), 'utf-8');
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

ipcMain.handle('capture-scene-thumbnail', async (_e, slug: string, rect: { x: number; y: number; width: number; height: number }) => {
  if (!currentProjectDir) return false;
  try {
    const image = await _e.sender.capturePage(rect);
    const resized = image.resize({ width: 320, height: 200, quality: 'better' });
    const jpegBuffer = resized.toJPEG(85);
    const thumbsDir = path.join(currentProjectDir, 'thumbs');
    await fs.mkdir(thumbsDir, { recursive: true });
    await fs.writeFile(path.join(thumbsDir, `${slug}.jpg`), jpegBuffer);
    return true;
  } catch (e) {
    console.warn('[thumb] capturePage failed:', e);
    return false;
  }
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
  const localAppData = process.env.LOCALAPPDATA || '';
  const pathWithoutDrive = krpanoPath.replace(/^[A-Za-z]:[\\\/]/, '');
  const candidates = [
    path.join(krpanoPath, 'krpanolicense.xml'),
    path.join(localAppData, 'VirtualStore', pathWithoutDrive, 'krpanolicense.xml'),
    path.join(path.dirname(krpanoPath), 'krpanolicense.xml'),
  ];
  for (const licensePath of candidates) {
    try {
      await fs.access(licensePath);
      return { present: true, path: licensePath };
    } catch { /* try next */ }
  }
  return { present: false, path: candidates[0] };
});

ipcMain.handle('krpano:register', async (_e, krpanoPath: string, code: string) => {
  const toolPath = path.join(krpanoPath, 'krpanotools.exe');
  // Strip all whitespace/newlines — krpanotools expects the base64 code as one continuous string
  const cleanCode = code.replace(/\s+/g, '');
  if (!cleanCode) return { ok: false, message: 'Registration code is empty.' };

  // Verify the tool exists before spawning
  try { await fs.access(toolPath); } catch {
    return { ok: false, message: `krpanotools.exe not found at:\n${toolPath}` };
  }

  return new Promise<{ ok: boolean; message: string }>((resolve) => {
    const proc = spawn(toolPath, ['register', cleanCode], {
      cwd: krpanoPath,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { output += d.toString(); });

    // 30-second safety timeout
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ ok: false, message: 'krpanotools timed out after 30 seconds.' });
    }, 30_000);

    proc.on('close', async (exitCode) => {
      clearTimeout(timer);
      const raw = output.trim();
      const okByOutput = /registered/i.test(raw) || /success/i.test(raw) || /activated/i.test(raw);
      const ok = exitCode === 0 || okByOutput;

      // Search for krpanolicense.xml in all likely locations
      const appData    = process.env.APPDATA || '';
      const localAppData = process.env.LOCALAPPDATA || '';
      const userProfile  = process.env.USERPROFILE || '';
      const pathWithoutDrive = krpanoPath.replace(/^[A-Za-z]:[\\\/]/, '');
      const candidates = [
        path.join(krpanoPath, 'krpanolicense.xml'),
        path.join(path.dirname(krpanoPath), 'krpanolicense.xml'),
        path.join(localAppData, 'VirtualStore', pathWithoutDrive, 'krpanolicense.xml'),
        path.join(appData, 'krpano', 'krpanolicense.xml'),
        path.join(localAppData, 'krpano', 'krpanolicense.xml'),
        path.join(userProfile, 'krpanolicense.xml'),
      ];

      // Also do a shallow recursive search from the krpano parent dir
      let foundPath: string | null = null;
      for (const p of candidates) {
        try { await fs.access(p); foundPath = p; break; } catch { /* next */ }
      }

      // If still not found, walk up to 2 levels from krpanoPath
      if (!foundPath) {
        const dirs = [krpanoPath, path.dirname(krpanoPath), path.dirname(path.dirname(krpanoPath))];
        outer: for (const dir of dirs) {
          try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const e of entries) {
              if (e.name === 'krpanolicense.xml') {
                foundPath = path.join(dir, e.name);
                break outer;
              }
            }
          } catch { /* skip */ }
        }
      }

      const diag = foundPath
        ? `\nLicense file found at:\n${foundPath}`
        : `\nLicense file not found. Searched:\n${candidates.join('\n')}`;

      resolve({ ok: ok || !!foundPath, message: (raw || (ok ? 'License activated.' : `Exit code ${exitCode}.`)) + diag });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, message: `Could not launch krpanotools.exe:\n${err.message}` });
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

// ── Preview temp-dir helpers ───────────────────────────────────────────────────
function getTrialPreviewDir(): string {
  const id = crypto.randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `.conchitour-preview-${id}`);
}

async function cleanupOldPreviews(): Promise<void> {
  try {
    const entries = await fs.readdir(os.tmpdir(), { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith('.conchitour-preview-')) {
        try { await fs.rm(path.join(os.tmpdir(), e.name), { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

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

// ── Geo helpers (inlined from src/lib/geo.ts — same formulas, no import needed) ──
// heading = compass bearing (0–360, CW from north) the camera lens faced at capture
// ath = 0 is the image center; positive ath is rightward (east when heading=0)

function geoHaversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180, φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180, Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function geoBearing(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const φ1 = (from.lat * Math.PI) / 180, φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Mirrors bearingToAth() in src/lib/geo.ts — duplicated here because main.ts is a
// separate Node process and cannot import from src/ without bundler changes.
// ath = ((bearing − heading + 540) % 360) − 180  (canonical formula, range [−180, 180])
function geoAth(bearing: number, heading: number): number {
  let a = ((bearing - heading + 540) % 360) - 180;
  // clamp edge case: exactly +180 stays at −180 to avoid visual jump
  if (a > 180) a -= 360;
  return a;
}

function geoAtv(distM: number, heightDiffM: number): number {
  if (distM <= 0) return 0;
  return -(Math.atan2(heightDiffM, distM) * 180) / Math.PI;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateKrpanoXml(project: any, tiledScenes: Map<string, TileInfo | null>): string {
  const lang: string = project.languages?.default || 'en';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scenes: any[] = project.scenes || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories: any[] = project.categories || [];
  const modules = project.modules || {};
  const branding = project.branding || {};
  const startSceneId: string | undefined = branding.startSceneId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startScene = scenes.find((s: any) => s.id === startSceneId) ?? scenes[0];
  const startName: string = startScene ? sceneXmlName(startScene.slug) : '';
  const projectTitle = xmlEsc(project.meta?.name || 'Virtual Tour');
  const useGyro: boolean = !!modules.gyroscope;
  const useVr: boolean = !!modules.vr;
  // hotspot size: branding.hotspotSizePx (default 32) → scale to krpano units
  // 32 px → 60 krpano units (1.875×), maintain 5:6 aspect ratio
  const hsPx: number = Math.max(16, Math.min(80, branding.hotspotSizePx ?? 32));
  const hsW: number = Math.round(hsPx * 1.875);
  const hsH: number = Math.round(hsPx * 2.25);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<krpano version="1.23" title="${projectTitle}">\n\n`;

  // Optional plugins
  if (useGyro) {
    xml += '  <plugin name="gyro2" url="plugins/gyro2.js" enabled="true" license=""/>\n\n';
  }
  if (useVr) {
    xml += '  <plugin name="webvr" url="plugins/webvr.js" enabled="true"/>\n\n';
  }

  if (startName) {
    xml += '  <action name="startup" autorun="preinit">\n';
    xml += `    loadscene(${startName});\n`;
    xml += '  </action>\n\n';
  }



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
    xml += `    <view hlookat="${hlookat.toFixed(1)}" vlookat="${vlookat.toFixed(1)}" fovtype="HFOV" fov="${fov.toFixed(1)}" maxpixelzoom="2.0" fovmin="50" fovmax="140"/>\n`;

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

      if (hs.type === 'link') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const targetScene = scenes.find((s: any) => s.id === hs.targetSceneId);
        if (!targetScene) continue;
        const linkedScene = sceneXmlName(targetScene.slug);
        const tooltip = xmlEsc(loc(targetScene.title, lang) || targetScene.slug);

        // Recompute ath/atv from GPS at compile time (ensures consistency with heading used by radar).
        // Stored hs.ath/atv may be stale if heading was updated after the last Map auto-compute.
        let hsAth = hs.ath as number ?? 0;
        let hsAtv = hs.atv as number ?? 0;
        const sg = scene.geo, tg = targetScene.geo;
        if (sg?.lat != null && sg?.lng != null && tg?.lat != null && tg?.lng != null) {
          const bearing = geoBearing(sg, tg);
          hsAth = geoAth(bearing, heading);
          const dist = geoHaversine(sg, tg);
          const srcH = sg.altitude ?? scene.captureHeightMeters ?? 1.6;
          const tgtH = tg.altitude ?? targetScene.captureHeightMeters ?? 1.6;
          hsAtv = geoAtv(dist, tgtH - srcH);
        }
        const ath: string = hsAth.toFixed(2);
        const atv: string = hsAtv.toFixed(2);
        // Use target scene's primary category icon as hotspot pin
        const tCatId: string | undefined = (targetScene.categoryIds as string[])?.[0];
        const tCat = tCatId ? categories.find((c: any) => c.id === tCatId) : null;
        const iconUrl = tCat?.slug ? `/hotspots/cat-${tCat.slug}.svg` : '/hotspots/default.svg';
        xml += `    <hotspot name="${hsName}" type="image" url="${iconUrl}" ath="${ath}" atv="${atv}" width="${hsW}" height="${hsH}" edge="bottom" distorted="false" cursor="pointer" tooltip="${tooltip}" onover="js(_onHotspotHover('${targetScene.slug}')); tween(hotspot[${hsName}].scale,1.18,0.15);" onout="js(_onHotspotHoverOut('${targetScene.slug}')); tween(hotspot[${hsName}].scale,1.0,0.15);" onclick="js(window._track('link_hotspot_click',{target:'${targetScene.slug}'}));loadscene(${linkedScene},null,MERGE,BLEND(0.5));"/>\n`;
      } else {
        // Non-link hotspots use stored ath/atv (manually placed by user)
        const ath: string = (hs.ath as number ?? 0).toFixed(2);
        const atv: string = (hs.atv as number ?? 0).toFixed(2);
        if (hs.type === 'text') {
          const tooltip = xmlEsc(loc(hs.title, lang) || 'Info');
          xml += `    <hotspot name="${hsName}" type="image" url="/hotspots/hs-text.svg" ath="${ath}" atv="${atv}" width="${hsW}" height="${hsH}" edge="bottom" distorted="false" cursor="pointer" tooltip="${tooltip}" onover="tween(hotspot[${hsName}].scale,1.18,0.15);" onout="tween(hotspot[${hsName}].scale,1.0,0.15);" onclick="js(showTextHs('${hs.id}'));"/>\n`;
        } else if (hs.type === 'external') {
          const tooltip = xmlEsc(loc(hs.label, lang) || 'Link');
          xml += `    <hotspot name="${hsName}" type="image" url="/hotspots/hs-external.svg" ath="${ath}" atv="${atv}" width="${hsW}" height="${hsH}" edge="bottom" distorted="false" cursor="pointer" tooltip="${tooltip}" onover="tween(hotspot[${hsName}].scale,1.18,0.15);" onout="tween(hotspot[${hsName}].scale,1.0,0.15);" onclick="js(window._openExternalLink('${hs.id}'));"/>\n`;
        } else if (hs.type === 'video') {
          const tooltip = xmlEsc(loc(hs.title, lang) || 'Video');
          xml += `    <hotspot name="${hsName}" type="image" url="/hotspots/hs-video.svg" ath="${ath}" atv="${atv}" width="${hsW}" height="${hsH}" edge="bottom" distorted="false" cursor="pointer" tooltip="${tooltip}" onover="tween(hotspot[${hsName}].scale,1.18,0.15);" onout="tween(hotspot[${hsName}].scale,1.0,0.15);" onclick="js(showVideoHs('${hs.id}'));"/>\n`;
        } else if (hs.type === 'form') {
          if (!(modules as any).formsEnabled) continue;
          const tooltip = xmlEsc(loc(hs.title, lang) || 'Contact');
          xml += `    <hotspot name="${hsName}" type="image" url="/hotspots/hs-form.svg" ath="${ath}" atv="${atv}" width="${hsW}" height="${hsH}" edge="bottom" distorted="false" cursor="pointer" tooltip="${tooltip}" onover="tween(hotspot[${hsName}].scale,1.18,0.15);" onout="tween(hotspot[${hsName}].scale,1.0,0.15);" onclick="js(showFormHs('${hs.id}'));"/>\n`;
        }
      }
    }

    xml += '  </scene>\n\n';
  }

  xml += '</krpano>\n';
  return xml;
}

// ── Static page HTML generator ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generatePageHtml(project: any, page: any, lang: string, bodyHtml: string): string {
  const meta     = project.meta     || {};
  const branding = project.branding || {};
  const allLangs: string[] = project.languages?.available || [lang];
  const defaultLang: string = project.languages?.default || 'en';
  const pages: any[] = (project.pages || []).filter((p: any) => p.enabled && p.showInFooter);
  pages.sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

  const primaryColor = branding.primaryColor || '#1a1a1a';
  const accentColor  = branding.accentColor  || '#3b82f6';
  const tourTheme    = branding.tourTheme || {};
  const fontFamily: string = tourTheme.fontFamily === 'serif'
    ? "'Georgia','Times New Roman',serif"
    : tourTheme.fontFamily === 'mono'
    ? "'Courier New',monospace"
    : "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

  const publicUrl    = String(meta.publicationUrl || '').replace(/\/$/, '');
  const projectTitle = xmlEsc(meta.name || 'Virtual Tour');
  const pageTitle    = xmlEsc(loc(page.title, lang) || page.slug);
  const canonicalUrl = publicUrl ? `${publicUrl}/page/${page.slug}/${lang}/` : '';

  const logoPath: string = branding.logoPath || '';

  // Lang switcher links
  const langLinks = allLangs.map((l: string) => {
    const isActive = l === lang;
    const href = `/page/${page.slug}/${l}/`;
    return isActive
      ? `<span class="sp-lang-active">${l.toUpperCase()}</span>`
      : `<a href="${href}" class="sp-lang-link">${l.toUpperCase()}</a>`;
  }).join('');

  // Footer page links
  const footerLinks = pages.map((p: any) => {
    const t = xmlEsc(loc(p.title, lang) || p.slug);
    const isActive = p.id === page.id;
    return isActive
      ? `<span class="sp-footer-active">${t}</span>`
      : `<a href="/page/${p.slug}/${lang}/" class="sp-footer-link">${t}</a>`;
  }).join(`<span class="sp-footer-sep">·</span>`);

  // "Back to tour" — links to /:lang/ which server.js redirects to the opening scene
  const backHref = `/${lang}/`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${pageTitle} — ${projectTitle}</title>
  ${canonicalUrl ? `<link rel="canonical" href="${canonicalUrl}" />` : ''}
  <meta name="robots" content="index, follow" />
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--primary:${primaryColor};--accent:${accentColor};--radius:8px}
    body{font-family:${fontFamily};font-size:16px;line-height:1.65;color:#1a1a1a;background:#f8f8f6;min-height:100vh;display:flex;flex-direction:column}

    /* ── Header ── */
    .sp-header{background:var(--primary);color:#fff;padding:0 24px;display:flex;align-items:center;gap:16px;min-height:56px;flex-shrink:0}
    .sp-logo{height:32px;width:auto;object-fit:contain;flex-shrink:0}
    .sp-header-title{font-size:15px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.92}
    .sp-back{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:rgba(255,255,255,.7);text-decoration:none;white-space:nowrap;flex-shrink:0;padding:6px 12px;border:1px solid rgba(255,255,255,.25);border-radius:6px;transition:all .15s}
    .sp-back:hover{background:rgba(255,255,255,.12);color:#fff}
    .sp-lang{margin-left:auto;display:flex;align-items:center;gap:6px;flex-shrink:0}
    .sp-lang-link{font-size:11px;color:rgba(255,255,255,.6);text-decoration:none;padding:3px 6px;border-radius:4px;transition:.12s}
    .sp-lang-link:hover{background:rgba(255,255,255,.15);color:#fff}
    .sp-lang-active{font-size:11px;color:#fff;font-weight:700;padding:3px 6px;background:rgba(255,255,255,.2);border-radius:4px}

    /* ── Main content ── */
    .sp-main{flex:1;padding:40px 24px 60px;display:flex;justify-content:center}
    .sp-article{width:100%;max-width:720px}

    /* ── Prose typography ── */
    .sp-article h1{font-size:2em;font-weight:700;color:var(--primary);margin-bottom:20px;line-height:1.25}
    .sp-article h2{font-size:1.35em;font-weight:600;color:var(--primary);margin-top:36px;margin-bottom:12px;padding-bottom:6px;border-bottom:1.5px solid #e5e5e3}
    .sp-article h3{font-size:1.1em;font-weight:600;margin-top:24px;margin-bottom:8px;color:#2a2a2a}
    .sp-article p{margin-bottom:14px;color:#333}
    .sp-article ul,
    .sp-article ol{margin:0 0 14px 24px;color:#333}
    .sp-article li{margin-bottom:4px}
    .sp-article a{color:var(--accent);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px}
    .sp-article a:hover{opacity:.8}
    .sp-article strong{font-weight:600;color:#111}
    .sp-article em{font-style:italic}
    .sp-article table{width:100%;border-collapse:collapse;margin-bottom:18px;font-size:14px}
    .sp-article th{background:#f0f0ee;padding:8px 12px;text-align:left;font-weight:600;border:1px solid #ddd;font-size:13px}
    .sp-article td{padding:8px 12px;border:1px solid #ddd;vertical-align:top}
    .sp-article code{background:#f0f0ee;padding:2px 5px;border-radius:3px;font-size:.88em;font-family:monospace}
    .sp-article pre{background:#f0f0ee;border-radius:6px;padding:14px 16px;overflow-x:auto;margin-bottom:16px}
    .sp-article pre code{background:none;padding:0}
    .sp-article blockquote{border-left:3px solid var(--accent);padding:8px 16px;color:#555;margin-bottom:14px;background:#f8f8f6}
    .sp-article hr{border:none;border-top:1.5px solid #e5e5e3;margin:28px 0}

    /* ── Footer ── */
    .sp-footer{background:#fff;border-top:1px solid #e5e5e3;padding:16px 24px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex-shrink:0}
    .sp-footer-link{font-size:12px;color:#666;text-decoration:none;transition:.12s}
    .sp-footer-link:hover{color:var(--accent)}
    .sp-footer-active{font-size:12px;color:var(--accent);font-weight:600}
    .sp-footer-sep{font-size:12px;color:#ccc;margin:0 2px}
    .sp-footer-copy{font-size:11px;color:#aaa;margin-left:auto}

    @media(max-width:640px){
      .sp-header{padding:0 16px;gap:10px}
      .sp-header-title{font-size:13px}
      .sp-main{padding:24px 16px 40px}
      .sp-article h1{font-size:1.5em}
      .sp-article h2{font-size:1.15em}
    }
  </style>
</head>
<body>
  <header class="sp-header">
    ${logoPath ? `<img src="/assets/logo${path.extname(logoPath) || '.png'}" alt="${projectTitle}" class="sp-logo" />` : ''}
    <span class="sp-header-title">${projectTitle}</span>
    ${allLangs.length > 1 ? `<div class="sp-lang">${langLinks}</div>` : ''}
    <a href="${backHref}" class="sp-back">← Back to tour</a>
  </header>

  <main class="sp-main">
    <article class="sp-article">
      ${bodyHtml}
    </article>
  </main>

  ${footerLinks || meta.copyright ? `
  <footer class="sp-footer">
    ${footerLinks}
    ${meta.copyright ? `<span class="sp-footer-copy">${xmlEsc(meta.copyright)}</span>` : ''}
  </footer>` : ''}
</body>
</html>`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateTourHtml(project: any, lang: string, startSceneSlug: string | null, tiledSlugs: Set<string>, hasSharePreview = false, isTrialBuild = false): string {
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
  const copyright = isTrialBuild
    ? xmlEsc(TRIAL_LIMITS.forcedCopyright)
    : xmlEsc(meta.copyright || '');
  const tourTheme = (branding.tourTheme as { fontFamily?: string; headerBg?: string; panelBg?: string; textColor?: string; radius?: string; fontSize?: number } | undefined) || {};

  // Footer page links
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const footerPages: any[] = ((project.pages || []) as any[])
    .filter((p: any) => p.enabled && p.showInFooter)
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
  const tourFooterHtml = footerPages.length > 0
    ? `<div id="tour-footer">${footerPages.map((p: any, i: number) =>
        (i > 0 ? '<span class="tf-sep">·</span>' : '') +
        `<a href="/page/${p.slug}/${lang}/">${xmlEsc(loc(p.title, lang) || p.slug)}</a>`
      ).join('')}</div>`
    : '';

  // Build per-lang scene data for the TOUR JS object (all scenes, current lang strings)
  const scenesData: Record<string, unknown> = {};
  for (const scene of scenes) {
    const ext = path.extname(scene.media?.sourcePath || '.jpg') || '.jpg';
    const rawTitleStr = loc(scene.title, lang) || '';
    // Suppress auto-generated filename titles: if title normalizes to the same as slug, hide it.
    const titleNorm = rawTitleStr.replace(/[-_]/g, ' ').toLowerCase().trim();
    const slugNorm  = (scene.slug as string).replace(/[-_]/g, ' ').toLowerCase().trim();
    const titleStr  = (rawTitleStr && titleNorm !== slugNorm) ? rawTitleStr : '';
    scenesData[scene.slug] = {
      title:       titleStr,
      description: loc(scene.description, lang) || '',
      categoryIds: scene.categoryIds || [],
      preview: tiledSlugs.has(scene.slug)
        ? `/thumbs/${scene.slug}.jpg`
        : `/media/${scene.slug}${ext}`,
      gps: (scene.geo?.lat != null && scene.geo?.lng != null)
        ? { lat: scene.geo.lat, lng: scene.geo.lng }
        : null,
      heading:     scene.heading     ?? 0,
      defaultView: scene.defaultView ?? null,
    };
  }

  // Full multilingual scene index (all langs, raw title records) for runtime _displayTitle
  const scenesIndexData: Record<string, unknown> = {};
  for (const scene of scenes) {
    scenesIndexData[scene.slug] = { title: scene.title || {}, slug: scene.slug };
  }
  const categoriesIndexData: Record<string, unknown> = {};
  for (const cat of categories) {
    const rawCatIcon = (cat as any).iconSvg as string | null | undefined;
    let resolvedCatIcon: string | null = null;
    if (rawCatIcon?.startsWith('builtin:')) {
      const inner = BUILTIN_ICON_SVG[rawCatIcon.slice(8)];
      if (inner) resolvedCatIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    } else if (rawCatIcon) {
      resolvedCatIcon = rawCatIcon;
    }
    categoriesIndexData[(cat.slug as string)] = { name: cat.name || {}, color: cat.color || accentColor, iconSvg: resolvedCatIcon };
  }
  const scenesIndexJson     = JSON.stringify(scenesIndexData).replace(/<\//g, '<\\/');
  const categoriesIndexJson = JSON.stringify(categoriesIndexData).replace(/<\//g, '<\\/');

  // For each scene: which category slugs are reachable via link hotspots (target scene's primary category)
  const sceneCategoriesIndexData: Record<string, string[]> = {};
  for (const scene of scenes) {
    const catSlugSet = new Set<string>();
    for (const hs of ((scene.hotspots ?? []) as any[])) {
      if (hs.type === 'link' && hs.targetSceneId) {
        const tScene = scenes.find((s: any) => s.id === hs.targetSceneId);
        const tCatId = tScene?.categoryIds?.[0];
        const tCat = tCatId ? categories.find((c: any) => c.id === tCatId) : null;
        if (tCat?.slug) catSlugSet.add(tCat.slug as string);
      }
    }
    sceneCategoriesIndexData[scene.slug as string] = Array.from(catSlugSet);
  }
  const sceneCategoriesIndexJson = JSON.stringify(sceneCategoriesIndexData).replace(/<\//g, '<\\/');

  // For map↔tour hover sync: map from (sourceSceneSlug → targetSceneSlug → krpano hotspot name)
  const sceneHotspotMapData: Record<string, Record<string, string>> = {};
  for (const scene of scenes) {
    const slugMap: Record<string, string> = {};
    for (const hs of ((scene.hotspots ?? []) as any[])) {
      if (hs.type === 'link' && hs.targetSceneId) {
        const tScene = scenes.find((s: any) => s.id === hs.targetSceneId);
        if (tScene?.slug) slugMap[tScene.slug as string] = hotspotXmlName(hs.id as string);
      }
    }
    sceneHotspotMapData[scene.slug as string] = slugMap;
  }
  const sceneHotspotMapJson = JSON.stringify(sceneHotspotMapData).replace(/<\//g, '<\\/');

  // Categories keyed by ID
  const categoriesData: Record<string, unknown> = {};
  for (const cat of categories) {
    let resolvedIconSvg: string | null = null;
    if (cat.iconSvg) {
      const rawIcon = cat.iconSvg as string;
      if (rawIcon.startsWith('builtin:')) {
        resolvedIconSvg = BUILTIN_ICON_SVG[rawIcon.slice(8)] ?? null;
      } else {
        resolvedIconSvg = rawIcon;
      }
    }
    categoriesData[cat.id] = {
      name:    loc(cat.name, lang) || cat.slug,
      color:   cat.color || accentColor,
      iconSvg: resolvedIconSvg,
    };
  }

  // Hotspot content maps (for text/video/form popup data keyed by hotspot ID)
  const hotspotTexts: Record<string, unknown> = {};
  const hotspotVideos: Record<string, unknown> = {};
  const hotspotForms: Record<string, unknown> = {};
  const hotspotExternalUrls: Record<string, string> = {};
  for (const scene of scenes as any[]) {
    for (const hs of (scene.hotspots || []) as any[]) {
      if (hs.type === 'text') {
        hotspotTexts[hs.id] = { title: loc(hs.title, lang) || '', body: loc(hs.body, lang) || '' };
      } else if (hs.type === 'video') {
        hotspotVideos[hs.id] = { url: hs.url || '', title: loc(hs.title, lang) || '' };
      } else if (hs.type === 'external') {
        hotspotExternalUrls[hs.id] = hs.url || '';
      } else if (hs.type === 'form') {
        hotspotForms[hs.id] = {
          mailto: hs.mailto || '',
          subject: loc(hs.subject, lang) || '',
          fields: hs.fields || [],
        };
      }
    }
  }

  // Global contact form for the header button (formsEnabled + feedbackMailto)
  const _mods: any = project.modules || {};
  if (_mods.formsEnabled && _mods.feedbackMailto?.trim()) {
    hotspotForms['__contact__'] = {
      mailto:  _mods.feedbackMailto.trim(),
      subject: loc(project.meta?.title, lang) || projectTitle,
      fields: [
        { name: 'name',    label: 'Name',    type: 'text' },
        { name: 'email',   label: 'Email',   type: 'email' },
        { name: 'message', label: 'Message', type: 'textarea' },
      ],
    };
  }

  // Escape </script> so user content never prematurely closes the <script> block.
  // JSON.stringify doesn't do this — any scene description or hotspot body with
  // "</script>" would terminate the entire script tag, silently killing all JS.
  const tourDataJson = JSON.stringify({
    lang,
    defaultLang,
    allLangs,
    projectTitle,
    publicUrl: publicUrl || null,
    startScene: startSceneSlug ?? startScene?.slug ?? null,
    scenes: scenesData,
    categories: categoriesData,
    hotspotTexts,
    hotspotVideos,
    hotspotForms,
    hotspotExternalUrls,
    hotspotSizePx: branding.hotspotSizePx || 32,
    panelAnimation: branding.panelAnimation || 'slide',
  }).replace(/<\//g, '<\\/');

  const hasMap = scenes.some((s: any) => s.geo?.lat != null && s.geo?.lng != null);

  // OG / canonical
  let headExtras = '';
  if (canonicalUrl) {
    headExtras += `  <link rel="canonical" href="${xmlEsc(canonicalUrl)}">\n`;
    headExtras += `  <meta property="og:url" content="${xmlEsc(canonicalUrl)}">\n`;
  }
  headExtras += `  <meta property="og:title" content="${pageTitle}">\n`;
  if (description) headExtras += `  <meta property="og:description" content="${description}">\n`;
  headExtras += '  <meta property="og:type" content="website">\n';
  // og:image — prefer compiled share-preview.jpg, fall back to tiles preview or media file
  let ogImageUrl = '';
  if (publicUrl) {
    if (hasSharePreview) {
      ogImageUrl = `${xmlEsc(publicUrl)}/share-preview.jpg`;
    } else if (startScene) {
      const ext = path.extname(startScene.media?.sourcePath || '.jpg') || '.jpg';
      ogImageUrl = tiledSlugs.has(startScene.slug)
        ? `${xmlEsc(publicUrl)}/panos/${startScene.slug}.tiles/preview.jpg`
        : `${xmlEsc(publicUrl)}/media/${startScene.slug}${ext}`;
    }
    if (ogImageUrl) {
      headExtras += `  <meta property="og:image" content="${ogImageUrl}">\n`;
      headExtras += `  <meta property="og:image:width" content="1200">\n`;
      headExtras += `  <meta property="og:image:height" content="630">\n`;
      headExtras += `  <meta name="twitter:card" content="summary_large_image">\n`;
      headExtras += `  <meta name="twitter:title" content="${pageTitle}">\n`;
      if (description) headExtras += `  <meta name="twitter:description" content="${description}">\n`;
      headExtras += `  <meta name="twitter:image" content="${ogImageUrl}">\n`;
    }
  }
  if (keywords.length) headExtras += `  <meta name="keywords" content="${xmlEsc(keywords.join(', '))}">\n`;

  // GA4 analytics
  const _ga: any = (project as any).analytics ?? {};
  const gaEnabled: boolean = !!(
    _ga.enabled &&
    _ga.measurementId &&
    /^G-[A-Z0-9]{9,12}$/.test(_ga.measurementId)
  );
  const gaMid: string = _ga.measurementId || '';
  const gaAnonymize: boolean = _ga.anonymizeIp !== false;
  const gaConsent: boolean = !!_ga.respectCookieConsent;
  const gaEvents: Record<string, boolean> = _ga.events ?? {};
  if (gaEnabled) {
    headExtras += `  <script async src="https://www.googletagmanager.com/gtag/js?id=${gaMid}"></script>\n`;
    headExtras +=
      `  <script>window.dataLayer=window.dataLayer||[];` +
      `function gtag(){dataLayer.push(arguments);}` +
      `gtag('js',new Date());` +
      `gtag('config','${gaMid}',{'anonymize_ip':${gaAnonymize},'send_page_view':false});` +
      `window.__gaEnabled=true;` +
      `window.__gaMid='${gaMid}';` +
      `window.__gaRespectConsent=${gaConsent};` +
      `window.__gaConsented=${!gaConsent};` +
      `window.__gaEvents=${JSON.stringify(gaEvents).replace(/<\//g, '<\\/')};` +
      `</script>\n`;
  }

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
    if (share.facebook) links.push(`<a href="#" onclick="_track('share_click',{platform:'facebook'});window.open('https://facebook.com/sharer/sharer.php?u='+encodeURIComponent(location.href),'_blank','noopener,noreferrer');return false;" title="Facebook">f</a>`);
    if (share.twitter)  links.push(`<a href="#" onclick="_track('share_click',{platform:'twitter'});window.open('https://x.com/intent/tweet?url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent(document.title),'_blank','noopener,noreferrer');return false;" title="X">X</a>`);
    if (share.whatsapp) links.push(`<a href="#" onclick="_track('share_click',{platform:'whatsapp'});window.open('https://api.whatsapp.com/send?text='+encodeURIComponent(document.title)+'%20'+encodeURIComponent(location.href),'_blank','noopener,noreferrer');return false;" title="WhatsApp">W</a>`);
    if (share.linkedin) links.push(`<a href="#" onclick="_track('share_click',{platform:'linkedin'});window.open('https://linkedin.com/sharing/share-offsite/?url='+encodeURIComponent(location.href),'_blank','noopener,noreferrer');return false;" title="LinkedIn">in</a>`);
    if (share.email)    links.push(`<a href="#" onclick="_track('share_click',{platform:'email'});location.href='mailto:?subject='+encodeURIComponent(document.title)+'&body='+encodeURIComponent(location.href);return false;" title="Email">@</a>`);
    shareBar = `  <div id="share-bar">${links.join('')}</div>\n`;
  }

  // For scene-specific deep-link pages, jump to the target scene on load
  const loadSceneCall = startSceneSlug
    ? `krp.call("loadscene(${sceneXmlName(startSceneSlug)},null,MERGE,BLEND(0.5));");`
    : '';

  // ── Loading screen ────────────────────────────────────────────────────
  const loaderExt: string = branding.loaderPath ? path.extname(branding.loaderPath as string) : '';
  const loaderImgSrc: string = branding.loaderPath ? `/assets/loader${xmlEsc(loaderExt)}` : '';
  const introText: string = xmlEsc(
    (branding.introText as Record<string, string> | undefined)?.[lang]
    || (branding.introText as Record<string, string> | undefined)?.[defaultLang]
    || ''
  );
  const introAnimation: string = (tourTheme as any).introAnimation || 'fade';
  const introFontSize: number  = Number((tourTheme as any).introFontSize) || 18;
  const introFontFamily: string = tourTheme.fontFamily === 'serif'
    ? "Georgia,'Times New Roman',serif"
    : tourTheme.fontFamily === 'mono'
    ? "ui-monospace,'SFMono-Regular',Menlo,monospace"
    : "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const splashAnimName: string = introAnimation === 'slide' ? '_splashSlide' : introAnimation === 'zoom' ? '_splashZoom' : '_splashFade';

  // ── Favicon ───────────────────────────────────────────────────────────
  const faviconExt: string = branding.faviconPath ? path.extname(branding.faviconPath as string) : '';
  const faviconLinkHtml: string = branding.faviconPath ? `  <link rel="icon" href="/assets/favicon${xmlEsc(faviconExt)}">\n` : '';

  // ── Header logo / tour title pill ────────────────────────────────────
  const logoExt: string = branding.logoPath ? path.extname(branding.logoPath as string) : '';
  const pillInitial: string  = (projectTitle || '?').trim().charAt(0).toUpperCase();
  // logoPath file > initial letter from tour title
  const logoImgHtml: string = branding.logoPath
    ? `<img id="hdr-logo-img" src="/assets/logo${xmlEsc(logoExt)}" alt="${xmlEsc(projectTitle)}">`
    : `<span id="hdr-logo-img" class="hdr-initial" aria-hidden="true">${xmlEsc(pillInitial)}</span>`;
  // Compute initial sheet title/category from start scene
  const initialSheetTitle: string = startScene
    ? (loc(startScene.title as Record<string, string>, lang) || loc(startScene.title as Record<string, string>, defaultLang) || (Object.values((startScene.title as Record<string, string>) || {})[0] || ''))
    : '';
  const initialSheetCat: string = (() => {
    if (!startScene) return '';
    const catId: string | undefined = ((startScene as any).categoryIds || [])[0];
    if (!catId) return '';
    const cat = ((project as any).categories || []).find((c: any) => c.id === catId);
    return cat ? (loc(cat.name, lang) || loc(cat.name, defaultLang) || (Object.values((cat.name as Record<string, string>) || {})[0] || '')) : '';
  })();

  // ── Header action buttons ─────────────────────────────────────────────
  // Map is shown when scenes have GPS. mapMode config controls appearance only.
  const showMap: boolean = hasMap;
  const mobView: 'map' | 'strip' | 'pano' = (branding.mobileDefaultView as 'map' | 'strip' | 'pano') || 'map';
  const bodyClasses: string = [
    showMap && mobView === 'map' ? 'has-map' : '',
    mobView === 'strip' ? 'has-strip' : '',
    mobView === 'pano' ? 'pano-only' : '',
  ].filter(Boolean).join(' ');
  const mapHdrBtn: string = showMap
    ? `<button class="hdr-btn" id="map-hdr-btn" onclick="_toggleMap()" title="Map"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3"/><path d="M9 3v15"/><path d="M15 6v15"/></svg></button>` : '';
  const FLAG_MAP: Record<string, string> = {
    en:'🇬🇧', fr:'🇫🇷', de:'🇩🇪', es:'🇪🇸', it:'🇮🇹',
    pt:'🇵🇹', nl:'🇳🇱', pl:'🇵🇱', ru:'🇷🇺', zh:'🇨🇳',
    ja:'🇯🇵', ko:'🇰🇷', ar:'🇸🇦', tr:'🇹🇷', sv:'🇸🇪',
    da:'🇩🇰', fi:'🇫🇮', nb:'🇳🇴', no:'🇳🇴', uk:'🇺🇦',
  };
  const langHdrBtns: string = allLangs.length > 1
    ? `<select id="lang-sel" onchange="_track('language_change',{lang:this.value});var p=window.location.pathname,m=p.match(/\\/scene\\/([^/]+)\\//),s=_curScene||(m?m[1]:'');location.href=s?'/scene/'+s+'/'+this.value+'/':'/'+this.value+'/';">` +
      allLangs.map((l: string) => {
        const flag: string = FLAG_MAP[l] || '🌐';
        return `<option value="${xmlEsc(l)}"${l === lang ? ' selected' : ''}>${flag} ${l.toUpperCase()}</option>`;
      }).join('') +
      `</select>`
    : '';
  // Consolidate header share links into a single button + slide-down popover
  const shareHdrItems: string[] = [];
  if (share.facebook) shareHdrItems.push(`<a class="shr-pop-item" href="#" onclick="_track('share_click',{platform:'facebook'});window.open('https://facebook.com/sharer/sharer.php?u='+encodeURIComponent(location.href),'_blank','noopener');return false;" title="Facebook">f</a>`);
  if (share.twitter)  shareHdrItems.push(`<a class="shr-pop-item" href="#" onclick="_track('share_click',{platform:'twitter'});window.open('https://x.com/intent/tweet?url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent(document.title),'_blank','noopener');return false;" title="X">𝕏</a>`);
  if (share.whatsapp) shareHdrItems.push(`<a class="shr-pop-item" href="#" onclick="_track('share_click',{platform:'whatsapp'});window.open('https://api.whatsapp.com/send?text='+encodeURIComponent(document.title)+'%20'+encodeURIComponent(location.href),'_blank','noopener');return false;" title="WhatsApp">W</a>`);
  if (share.linkedin) shareHdrItems.push(`<a class="shr-pop-item" href="#" onclick="_track('share_click',{platform:'linkedin'});window.open('https://linkedin.com/sharing/share-offsite/?url='+encodeURIComponent(location.href),'_blank','noopener');return false;" title="LinkedIn">in</a>`);
  shareHdrItems.push(`<a class="shr-pop-item" href="#" onclick="_copyTourUrl();return false;" title="Copy link"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></a>`);
  // Note: share.email is intentionally NOT added to the header (it would duplicate the feedbackMailto button).
  // Email sharing is available in the bottom share bar only.
  const hasHdrShare: boolean = shareHdrItems.length > 0; // true whenever any share item exists
  const shareHdrHtml: string = hasHdrShare
    ? `<button class="hdr-btn" id="share-hdr-btn" onclick="_toggleShare()" title="Share"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg></button>`
    : '';
  const sharePopoverHtml: string = hasHdrShare
    ? `  <div id="share-popover">${shareHdrItems.join('')}</div>\n`
    : '';

  // ── Mobile ⋮ More popover ─────────────────────────────────────────────
  const mobMoreItems: string[] = [];
  mobMoreItems.push(
    `<button class="mob-more-item" onclick="_toggleInfo();_closeMobMore()">` +
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>` +
    ` Scene info</button>`
  );
  if (project.modules?.vr) {
    mobMoreItems.push(
      `<button class="mob-more-item" onclick="if(_krpano)_krpano.call('webvr.enterVR()');_closeMobMore()">` +
      `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h2l1.5 4H18.5L20 8h2"/><path d="M7 12l-1 4h12l-1-4"/></svg>` +
      ` VR</button>`
    );
  }
  if (project.modules?.fullscreen !== false) {
    mobMoreItems.push(
      `<button class="mob-more-item" onclick="_toggleFs();_closeMobMore()">` +
      `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>` +
      ` Fullscreen</button>`
    );
  }
  const mobMorePopoverHtml: string = `  <div id="mob-more-popover">${mobMoreItems.join('')}</div>\n`;

  // ── Cookie consent ───────────────────────────────────────────────────
  const modules = project.modules || {};
  const cookieEnabled: boolean = !!(modules.cookieConsent);
  const cookieTextStr: string = cookieEnabled
    ? (modules.cookieText ? (modules.cookieText[lang] || modules.cookieText['en'] || Object.values(modules.cookieText)[0] || '') : '')
      || 'This website uses cookies to enhance your virtual tour experience. By continuing, you accept our cookie policy.'
    : '';
  const cookieHtml: string = cookieEnabled
    ? `  <div id="cookie-banner">\n    <div id="cookie-text">${xmlEsc(cookieTextStr)}</div>\n    <button id="cookie-accept" onclick="_acceptCookies()">Accept</button>\n  </div>`
    : '';

  // ── iOS dock scene cards ─────────────────────────────────────────────
  const sceneCardsHtml: string = (scenes as any[]).map((scene: any) => {
    const ext: string = path.extname(scene.media?.sourcePath || '.jpg') || '.jpg';
    const prev = tiledSlugs.has(scene.slug)
      ? `/thumbs/${scene.slug}.jpg`
      : `/media/${scene.slug}${ext}`;
    const rawT = loc(scene.title, lang) || loc(scene.title, defaultLang) || (Object.values((scene.title as Record<string,string>) || {})[0] || '');
    const tNorm = rawT.replace(/[-_]/g, ' ').toLowerCase().trim();
    const sNorm = (scene.slug as string).replace(/[-_]/g, ' ').toLowerCase().trim();
    const displayT = (rawT && tNorm !== sNorm) ? rawT : '';
    const sTitle = xmlEsc(displayT);
    const labelHtml = displayT ? `<div class="sc-label">${sTitle}</div>` : '';
    return `<div class="sc-wrap" data-slug="${xmlEsc(scene.slug)}" data-title="${sTitle}" onclick="_navTo('${xmlEsc(scene.slug)}')">` +
      `<div class="sc-img"><img src="${xmlEsc(prev)}" alt="${sTitle}" loading="lazy">${labelHtml}</div>` +
      `</div>`;
  }).join('');

  const hsStyle: string = (branding.hotspotPreviewStyle as string) || 'card';
  const hsPreviewCss = hsStyle === 'compact'
    ? `    #hs-preview{position:fixed;z-index:200;border-radius:20px;background:rgba(8,8,10,.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 4px 16px rgba(0,0,0,.55);pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .15s,transform .15s;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap}\n    #hs-preview.visible{opacity:1;transform:translateY(0)}\n    #hs-preview img{display:none}\n    #hs-preview-title{padding:7px 16px 8px;font-size:13px;font-weight:600;color:#fff;line-height:1.2}\n`
    : hsStyle === 'overlay'
    ? `    #hs-preview{position:fixed;z-index:200;width:220px;border-radius:12px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.6);pointer-events:none;opacity:0;transform:scale(.96);transition:opacity .18s,transform .18s;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}\n    #hs-preview.visible{opacity:1;transform:scale(1)}\n    #hs-preview img{width:100%;height:130px;object-fit:cover;display:block}\n    #hs-preview-title{position:absolute;bottom:0;left:0;right:0;padding:28px 12px 10px;background:linear-gradient(to top,rgba(0,0,0,.85) 0%,transparent 100%);font-size:13px;font-weight:600;color:#fff;line-height:1.3}\n`
    : /* card (default) — Dubai360 style */
      `    #hs-preview{position:fixed;z-index:9500;width:280px;border-radius:12px;overflow:visible;background:#fff;box-shadow:0 12px 32px rgba(0,0,0,.35);pointer-events:none;opacity:0;transform:translateY(4px) scale(.98);transition:opacity .15s,transform .15s;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}\n    #hs-preview.visible{opacity:1;transform:translateY(0) scale(1)}\n    #hs-preview .hsp-img-wrap{width:100%;height:140px;background:#222;overflow:hidden;border-radius:12px 12px 0 0}\n    #hs-preview .hsp-img{width:100%;height:100%;object-fit:cover;display:block}\n    #hs-preview .hsp-badges{position:absolute;top:140px;left:50%;transform:translate(-50%,-50%);display:flex;gap:8px;z-index:2}\n    #hs-preview .hsp-badge{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.25);border:2px solid #fff;flex-shrink:0}\n    #hs-preview .hsp-badge svg{width:14px;height:14px}\n    #hs-preview .hsp-title{padding:24px 14px 14px;text-align:center;color:rgb(20,20,30);font-size:13px;font-weight:600;line-height:1.25;background:#fff;border-radius:0 0 12px 12px}\n`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
${faviconLinkHtml}${description ? `  <meta name="description" content="${description}">\n` : ''}${headExtras}${showMap ? '  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>\n' : ''}  <style>
    :root{
      --primary:${primaryColor};
      --accent:${accentColor};
      --radius:${tourTheme.radius === 'sharp' ? '0px' : tourTheme.radius === 'round' ? '20px' : '12px'};
      --spacing:8px;
      --hdr-h:56px;
      --tt-font:${tourTheme.fontFamily === 'serif' ? "Georgia,'Times New Roman',serif" : tourTheme.fontFamily === 'mono' ? "ui-monospace,'SFMono-Regular',Menlo,monospace" : "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"};
      --tt-header-bg:${tourTheme.headerBg ? tourTheme.headerBg.replace(/['"\\]/g,'') : 'rgba(255,255,255,.96)'};
      --tt-panel-bg:${tourTheme.panelBg ? tourTheme.panelBg.replace(/['"\\]/g,'') : 'rgba(255,255,255,.97)'};
      --tt-text:${tourTheme.textColor ? tourTheme.textColor.replace(/['"\\]/g,'') : '#111'};
      --tt-font-size:${tourTheme.fontSize ? tourTheme.fontSize + 'px' : '15px'};
    }
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body{width:100%;height:100%;overflow:hidden;background:var(--primary);
      font-family:var(--tt-font)}
    #pano{position:absolute;inset:0;z-index:0}

    /* ── Header ─────────────────────────────────── */
    #tour-hdr{
      position:fixed;top:0;left:0;right:0;height:56px;z-index:60;
      background:var(--tt-header-bg);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      box-shadow:0 1px 0 rgba(0,0,0,.08),0 4px 20px rgba(0,0,0,.05);
      display:flex;align-items:center;padding:0 16px;gap:10px;
    }
    #hdr-logo{display:flex;align-items:center;gap:8px;flex-shrink:0;min-width:0}
    #hdr-logo-img{height:30px;max-width:130px;width:auto;object-fit:contain;display:block}
    #hdr-logo-text{font-size:13px;font-weight:700;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px}
    #hdr-scene-name{font-weight:700}
    .hdr-author,.hdr-date{font-size:11px;font-weight:400;color:#777}
    .hdr-sep{width:1px;height:22px;background:rgba(0,0,0,.1);flex-shrink:0}
    #hdr-title{
      position:absolute;left:50%;transform:translateX(-50%);
      font-size:14px;font-weight:600;color:#111;letter-spacing:-.01em;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      max-width:40%;text-align:center;pointer-events:none;
    }
    #hdr-actions{display:flex;align-items:center;gap:5px;flex-shrink:0;margin-left:auto}
    .hdr-btn{
      height:30px;min-width:30px;border:1px solid rgba(0,0,0,.14);border-radius:6px;
      background:transparent;color:#555;cursor:pointer;
      font-size:11px;font-weight:600;padding:0 9px;
      display:inline-flex;align-items:center;justify-content:center;gap:4px;
      text-decoration:none;transition:background .15s,color .15s;
    }
    .hdr-btn:hover{background:#f2f2f2;color:#111}
    #share-popover{
      position:fixed;top:52px;right:8px;z-index:1001;
      background:#fff;border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,.18);
      padding:8px;display:flex;flex-direction:column;gap:4px;
      min-width:110px;opacity:0;pointer-events:none;
      transform:translateY(-6px);transition:opacity .15s,transform .15s;
    }
    #share-popover.open{opacity:1;pointer-events:all;transform:translateY(0)}
    .shr-pop-item{
      display:flex;align-items:center;justify-content:center;
      height:36px;border-radius:8px;font-size:13px;font-weight:600;
      color:#333;text-decoration:none;padding:0 12px;
      transition:background .12s;
    }
    .shr-pop-item:hover{background:#f2f2f2}
    .lang-act{background:${accentColor}!important;color:#fff!important;border-color:${accentColor}!important}
    #lang-sel{
      height:30px;border:1px solid rgba(0,0,0,.14);border-radius:6px;
      background:transparent;color:#555;font-size:13px;font-weight:600;
      padding:0 6px;cursor:pointer;outline:none;
    }

    /* ── Map panel ───────────────────────────────── */
    #map-panel{
      position:fixed;left:0;top:56px;bottom:0;width:360px;z-index:55;
      display:flex;flex-direction:column;
      transform:translateX(-100%);transition:transform .45s cubic-bezier(.22,1,.36,1);
    }
    #map-panel.open{transform:translateX(0)}
    #map-close{
      position:absolute;top:10px;right:10px;z-index:500;
      width:30px;height:30px;border-radius:50%;
      border:1px solid rgba(255,255,255,.3);background:rgba(8,8,10,.85);
      color:#fff;font-size:16px;line-height:1;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
    }
    #map-close:hover{background:rgba(255,255,255,.2)}
    #leaflet-map{flex:1}

    /* ── Hotspot preview ─────────────────────────── */
${hsPreviewCss}
    /* ── iOS Dock strip ──────────────────────────── */
    #strip-outer{
      position:fixed;bottom:0;left:0;right:0;z-index:50;
      display:flex;justify-content:center;
      pointer-events:none;
    }
    #strip-scroll{
      display:flex;align-items:flex-end;gap:8px;
      padding:20px 16px 16px;
      height:148px;
      overflow-x:auto;overflow-y:visible;
      max-width:100%;pointer-events:all;scrollbar-width:none;
    }
    #strip-scroll::-webkit-scrollbar{display:none}
    .sc-wrap{
      flex-shrink:0;position:relative;cursor:pointer;
      transition:transform .2s cubic-bezier(.22,1,.36,1);
      transform-origin:bottom center;
    }
    .sc-wrap:hover{transform:translateY(-6px) scale(1.04);box-shadow:0 8px 24px rgba(0,0,0,.35)}
    .sc-wrap::after{content:none}
    .sc-img{width:160px;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.5);position:relative}
    .sc-img img{width:160px;height:100px;object-fit:cover;display:block}
    .sc-wrap.cur .sc-img{box-shadow:0 0 0 2.5px ${accentColor},0 4px 16px rgba(0,0,0,.55)}
    .sc-label{position:absolute;left:0;right:0;bottom:0;padding:20px 8px 6px;color:#fff;font-size:12px;font-weight:500;line-height:1.2;text-shadow:0 1px 2px rgba(0,0,0,.6);background:linear-gradient(to top,rgba(0,0,0,.75) 0%,rgba(0,0,0,.45) 60%,rgba(0,0,0,0) 100%);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
    .sc-wrap.cur .sc-label{font-weight:600}

    /* ── Info panel ──────────────────────────────── */
    #info-panel{
      position:fixed;right:16px;top:68px;width:280px;
      background:var(--tt-panel-bg);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
      border-radius:var(--radius);border:1px solid rgba(0,0,0,.06);
      box-shadow:0 4px 6px -1px rgba(0,0,0,.07),0 24px 48px -12px rgba(0,0,0,.18);
      padding:20px;
      opacity:0;pointer-events:none;transform:translateY(-4px) scale(.98);
      transition:opacity .2s,transform .2s;z-index:55;
      max-height:calc(100vh - 96px - 140px);overflow-y:auto;
    }
    #info-panel.open{opacity:1;pointer-events:all;transform:translateY(0) scale(1)}
    #info-panel-close{
      position:absolute;top:10px;right:10px;
      width:26px;height:26px;border-radius:50%;
      border:none;background:rgba(0,0,0,.06);cursor:pointer;
      font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;
      opacity:.55;transition:opacity .15s,background .15s;
    }
    #info-panel-close:hover{opacity:1;background:rgba(0,0,0,.12)}
    #info-panel-cat{
      display:none;font-size:10px;font-weight:700;text-transform:uppercase;
      letter-spacing:.08em;padding:3px 8px;border-radius:20px;margin-bottom:12px;
    }
    #info-panel-title{font-size:19px;font-weight:700;color:var(--tt-text);line-height:1.25;letter-spacing:-.02em;margin-bottom:10px}
    #info-panel-rule{height:1px;background:rgba(0,0,0,.07);margin-bottom:12px;display:none}
    #info-panel-desc{font-size:var(--tt-font-size);color:var(--tt-text);line-height:1.7;opacity:.75}

    /* ── Text popup ──────────────────────────────── */
    #text-popup{
      position:fixed;inset:0;z-index:9999;
      background:rgba(0,0,0,.52);
      display:flex;align-items:center;justify-content:center;padding:40px;
      opacity:0;visibility:hidden;pointer-events:none;
      transition:opacity .28s ease,visibility .28s ease;
    }
    #text-popup.open{opacity:1;visibility:visible;pointer-events:auto}
    #text-popup.tp-closing{opacity:0;visibility:hidden;pointer-events:none}
    /* inner card animations — desktop (data-anim attribute set by JS from TOUR.panelAnimation) */
    #text-popup[data-anim="slide"].open #text-popup-inner{animation:_tpFadeSlideIn .32s cubic-bezier(.22,1,.36,1) both}
    #text-popup[data-anim="slide"].tp-closing #text-popup-inner{animation:_tpFadeSlideOut .22s ease-in both}
    #text-popup[data-anim="fade"].open #text-popup-inner{animation:_tpFadeIn .3s ease both}
    #text-popup[data-anim="fade"].tp-closing #text-popup-inner{animation:_tpFadeOut .22s ease-in both}
    #text-popup[data-anim="zoom"].open #text-popup-inner{animation:_tpZoomIn .32s cubic-bezier(.22,1,.36,1) both}
    #text-popup[data-anim="zoom"].tp-closing #text-popup-inner{animation:_tpZoomOut .22s ease-in both}
    #text-popup[data-anim="flip"].open #text-popup-inner{animation:_tpFlipIn .38s cubic-bezier(.22,1,.36,1) both}
    #text-popup[data-anim="flip"].tp-closing #text-popup-inner{animation:_tpFlipOut .24s ease-in both}
    #text-popup-inner{
      background:var(--tt-panel-bg);border-radius:var(--radius);
      max-width:680px;width:100%;max-height:80vh;overflow-y:auto;
      padding:48px 52px 52px;position:relative;
    }
    #text-popup-close{
      position:fixed;top:14px;right:14px;z-index:10002;
      width:34px;height:34px;border-radius:50%;
      border:none;background:#f0f0f0;cursor:pointer;
      font-size:16px;display:none;align-items:center;justify-content:center;
    }
    #text-popup.open #text-popup-close{display:flex}
    #text-popup-close:hover{background:#e0e0e0}
    #text-popup-title{font-size:clamp(22px,4vw,34px);font-weight:800;color:var(--tt-text);margin-bottom:18px;line-height:1.2}
    #text-popup-body{font-size:var(--tt-font-size);line-height:1.72;color:var(--tt-text);opacity:.8}
    #text-popup-body p{margin-bottom:1em}

    /* ── Video popup ─────────────────────────────── */
    #video-popup{
      position:fixed;inset:0;z-index:200;
      background:rgba(0,0,0,.9);
      display:flex;align-items:center;justify-content:center;padding:32px;
      opacity:0;pointer-events:none;transition:opacity .2s;
    }
    #video-popup.open{opacity:1;pointer-events:all}
    #video-popup-inner{position:relative;width:100%;max-width:900px}
    #video-popup-close{
      position:absolute;top:-44px;right:0;
      background:rgba(255,255,255,.15);color:#fff;border:none;
      width:36px;height:36px;border-radius:50%;cursor:pointer;
      font-size:18px;display:flex;align-items:center;justify-content:center;
    }
    #video-popup-close:hover{background:rgba(255,255,255,.3)}
    #video-aspect{position:relative;padding-top:56.25%}
    #video-iframe,#video-tag{
      position:absolute;top:0;left:0;width:100%;height:100%;
      border:none;border-radius:8px;background:#000;
    }

    /* ── Form popup ─────────────────────────────── */
    #form-popup{
      position:fixed;inset:0;z-index:200;
      background:rgba(0,0,0,.52);
      display:flex;align-items:center;justify-content:center;padding:40px;
      opacity:0;pointer-events:none;transition:opacity .2s;
    }
    #form-popup.open{opacity:1;pointer-events:all}
    #form-popup-inner{
      background:var(--tt-panel-bg);border-radius:var(--radius);
      max-width:520px;width:100%;max-height:82vh;overflow-y:auto;
      padding:36px 40px 40px;position:relative;
    }
    #form-popup-close{
      position:absolute;top:12px;right:12px;
      width:32px;height:32px;border-radius:50%;
      border:none;background:#f0f0f0;cursor:pointer;font-size:16px;
      display:flex;align-items:center;justify-content:center;
    }
    #form-popup-close:hover{background:#e0e0e0}
    #form-popup-title{font-size:22px;font-weight:700;color:var(--tt-text);margin-bottom:18px}
    .form-field{margin-bottom:14px}
    .form-label{display:block;font-size:13px;font-weight:600;color:var(--tt-text);opacity:.6;margin-bottom:4px}
    .form-input{width:100%;border:1.5px solid #ddd;border-radius:8px;padding:9px 12px;font-size:15px;outline:none;font-family:inherit;color:var(--tt-text);background:var(--tt-panel-bg)}
    .form-input:focus{border-color:var(--accent)}
    .form-submit{width:100%;margin-top:8px;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:calc(var(--radius) / 1.5);font-size:15px;font-weight:600;cursor:pointer;font-family:inherit}
    .form-submit:hover{opacity:.9}

    /* ── Cookie banner ───────────────────────────── */
    #cookie-banner{
      position:fixed;bottom:156px;left:50%;transform:translateX(-50%);
      z-index:10001;background:rgba(18,18,22,.94);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
      border:1px solid rgba(255,255,255,.1);border-radius:12px;
      padding:14px 20px;display:flex;align-items:center;gap:16px;
      max-width:640px;width:calc(100% - 32px);
    }
    #cookie-text{flex:1;font-size:13px;color:rgba(255,255,255,.88);line-height:1.5;font-family:-apple-system,sans-serif}
    #cookie-accept{
      flex-shrink:0;background:${accentColor};color:#fff;
      border:none;border-radius:7px;padding:7px 16px;
      cursor:pointer;font-size:13px;font-weight:700;white-space:nowrap;
    }
    #cookie-accept:hover{filter:brightness(1.1)}
    ${copyright ? `#tour-copyright{position:fixed;bottom:0;right:12px;z-index:45;font-size:10px;color:rgba(255,255,255,.28);pointer-events:none;padding-bottom:2px}` : ''}
    #tour-footer{position:fixed;bottom:8px;left:12px;z-index:44;display:flex;align-items:center;gap:4px;padding:5px 12px;font-size:11px;background:rgba(0,0,0,.45);backdrop-filter:blur(10px);border-radius:6px;box-shadow:0 1px 6px rgba(0,0,0,.35)}
    #tour-footer a{color:rgba(255,255,255,.80);text-decoration:none;transition:.15s}
    #tour-footer a:hover{color:#fff;text-decoration:underline}
    #tour-footer .tf-sep{color:rgba(255,255,255,.35);margin:0 2px}

    /* ── UI toast ───────────────────────────── */
    #ui-toast{
      position:fixed;top:68px;left:50%;transform:translateX(-50%);
      background:rgba(18,18,22,.92);color:#fff;
      padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;
      z-index:300;opacity:0;pointer-events:none;
      transition:opacity .2s;white-space:nowrap;
    }
    #ui-toast.visible{opacity:1}

    /* ── Mobile fullscreen description overlay ──────── */
    #desc-overlay{
      display:none;position:fixed;inset:0;z-index:250;
      background:rgba(0,0,0,.85);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
      flex-direction:column;padding:0;
      transform:translateY(100%);transition:transform .3s cubic-bezier(.22,1,.36,1);
    }
    #desc-overlay.open{transform:translateY(0)}
    #desc-overlay-inner{
      position:relative;flex:1;overflow-y:auto;
      padding:56px 24px 40px;
      color:#fff;
    }
    #desc-overlay-close{
      position:absolute;top:12px;right:12px;
      width:44px;height:44px;border-radius:50%;
      border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);
      color:#fff;font-size:20px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
    }
    #desc-overlay-title{font-size:clamp(22px,6vw,34px);font-weight:800;line-height:1.2;margin-bottom:16px}
    #desc-overlay-body{font-size:clamp(15px,4vw,19px);line-height:1.7;color:rgba(255,255,255,.88)}

    /* ── Mobile-only elements (hidden on desktop) ──────── */
    #mob-drag-handle{display:none}
    #mob-scene-header{display:none}
    #mob-mini-map{display:none}
    #mob-reveal-btn{display:none;position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:49;background:rgba(0,0,0,.72);color:#fff;border:none;border-radius:20px;padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;box-shadow:0 2px 12px rgba(0,0,0,.35);transition:opacity .2s}
    @keyframes _mobSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
    @keyframes _mobSlideDown{from{transform:translateY(0)}to{transform:translateY(100%)}}
    @keyframes _tpFadeSlideIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
    @keyframes _tpFadeSlideOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(14px)}}
    @keyframes _tpFadeIn{from{opacity:0}to{opacity:1}}
    @keyframes _tpFadeOut{from{opacity:1}to{opacity:0}}
    @keyframes _tpZoomIn{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}
    @keyframes _tpZoomOut{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.92)}}
    @keyframes _tpFlipIn{from{opacity:0;transform:perspective(800px) rotateX(-10deg)}to{opacity:1;transform:perspective(800px) rotateX(0)}}
    @keyframes _tpFlipOut{from{opacity:1;transform:perspective(800px) rotateX(0)}to{opacity:0;transform:perspective(800px) rotateX(-10deg)}}

    /* ── Mobile responsive (Street View pattern) ──── */
    @media(max-width:768px){
      /* ── 1. Fixed-position layout (replaces CSS Grid) ── */
      body{display:block!important;height:100dvh!important;overflow:hidden!important}

      /* Panorama fills full screen — mob-sheet overlays on top */
      #pano{
        position:fixed!important;top:0!important;left:0!important;right:0!important;
        height:100dvh!important;
        transition:height .3s ease!important;
      }
      body.pano-only #pano{height:100dvh!important}

      /* Map panel — extends to bottom of screen so it goes under mob-sheet (z-index 200) */
      #map-panel{
        position:fixed!important;
        left:0!important;right:0!important;bottom:0!important;top:auto!important;
        height:0!important;overflow:hidden!important;
        width:100%!important;z-index:50!important;
        transform:none!important;
        transition:height .3s ease!important;
      }
      #map-panel.open{transform:none!important}
      #map-close{display:none!important}
      #leaflet-map{height:100%!important;min-height:0!important}

      /* mob-map-open: 50/50 split (pano 50dvh top, map extends to bottom under mob-sheet) */
      body.mob-map-open #pano{height:50dvh!important}
      body.mob-map-open #map-panel{height:50dvh!important}

      /* ── 2. Floating pill header ──────────────── */
      #tour-hdr{
        position:fixed!important;
        top:env(safe-area-inset-top,12px)!important;
        left:12px!important;right:12px!important;
        height:auto!important;padding:0!important;
        background:transparent!important;box-shadow:none!important;
        z-index:1000!important;
        display:flex!important;align-items:center!important;gap:8px!important;
        pointer-events:none!important;
      }
      #tour-hdr>*{pointer-events:all!important}
      #hdr-logo{
        flex:1!important;min-width:0!important;
        background:rgba(26,36,52,.85)!important;
        backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
        border-radius:999px!important;
        padding:6px 14px 6px 6px!important;
        gap:10px!important;
        display:flex!important;align-items:center!important;
        max-width:calc(100% - 116px)!important;
      }
      #hdr-logo *{color:#fff!important}
      #hdr-logo-img{height:22px!important;width:auto!important;max-width:80px!important;border-radius:4px!important;object-fit:contain!important;flex-shrink:0!important}
      #hdr-logo-img.hdr-initial{display:flex!important;align-items:center!important;justify-content:center!important;width:26px!important;height:26px!important;border-radius:6px!important;background:#555!important;font-size:13px!important;font-weight:700!important;letter-spacing:0!important}
      #hdr-logo-text{font-size:14px!important;font-weight:600!important;line-height:1.2!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;min-width:0!important}
      #hdr-title{display:none!important}
      .hdr-sep{display:none!important}
      #hdr-actions{display:flex!important;gap:8px!important;align-items:center!important;flex-shrink:0!important}
      /* Hide ALL header buttons on mobile by default */
      #hdr-actions .hdr-btn,#hdr-actions a.hdr-btn{display:none!important}
      /* Show only ⋮ and X on mobile */
      #mob-more-btn,#mob-close-btn{
        display:flex!important;
        width:44px!important;height:44px!important;border-radius:50%!important;
        background:rgba(26,36,52,.85)!important;
        backdrop-filter:blur(8px)!important;-webkit-backdrop-filter:blur(8px)!important;
        color:#fff!important;border:none!important;
        align-items:center!important;justify-content:center!important;
        cursor:pointer!important;padding:0!important;font-size:16px!important;
        box-shadow:0 2px 8px rgba(0,0,0,.2)!important;
        min-width:0!important;
      }
      #lang-sel{display:none!important}
      #hs-preview{display:none!important}

      /* ── 3. ⋮ More popover ─────────────────────── */
      #info-btn,#fs-btn,button[title="VR / Cardboard"],button[title="Contact form"],a[title="Send feedback"]{display:none!important}
      #mob-more-popover{
        position:fixed;top:calc(env(safe-area-inset-top,12px) + 56px);
        right:12px;z-index:1001;
        background:rgba(20,20,20,.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
        border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.35);
        padding:6px;display:flex;flex-direction:column;gap:0;
        min-width:180px;opacity:0;pointer-events:none;
        transform:translateY(-6px) scale(.96);transition:opacity .15s,transform .15s;
      }
      #mob-more-popover.open{opacity:1;pointer-events:all;transform:translateY(0) scale(1)}
      .mob-more-item{
        display:flex;align-items:center;gap:10px;
        height:44px;border-radius:10px;font-size:14px;font-weight:500;
        color:#fff;background:none;border:none;cursor:pointer;padding:0 14px;
        text-align:left;width:100%;transition:background .1s;
      }
      .mob-more-item:hover,.mob-more-item:active{background:rgba(255,255,255,.12)}
      .mob-more-item svg{flex-shrink:0;opacity:.75}

      /* ── 4. Collapse/expand FAB ── */
      #mob-pano-toggle{
        position:fixed!important;right:16px!important;bottom:104px!important;
        width:52px!important;height:52px!important;border-radius:50%!important;
        background:rgba(26,36,52,.85)!important;
        backdrop-filter:blur(8px)!important;-webkit-backdrop-filter:blur(8px)!important;
        color:#fff!important;border:none!important;cursor:pointer!important;
        display:none!important;
        align-items:center!important;justify-content:center!important;
        z-index:600!important;
        box-shadow:0 2px 10px rgba(0,0,0,.3)!important;
        transition:bottom .3s ease!important;
      }
      body.has-map #mob-pano-toggle{display:flex!important}
      body.mob-map-open #mob-pano-toggle{bottom:calc(50dvh + 16px)!important}
      /* Old FAB — hidden */
      #mob-collapse-toggle{display:none!important}

      /* ── 5. Bottom sheet — overlays pano/map via z-index:200 ── */
      #mob-sheet{
        position:fixed!important;left:0!important;right:0!important;bottom:0!important;
        height:88px!important;background:#fff!important;
        border-radius:24px 24px 0 0!important;
        box-shadow:0 -2px 16px rgba(0,0,0,.1)!important;
        z-index:200!important;
        display:flex!important;flex-direction:column!important;
        padding:8px 16px 16px!important;
      }
      body.pano-only #mob-sheet{display:none!important}
      #mob-sheet-handle{
        width:36px!important;height:4px!important;background:#d0d0d0!important;
        border-radius:2px!important;margin:0 auto 6px!important;flex-shrink:0!important;
      }
      #mob-sheet-content{display:flex!important;align-items:center!important;gap:12px!important;flex:1!important;min-height:0!important}
      #mob-sheet-text{flex:1!important;min-width:0!important}
      #mob-scene-title{
        font-size:16px!important;font-weight:700!important;color:#1a1a1a!important;
        margin:0 0 2px!important;line-height:1.2!important;
        white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;
        display:block!important;
      }
      #mob-scene-cat{
        font-size:13px!important;color:#6b6b6b!important;margin:0!important;
        white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;
        display:block!important;
      }
      #mob-sheet-detail{
        width:44px!important;height:44px!important;flex-shrink:0!important;
        border-radius:50%!important;background:#f0f0f0!important;
        border:none!important;cursor:pointer!important;
        display:flex!important;align-items:center!important;justify-content:center!important;
        color:#1a1a1a!important;font-size:18px!important;
      }

      /* Old strip-outer — hidden on mobile (replaced by mob-sheet) */
      #strip-outer{display:none!important}
      #mob-reveal-btn{display:none!important}

      /* Share popover repositioned above sheet when triggered from mobile */
      #share-popover{top:auto!important;bottom:104px!important;right:16px!important}

      /* ── 6. Info panel ────────────────────────── */
      #info-panel{right:0;left:0;top:auto;bottom:0;width:100%;max-height:60vh;border-radius:16px 16px 0 0;box-shadow:0 -4px 32px rgba(0,0,0,.25)}
      #desc-overlay{display:flex}

      /* ── 7. Full-screen text popup ──────── */
      #text-popup{background:#fff!important;align-items:stretch!important;padding:0!important}
      #text-popup-inner{max-width:100%!important;width:100%!important;min-height:100vh!important;border-radius:0!important;padding:76px 22px 40px!important;overflow-y:auto;max-height:none!important}
      #text-popup-close{top:env(safe-area-inset-top,14px)!important;right:14px!important;width:44px!important;height:44px!important;background:rgba(255,255,255,.95)!important;color:#2563eb!important;font-size:22px!important;font-weight:700!important;}
      #text-popup-title{font-size:36px!important;font-weight:800!important;line-height:1.1!important;letter-spacing:-.5px;margin:0 0 24px!important;color:#1a1a1a!important;text-transform:uppercase}
      #text-popup-body{font-size:18px!important;line-height:1.65!important;color:#333!important;opacity:1}
      /* Mobile: full-screen panel animations override desktop ones */
      #text-popup[data-anim="slide"].open #text-popup-inner{animation:_mobSlideUp .38s cubic-bezier(.22,1,.36,1) both!important}
      #text-popup[data-anim="slide"].tp-closing #text-popup-inner{animation:_mobSlideDown .26s cubic-bezier(.55,0,.1,1) both!important}
      #text-popup[data-anim="fade"].open #text-popup-inner{animation:_tpFadeIn .3s ease both!important}
      #text-popup[data-anim="fade"].tp-closing #text-popup-inner{animation:_tpFadeOut .22s ease-in both!important}
      #text-popup[data-anim="zoom"].open #text-popup-inner{animation:_tpZoomIn .32s cubic-bezier(.22,1,.36,1) both!important}
      #text-popup[data-anim="zoom"].tp-closing #text-popup-inner{animation:_tpZoomOut .22s ease-in both!important}
      #text-popup[data-anim="flip"].open #text-popup-inner{animation:_tpFlipIn .38s cubic-bezier(.22,1,.36,1) both!important}
      #text-popup[data-anim="flip"].tp-closing #text-popup-inner{animation:_tpFlipOut .24s ease-in both!important}
    }
    @media(max-width:480px){
      #hdr-title{display:none}
    }
    @media(hover:none){
      .sc-wrap::after{display:none}
    }
    .map-pin-popup{width:200px}
    .map-pin-thumb{width:100%;height:100px;object-fit:cover;display:block;border-radius:0}
    .map-pin-body{padding:8px 10px 10px}
    .map-pin-title{font-size:13px;font-weight:600;color:#111;margin:0 0 6px;line-height:1.3}
    .map-pin-visit{width:100%;padding:5px 0;background:${accentColor};color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer}
    .map-pin-visit:hover{opacity:.85}
    .map-popup-wrap .leaflet-popup-content-wrapper{border-radius:10px;padding:0;overflow:hidden}
    .map-popup-wrap .leaflet-popup-content{margin:0}
    .leaflet-marker-icon{overflow:visible!important}
    /* ── Map dot markers ──────────────────────────── */
    .mp{position:relative;width:64px;height:64px;display:flex;align-items:center;justify-content:center}
    .mp-radar{position:absolute;inset:0;pointer-events:none;transform-origin:50% 50%;transition:transform .08s linear}
    .mp-dot{
      position:relative;z-index:1;width:22px;height:22px;border-radius:50%;
      background:var(--cc);border:2.5px solid #fff;
      box-shadow:0 0 0 1px rgba(0,0,0,.25),0 2px 8px rgba(0,0,0,.4);
      animation:mpPulse 2s ease-in-out infinite;
      display:flex;align-items:center;justify-content:center;
    }
    .mp.mp-off .mp-dot{width:14px;height:14px;border-width:2px;opacity:.7;animation:none}
    .mp.mp-off .mp-radar{display:none}
    .mp-icon{width:12px;height:12px;color:#fff;pointer-events:none;flex-shrink:0}
    .mp.mp-off .mp-icon{width:7px;height:7px}
    .mp-icon svg{display:block;width:100%;height:100%}
    @keyframes mpPulse{
      0%{box-shadow:0 0 0 1px rgba(0,0,0,.25),0 2px 8px rgba(0,0,0,.4),0 0 0 0 color-mix(in srgb,var(--cc) 60%,transparent)}
      70%{box-shadow:0 0 0 1px rgba(0,0,0,.25),0 2px 8px rgba(0,0,0,.4),0 0 0 9px transparent}
      100%{box-shadow:0 0 0 1px rgba(0,0,0,.25),0 2px 8px rgba(0,0,0,.4),0 0 0 0 transparent}
    }
    .mp{transition:transform .2s ease}
    .mp:hover,.mp.mp-hover{transform:scale(1.22)!important;z-index:1000!important}
    .mp.mp-off:hover .mp-dot,.mp.mp-off.mp-hover .mp-dot{box-shadow:0 0 0 1px rgba(0,0,0,.3),0 0 16px rgba(255,255,255,.5)}
    #map-toast{
      position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:600;
      background:rgba(8,8,10,.82);color:#fff;font-size:12px;font-weight:600;
      font-family:-apple-system,sans-serif;white-space:nowrap;
      padding:5px 14px 6px;border-radius:20px;pointer-events:none;
      opacity:0;transition:opacity .25s;max-width:320px;
      text-overflow:ellipsis;overflow:hidden;
    }
    #map-toast.visible{opacity:1}
    /* ── Loading splash ─────────────────────────────────── */
    #splash{
      position:fixed;inset:0;z-index:9999;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      background:${primaryColor};
      transition:opacity .5s ease;
    }
    #splash.hidden{opacity:0;pointer-events:none}
    #splash-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
    ${loaderImgSrc ? `#splash::before{content:'';position:absolute;inset:0;z-index:1;background:rgba(0,0,0,.36)}` : ''}
    #splash-content{
      position:relative;z-index:2;
      text-align:center;padding:0 40px;
      max-width:700px;width:100%;
      animation:${splashAnimName} .9s cubic-bezier(.22,1,.36,1) .3s both;
    }
    #splash-title{
      font-family:${introFontFamily};
      font-size:${Math.round(introFontSize * 1.65)}px;
      font-weight:800;color:#fff;
      text-shadow:0 2px 24px rgba(0,0,0,.45);
      letter-spacing:-.025em;line-height:1.15;
      margin-bottom:${introText ? '16px' : '0'};
    }
    #splash-intro{
      font-family:${introFontFamily};
      font-size:${introFontSize}px;
      color:rgba(255,255,255,.88);
      text-shadow:0 1px 14px rgba(0,0,0,.5);
      line-height:1.7;font-weight:400;
      white-space:pre-line;
    }
    #splash-spinner{
      position:absolute;bottom:40px;left:50%;margin-left:-18px;
      z-index:2;
      width:36px;height:36px;border-radius:50%;
      border:3px solid rgba(255,255,255,.25);border-top-color:#fff;
      animation:_spin .8s linear infinite;
    }
    @keyframes _spin{to{transform:rotate(360deg)}}
    @keyframes _splashFade{from{opacity:0}to{opacity:1}}
    @keyframes _splashSlide{from{opacity:0;transform:translateY(36px)}to{opacity:1;transform:translateY(0)}}
    @keyframes _splashZoom{from{opacity:0;transform:scale(.88)}to{opacity:1;transform:scale(1)}}
  </style>
</head>
<body${bodyClasses ? ` class="${bodyClasses}"` : ''}>
  <div id="pano"></div>

  <div id="splash">
    ${loaderImgSrc ? `<img id="splash-img" src="${loaderImgSrc}" alt="">` : ''}
    <div id="splash-content">
      <div id="splash-title">${xmlEsc(projectTitle)}</div>
      ${introText ? `<p id="splash-intro">${introText}</p>` : ''}
    </div>
    <div id="splash-spinner"></div>
  </div>

  <div id="hs-preview" aria-hidden="true">
    <div class="hsp-img-wrap"><img class="hsp-img" src="" alt=""/></div>
    <div class="hsp-badges"></div>
    <div class="hsp-title"></div>
  </div>

  <header id="tour-hdr">
    <div id="hdr-logo">
      ${logoImgHtml}
      <span id="hdr-logo-text">${xmlEsc(projectTitle)}</span>
    </div>
    <div id="hdr-title"></div>
    <div id="hdr-actions">
      ${mapHdrBtn}${langHdrBtns}${shareHdrHtml}<button class="hdr-btn" id="info-btn" onclick="_toggleInfo()" title="Scene info">&#x2139;</button>${(modules.feedbackMailto as string | undefined)?.trim() ? ((modules as any).formsEnabled ? `<button class="hdr-btn" onclick="showFormHs('__contact__')" title="Contact form">&#x2709;</button>` : `<a class="hdr-btn" href="mailto:${xmlEsc((modules.feedbackMailto as string).trim())}" title="Send feedback">&#x2709;</a>`) : ''}${modules.vr ? `<button class="hdr-btn" onclick="if(_krpano)_krpano.call('webvr.enterVR()')" title="VR / Cardboard">VR</button>` : ''}${modules.fullscreen !== false ? `<button class="hdr-btn" onclick="_toggleFs()" id="fs-btn" title="Fullscreen">&#x26F6;</button>` : ''}<button class="hdr-btn" id="mob-more-btn" onclick="_toggleMobMore()" title="More" style="display:none">&#x22EE;</button><button id="mob-close-btn" onclick="_mobileShare()" aria-label="Share" style="display:none"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg></button>
    </div>
  </header>
${sharePopoverHtml}${mobMorePopoverHtml}
${showMap ? `  <div id="map-panel">
    <button id="map-close" aria-label="Close map">&#x2715;</button>
    <div id="map-toast"></div>
    <div id="leaflet-map"></div>
  </div>\n` : ''}
  <div id="info-panel">
    <button id="info-panel-close" onclick="_toggleInfo()" aria-label="Close">&#x2715;</button>
    <span id="info-panel-cat"></span>
    <h2 id="info-panel-title"></h2>
    <div id="info-panel-rule"></div>
    <p id="info-panel-desc"></p>
  </div>

  <div id="text-popup" role="dialog" aria-modal="true">
    <button id="text-popup-close" onclick="closeTextPopup()" aria-label="Close">&#x2715;</button>
    <div id="text-popup-inner">
      <h2 id="text-popup-title"></h2>
      <div id="text-popup-body"></div>
    </div>
  </div>

  <div id="video-popup" role="dialog" aria-modal="true">
    <div id="video-popup-inner">
      <button id="video-popup-close" onclick="closeVideoPopup()" aria-label="Close">&#x2715;</button>
      <div id="video-aspect">
        <iframe id="video-iframe" src="" frameborder="0" allowfullscreen allow="autoplay; fullscreen"></iframe>
        <video id="video-tag" controls playsinline style="display:none;background:#000"></video>
      </div>
    </div>
  </div>

  <div id="form-popup" role="dialog" aria-modal="true">
    <div id="form-popup-inner">
      <button id="form-popup-close" onclick="closeFormPopup()" aria-label="Close">&#x2715;</button>
      <h2 id="form-popup-title"></h2>
      <div id="form-popup-fields"></div>
      <button class="form-submit" onclick="_submitForm()">Send</button>
    </div>
  </div>

  <div id="strip-outer">
    <div id="mob-drag-handle"><div class="mob-drag-bar"></div></div>
    <div id="mob-scene-header">
      <div id="mob-scene-title-txt"></div>
      ${hasShare ? `<button id="mob-share-btn" onclick="window._mobileShare&&window._mobileShare()" title="Share">&#x2197;&#xFE0E;</button>` : ''}
    </div>
    <div id="strip-scroll">${sceneCardsHtml}</div>
  </div>
  <button id="mob-reveal-btn" onclick="_mobShowPanel()" aria-label="Show scene info">&#x25B2; Scene info</button>
  ${(showMap || mobView === 'strip') ? `<button id="mob-collapse-toggle" onclick="_mobToggleCollapse()" aria-label="Toggle panel" style="display:none"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>` : ''}
  ${showMap ? `<button id="mob-pano-toggle" onclick="_togglePanoMap()" aria-label="Toggle map"><svg id="mob-toggle-icon-collapse" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg><svg id="mob-toggle-icon-expand" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" hidden><polyline points="6 15 12 9 18 15"/></svg></button>` : ''}
  <div id="mob-sheet">
    <div id="mob-sheet-handle"></div>
    <div id="mob-sheet-content">
      <div id="mob-sheet-text">
        <span id="mob-scene-title">${xmlEsc(initialSheetTitle)}</span>
        <span id="mob-scene-cat">${xmlEsc(initialSheetCat)}</span>
      </div>
      <button id="mob-sheet-detail" onclick="_openSceneDetail()" aria-label="Scene info"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg></button>
    </div>
  </div>
  ${cookieHtml}
  ${copyright ? `<div id="tour-copyright">${copyright}</div>` : ''}
  ${isTrialBuild ? `<div id="trial-watermark" style="position:fixed;bottom:12px;right:12px;background:rgba(0,0,0,0.75);color:white;padding:8px 14px;border-radius:6px;font-family:system-ui,sans-serif;font-size:12px;z-index:99999;pointer-events:auto;box-shadow:0 4px 12px rgba(0,0,0,.2);"><a href="https://conchitour.com" target="_blank" style="color:white;text-decoration:none;">${xmlEsc(TRIAL_LIMITS.watermarkText)}</a></div>` : ''}
  ${tourFooterHtml}
  <div id="ui-toast"></div>

  <!-- Mobile fullscreen description overlay -->
  <div id="desc-overlay" role="dialog" aria-modal="true">
    <div id="desc-overlay-inner">
      <button id="desc-overlay-close" onclick="_closeDescOverlay()" aria-label="Close">&#x2715;</button>
      <h2 id="desc-overlay-title"></h2>
      <div id="desc-overlay-body"></div>
    </div>
  </div>
  <script>
  var TOUR = ${tourDataJson};
  window.__scenesIndex = ${scenesIndexJson};
  window.__categoriesIndex = ${categoriesIndexJson};
  window.__sceneCategoriesIndex = ${sceneCategoriesIndexJson};
  window.__sceneHotspotMap = ${sceneHotspotMapJson};
  window.__mapTourSync = ${JSON.stringify(!!(project as any).modules?.mapTourSync)};
  window.__defaultLang = '${defaultLang}';
  window._curLang = '${lang}';
  // Returns the localized scene title, or '' — NEVER falls back to a slug.
  window._displayTitle = function(slug) {
    var idx = window.__scenesIndex && window.__scenesIndex[slug];
    if (!idx) return '';
    var t = idx.title || {};
    var raw = t[window._curLang] || t[window.__defaultLang] || Object.values(t)[0] || '';
    if (!raw) return '';
    var tNorm = raw.replace(/[-_]/g, ' ').toLowerCase().trim();
    var sNorm = slug.replace(/[-_]/g, ' ').toLowerCase().trim();
    return (tNorm !== sNorm) ? raw : '';
  };
  function _setHeaderTitle() {
    var el = document.getElementById('hdr-title');
    if (el) {
      var t = _curScene ? _displayTitle(_curScene) : '';
      el.textContent = t;
      el.title = t;
    }
    if (!_curScene) return;
    var scene = TOUR.scenes && TOUR.scenes[_curScene];
    // Update mobile sheet scene title
    var st = document.getElementById('mob-scene-title');
    if (st) {
      var idx = window.__scenesIndex && window.__scenesIndex[_curScene];
      if (idx) {
        var raw = idx.title || {};
        st.textContent = raw[window._curLang] || raw[window.__defaultLang] || Object.values(raw)[0] || _curScene;
      }
    }
    // Update mobile sheet category
    var sc = document.getElementById('mob-scene-cat');
    if (sc && scene) {
      var catId = scene.categoryIds && scene.categoryIds[0];
      var cat = catId && TOUR.categories && TOUR.categories[catId];
      sc.textContent = cat ? (cat.name || '') : '';
    }
  }
  var _krpano    = null;
  var _curScene  = '';
  var _firstDone = false;
  // Init to viewport center so preview appears near the hotspot even before first mousemove
  var _mx = Math.round(window.innerWidth / 2), _my = Math.round(window.innerHeight / 2);
  function _updateMouse(e){ _mx = e.clientX; _my = e.clientY; _positionPreview(); }
  // Use both mousemove and pointermove — krpano may intercept one but not the other
  document.addEventListener('mousemove',   _updateMouse);
  document.addEventListener('pointermove', _updateMouse);

  function _positionPreview() {
    var el = document.getElementById('hs-preview');
    if (!el || !el.classList.contains('visible')) return;
    var w = el.offsetWidth || 200, h = el.offsetHeight || 140;
    var x = _mx + 18, y = _my - Math.round(h / 2);
    if (x + w > window.innerWidth)  x = _mx - w - 18;
    if (y < 8) y = 8;
    if (y + h > window.innerHeight) y = window.innerHeight - h - 8;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
  }
  window.showHotspotPreview = function(slug) {
    var scene = TOUR.scenes[slug];
    if (!scene) return;
    var el = document.getElementById('hs-preview');
    if (!el) return;
    var img = el.querySelector('.hsp-img');
    var ttl = el.querySelector('.hsp-title');
    var bdg = el.querySelector('.hsp-badges');
    if (img) {
      img.style.display = '';
      img.onerror = function() { this.style.display = 'none'; };
      img.src = scene.preview || '';
      img.alt = _displayTitle(slug);
    }
    if (ttl) ttl.textContent = _displayTitle(slug);
    if (bdg) {
      var cats = (window.__sceneCategoriesIndex && window.__sceneCategoriesIndex[slug]) || [];
      var bHtml = '';
      cats.slice(0, 5).forEach(function(catSlug) {
        var cat = window.__categoriesIndex && window.__categoriesIndex[catSlug];
        if (!cat) return;
        var nameMap = cat.name || {};
        var name = nameMap[window._curLang] || nameMap[window.__defaultLang] || Object.values(nameMap)[0] || catSlug;
        var iconContent = cat.iconSvg
          ? cat.iconSvg
          : '<span style="font-size:11px;font-weight:700;line-height:1">' + name.charAt(0).toUpperCase() + '</span>';
        bHtml += '<div class="hsp-badge" style="background:' + (cat.color || '#6b7280') + '" title="' + name + '">' + iconContent + '</div>';
      });
      bdg.innerHTML = bHtml;
    }
    el.classList.add('visible');
    _positionPreview();
  };
  window.hideHotspotPreview = function() {
    var el = document.getElementById('hs-preview');
    if (el) el.classList.remove('visible');
  };
  window._onHotspotHover = function(slug) {
    window.showHotspotPreview(slug);
    if (window.__mapTourSync && window._markers) {
      var m = window._markers[slug];
      if (m && m._icon) { var mp = m._icon.querySelector('.mp'); if (mp) mp.classList.add('mp-hover'); }
    }
  };
  window._onHotspotHoverOut = function(slug) {
    window.hideHotspotPreview();
    if (window.__mapTourSync && window._markers) {
      var m = window._markers[slug];
      if (m && m._icon) { var mp = m._icon.querySelector('.mp'); if (mp) mp.classList.remove('mp-hover'); }
    }
  };

  function _navTo(slug) {
    if (_krpano) _krpano.call('loadscene(scene_' + slug + ',null,MERGE,BLEND(0.5));');
  }

  window.__gaVisited = window.__gaVisited || {};
  window.__gaTourCompleted = false;

  function _onScene(xmlName) {
    var slug = (xmlName || '').replace(/^scene_/, '');
    if (!slug || !TOUR.scenes[slug] || slug === _curScene) return;
    var prevSlug = _curScene;
    _curScene = slug;
    // GA4: navigation events
    if (!_firstDone) { window._track('tour_started', {scene: slug}); }
    if (prevSlug) { window._track('scene_change', {from: prevSlug, to: slug}); }
    window._track('scene_view', {scene_slug: slug});
    window.__gaVisited[slug] = 1;
    if (!window.__gaTourCompleted && Object.keys(window.__gaVisited).length >= Object.keys(TOUR.scenes).length) {
      window.__gaTourCompleted = true;
      window._track('tour_completed', {total: Object.keys(TOUR.scenes).length});
    }
    var scene = TOUR.scenes[slug];
    var titleEl = document.getElementById('hdr-title');
    var dispTitle = _displayTitle(slug);
    if (titleEl) { titleEl.textContent = dispTitle; titleEl.title = dispTitle; }
    document.title = dispTitle ? dispTitle + ' — ' + TOUR.projectTitle : TOUR.projectTitle;
    var mobTitleEl = document.getElementById('mob-scene-title-txt');
    if (mobTitleEl) mobTitleEl.textContent = dispTitle;
    document.querySelectorAll('.sc-wrap').forEach(function(el) {
      el.classList.toggle('cur', el.getAttribute('data-slug') === slug);
    });
    var active = document.querySelector('.sc-wrap.cur');
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    // Update info panel
    var catId = scene.categoryIds && scene.categoryIds[0];
    var cat = catId && TOUR.categories ? TOUR.categories[catId] : null;
    var catEl = document.getElementById('info-panel-cat');
    if (catEl) {
      if (cat) {
        catEl.style.display = 'inline-block';
        catEl.textContent = cat.name || '';
        catEl.style.color = cat.color || '#333';
        catEl.style.border = '1px solid ' + (cat.color || '#333') + '55';
        catEl.style.background = (cat.color || '#333') + '18';
      } else { catEl.style.display = 'none'; }
    }
    var ttlEl = document.getElementById('info-panel-title');
    if (ttlEl) ttlEl.textContent = dispTitle;
    var descEl = document.getElementById('info-panel-desc');
    if (descEl) descEl.textContent = scene.description || '';
    var ruleEl = document.getElementById('info-panel-rule');
    if (ruleEl) ruleEl.style.display = scene.description ? 'block' : 'none';
    var newPath = '/scene/' + slug + '/' + TOUR.lang + '/';
    if (window.location.pathname !== newPath) {
      try {
        if (!_firstDone) { history.replaceState({ scene: slug }, '', newPath); }
        else             { history.pushState({ scene: slug }, '', newPath); }
      } catch(e) {}
    }
    _firstDone = true;
    // Part 3/4: notify map of scene change
    if (window._onSceneMap) window._onSceneMap(prevSlug, slug);
    _setHeaderTitle();
  }

  window.addEventListener('popstate', function(e) {
    var slug = e.state && e.state.scene;
    if (slug && _krpano) _krpano.call('loadscene(scene_' + slug + ',null,MERGE,BLEND(0.5));');
  });

  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    var mmp = document.getElementById('mob-more-popover');
    if (mmp && mmp.classList.contains('open')) { mmp.classList.remove('open'); return; }
    var closed = false;
    ['text-popup','video-popup','form-popup'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el && el.classList.contains('open')) {
        el.classList.remove('open');
        if (id === 'text-popup') document.body.style.overflow = '';
        closed = true;
      }
    });
    if (!closed) {
      var mp = document.getElementById('map-panel');
      if (mp && mp.classList.contains('open')) { mp.classList.remove('open'); closed = true; }
    }
    if (!closed) {
      var ip = document.getElementById('info-panel');
      if (ip && ip.classList.contains('open')) { ip.classList.remove('open'); }
    }
  });

  function _toggleInfo() {
    // On mobile (pointer:coarse or narrow screen) → fullscreen overlay
    if (window.matchMedia('(max-width:768px),(pointer:coarse)').matches) {
      _openDescOverlay();
      window._track('info_panel_open');
      return;
    }
    var p = document.getElementById('info-panel');
    if (!p) return;
    p.classList.toggle('open');
    var b = document.getElementById('info-btn');
    if (b) b.style.background = p.classList.contains('open') ? '#f0f0f0' : '';
    if (p.classList.contains('open')) window._track('info_panel_open');
  }

  // Scene strip — click handled via inline onclick; hover animation is CSS-only

  // Text hotspot popup
  window.showTextHs = function(id) {
    var data = TOUR.hotspotTexts && TOUR.hotspotTexts[id];
    if (!data) return;
    document.getElementById('text-popup-title').textContent = data.title || '';
    document.getElementById('text-popup-body').innerHTML = data.body || '';
    var popup = document.getElementById('text-popup');
    if (popup) {
      popup.setAttribute('data-anim', TOUR.panelAnimation || 'slide');
      popup.classList.remove('tp-closing');
      popup.classList.add('open');
    }
    document.body.style.overflow = 'hidden';
    window._track('info_hotspot_open', {id: id, title: data.title || ''});
  };
  window.closeTextPopup = function() {
    var popup = document.getElementById('text-popup');
    if (!popup) return;
    var anim = TOUR.panelAnimation || 'slide';
    if (anim === 'none') {
      popup.classList.remove('open');
      document.body.style.overflow = '';
    } else {
      popup.classList.add('tp-closing');
      setTimeout(function() {
        popup.classList.remove('open','tp-closing');
        document.body.style.overflow = '';
      }, 280);
    }
  };
  // Mobile bottom-sheet chevron → open scene title+description in white full-screen popup
  window._openSceneDetail = function() {
    var title = (typeof _displayTitle === 'function') ? (_displayTitle(_curScene) || _curScene || '') : (_curScene || '');
    var scene = _curScene ? TOUR.scenes[_curScene] : null;
    var desc = scene ? (scene.description || '') : '';
    var titleEl = document.getElementById('text-popup-title');
    var bodyEl = document.getElementById('text-popup-body');
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.innerHTML = desc ? '<p>' + String(desc).replace(/\\n\\n/g, '<\/p><p>').replace(/\\n/g, '<br>') + '<\/p>' : '';
    var popup = document.getElementById('text-popup');
    if (popup) {
      popup.setAttribute('data-anim', TOUR.panelAnimation || 'slide');
      popup.classList.remove('tp-closing');
      popup.classList.add('open');
    }
    document.body.style.overflow = 'hidden';
    window._track && window._track('scene_detail_open', {scene: _curScene});
  };
  (document.getElementById('text-popup') || {addEventListener:function(){}}).addEventListener('click', function(e) {
    if (e.target === this) closeTextPopup();
  });

  // Video hotspot popup
  function _toEmbedUrl(url) {
    var yt = url.match(/(?:youtube\\.com\\/watch\\?v=|youtu\\.be\\/)([A-Za-z0-9_-]{11})/);
    if (yt) return 'https://www.youtube.com/embed/' + yt[1] + '?autoplay=1';
    var vi = url.match(/vimeo\\.com\\/(\\d+)/);
    if (vi) return 'https://player.vimeo.com/video/' + vi[1] + '?autoplay=1';
    return null;
  }
  window.showVideoHs = function(id) {
    var data = TOUR.hotspotVideos && TOUR.hotspotVideos[id];
    if (!data || !data.url) return;
    window._track('video_play', {id: id, title: data.title || ''});
    var popup = document.getElementById('video-popup');
    var frame = document.getElementById('video-iframe');
    var vid   = document.getElementById('video-tag');
    var embed = _toEmbedUrl(data.url);
    if (embed) {
      frame.src = embed; frame.style.display = '';
      vid.style.display = 'none'; vid.src = '';
    } else {
      vid.src = data.url; vid.style.display = 'block';
      frame.style.display = 'none'; frame.src = '';
    }
    popup.classList.add('open');
  };
  window.closeVideoPopup = function() {
    var popup = document.getElementById('video-popup');
    if (popup) popup.classList.remove('open');
    var frame = document.getElementById('video-iframe');
    if (frame) frame.src = '';
    var vid = document.getElementById('video-tag');
    if (vid) { if (vid.pause) vid.pause(); vid.src = ''; }
  };
  (document.getElementById('video-popup') || {addEventListener:function(){}}).addEventListener('click', function(e) {
    if (e.target === this) closeVideoPopup();
  });

  // Form hotspot popup
  var _formData = null;
  window.showFormHs = function(id) {
    var data = TOUR.hotspotForms && TOUR.hotspotForms[id];
    if (!data) return;
    _formData = data;
    window._track('form_open', {id: id});
    document.getElementById('form-popup-title').textContent = data.subject || 'Contact';
    var fieldsEl = document.getElementById('form-popup-fields');
    fieldsEl.innerHTML = '';
    (data.fields || []).forEach(function(f) {
      var div = document.createElement('div'); div.className = 'form-field';
      var lbl = document.createElement('label'); lbl.className = 'form-label';
      lbl.textContent = f.label + (f.required ? ' *' : '');
      var inp;
      if (f.type === 'textarea') {
        inp = document.createElement('textarea'); inp.rows = 4;
        inp.style.resize = 'vertical';
      } else {
        inp = document.createElement('input');
        inp.type = f.type === 'email' ? 'email' : 'text';
      }
      inp.className = 'form-input'; inp.name = f.name; inp.required = !!f.required; inp.placeholder = f.label;
      div.appendChild(lbl); div.appendChild(inp);
      fieldsEl.appendChild(div);
    });
    document.getElementById('form-popup').classList.add('open');
  };
  window.closeFormPopup = function() {
    document.getElementById('form-popup').classList.remove('open');
  };
  window._submitForm = function() {
    if (!_formData) return;
    var inputs = document.querySelectorAll('#form-popup-fields .form-input');
    var lines = [];
    inputs.forEach(function(inp) { if (inp.value) lines.push((inp.name || inp.placeholder || '') + ': ' + inp.value); });
    var subject = encodeURIComponent(_formData.subject || 'Contact');
    var body = encodeURIComponent(lines.join('\\n'));
    window._track('form_submit', {subject: _formData.subject || ''});
    window.open('mailto:' + (_formData.mailto || '') + '?subject=' + subject + '&body=' + body);
    closeFormPopup();
  };
  (document.getElementById('form-popup') || {addEventListener:function(){}}).addEventListener('click', function(e) {
    if (e.target === this) closeFormPopup();
  });

  // Cookie consent
  (function() {
    var b = document.getElementById('cookie-banner');
    if (!b) return;
    try { if (localStorage.getItem('cc_ok')) { b.style.display = 'none'; } } catch(e) {}
  })();
  window._acceptCookies = function() {
    try { localStorage.setItem('cc_ok', '1'); } catch(e) {}
    var b = document.getElementById('cookie-banner');
    if (b) b.style.display = 'none';
    if (window.__gaEnabled && window.__gaRespectConsent) { window.__gaConsented = true; }
    window._track('cookie_accepted');
  };

  // GA4 tracking helper — all events go through here so we can gate on consent
  window._track = function(evt, params) {
    if (!window.__gaEnabled || !window.__gaEvents || !window.__gaEvents[evt]) return;
    if (window.__gaRespectConsent && !window.__gaConsented) return;
    try { if (typeof gtag === 'function') gtag('event', evt, params || {}); } catch(e) {}
  };
  window._openExternalLink = function(id) {
    var url = TOUR.hotspotExternalUrls && TOUR.hotspotExternalUrls[id];
    if (!url) return;
    window._track('external_link_click', {url: url});
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  function _toggleFs() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen && document.exitFullscreen();
    }
  }

  // Share popover toggle
  window._toggleShare = function() {
    var p = document.getElementById('share-popover');
    if (!p) return;
    p.classList.toggle('open');
  };
  // Mobile share — wires sheet/strip share button to the share popover
  window._mobileShare = function() { window._toggleShare && window._toggleShare(); };
  window._copyTourUrl = function() {
    var url = location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function() { _showToast('Link copied'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); _showToast('Link copied'); } catch(e) {}
      document.body.removeChild(ta);
    }
    var p = document.getElementById('share-popover');
    if (p) p.classList.remove('open');
  };
  // Close share popover on outside click
  document.addEventListener('click', function(e) {
    var p = document.getElementById('share-popover');
    var btn = document.getElementById('share-hdr-btn');
    if (p && p.classList.contains('open') && !p.contains(e.target) && e.target !== btn) {
      p.classList.remove('open');
    }
  });

  // Mobile ⋮ More popover
  window._toggleMobMore = function() {
    var p = document.getElementById('mob-more-popover');
    if (!p) return;
    p.classList.toggle('open');
  };
  window._closeMobMore = function() {
    var p = document.getElementById('mob-more-popover');
    if (p) p.classList.remove('open');
  };
  document.addEventListener('click', function(e) {
    var p = document.getElementById('mob-more-popover');
    var btn = document.getElementById('mob-more-btn');
    if (p && p.classList.contains('open') && !p.contains(e.target) && e.target !== btn) {
      p.classList.remove('open');
    }
  });

  document.addEventListener('fullscreenchange', function() {
    var b = document.getElementById('fs-btn');
    if (b) b.innerHTML = document.fullscreenElement ? '&#x26F7;' : '&#x26F6;';
    if (document.fullscreenElement) window._track('fullscreen_enter');
  });

  // Mobile description overlay
  window._openDescOverlay = function() {
    var scene = _curScene ? TOUR.scenes[_curScene] : null;
    if (!scene) return;
    document.getElementById('desc-overlay-title').textContent = scene.title || _curScene;
    document.getElementById('desc-overlay-body').textContent = scene.description || '';
    var el = document.getElementById('desc-overlay');
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
  };
  window._closeDescOverlay = function() {
    document.getElementById('desc-overlay').classList.remove('open');
    document.body.style.overflow = '';
  };

  // Mobile Web Share API — native share on real mobile, popover fallback on desktop/devtools
  window._mobileShare = function() {
    var scene = _curScene ? TOUR.scenes[_curScene] : null;
    if (navigator.share) {
      navigator.share({
        title: (scene ? (_displayTitle(_curScene) || TOUR.projectTitle) : TOUR.projectTitle) || TOUR.projectTitle,
        url: window.location.href,
      }).catch(function(){ window._toggleShare && window._toggleShare(); });
      return;
    }
    // Fallback: open the share popover (FB, WhatsApp, copy link, etc.)
    window._toggleShare && window._toggleShare();
  };

  // Mobile bottom panel — drag-to-hide + reveal button (Street View pattern)
  (function() {
    if (!window.matchMedia('(max-width:768px)').matches) return;
    var panel = document.getElementById('strip-outer');
    var revBtn = document.getElementById('mob-reveal-btn');
    if (!panel) return;
    var panelVisible = true;

    function _mobHidePanel() {
      panelVisible = false;
      panel.classList.add('mob-hidden');
      if (revBtn) revBtn.classList.add('visible');
    }
    window._mobShowPanel = function() {
      panelVisible = true;
      panel.classList.remove('mob-hidden');
      if (revBtn) revBtn.classList.remove('visible');
    };

    var handle = document.getElementById('mob-drag-handle');
    if (handle) {
      var _tsy = 0;
      handle.addEventListener('touchstart', function(e) { _tsy = e.touches[0].clientY; }, {passive:true});
      handle.addEventListener('touchend', function(e) {
        var dy = e.changedTouches[0].clientY - _tsy;
        if (dy > 40) _mobHidePanel();
        else if (dy < -40) window._mobShowPanel();
      }, {passive:true});
      handle.addEventListener('click', function() {
        if (panelVisible) _mobHidePanel(); else window._mobShowPanel();
      });
    }
  })();

  // Part 1 + 2: update strip card titles from TOUR localized data and
  // frame thumbnails based on each scene's default view direction.
  (function() {
    document.querySelectorAll('.sc-wrap').forEach(function(el) {
      var slug = el.getAttribute('data-slug');
      var sc = TOUR.scenes[slug];
      if (!sc) return;
      // Part 1 — localized title (never shows slug)
      el.setAttribute('data-title', _displayTitle(slug));
      // Part 2 — object-position based on default view yaw
      var img = el.querySelector('.sc-img img');
      if (!img) return;
      var dv = sc.defaultView;
      if (dv && typeof dv.hlookat === 'number') {
        var xPct = ((dv.hlookat + 180) / 360) * 100;
        img.style.objectPosition = xPct.toFixed(1) + '% 50%';
      }
    });
  })();
  </script>
${showMap ? `  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
  var _lmap = null;
  var _markers = {};          // slug → L.marker
  var _markerColors = {};     // slug → color string (for radar reuse)
  var _transLine = null;      // current transition polyline
  var _mapToastTimer = null;
  var MAP_TILES = {
    streets:   { url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attr:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom:19 },
    satellite: { url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr:'&copy; Esri, i-cubed, USDA, AEX, GeoEye', maxZoom:18 },
    light:     { url:'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attr:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>', maxZoom:20 },
    dark:      { url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attr:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>', maxZoom:20 },
  };
  var _mapTileStyle = '${xmlEsc((modules.mapMode as { tileStyle?: string } | undefined)?.tileStyle || 'streets')}';

  // Dot-based map marker (Part 3 — replaces teardrop pin)
  // Active: 64×64 container, pulsing dot + radar fan (rotated by _updateRadar)
  // Inactive: smaller non-pulsing dot, radar hidden
  function _mkMarkerHtml(color, active, iconSvg) {
    var c = /^#[0-9a-fA-F]{3,6}$/.test(color) ? color : '#6b7280';
    var radarSvg = active
      ? '<svg class="mp-radar" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="-32 -32 64 64"'
        + ' style="position:absolute;inset:0;overflow:visible">'
        + '<path d="M0,0 L-14,-30 A34,34,0,0,1,14,-30 Z"'
        + ' fill="rgba(255,255,255,0.32)" stroke="rgba(255,255,255,0.72)"'
        + ' stroke-width="1.5" stroke-linejoin="round"/>'
        + '</svg>'
      : '';
    var iconEl = iconSvg
      ? '<div class="mp-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"'
        + ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + iconSvg + '</svg></div>'
      : '';
    var cls = active ? 'mp' : 'mp mp-off';
    return '<div class="' + cls + '" style="--cc:' + c + '">' + radarSvg + '<div class="mp-dot">' + iconEl + '</div></div>';
  }

  function _openMap() {
    var p = document.getElementById('map-panel');
    p.classList.add('open');
    window._track('map_open');
    if (_lmap) { setTimeout(function(){ _lmap.invalidateSize(); }, 300); return; }
    setTimeout(function() {
      _lmap = L.map('leaflet-map');
      var ts = MAP_TILES[_mapTileStyle] || MAP_TILES.streets;
      L.tileLayer(ts.url,{ attribution:ts.attr, maxZoom:ts.maxZoom }).addTo(_lmap);
      var sz = TOUR.hotspotSizePx || 32;
      var ph = Math.round(sz * 1.2);
      var bounds = [];
      Object.keys(TOUR.scenes).forEach(function(slug) {
        var sc = TOUR.scenes[slug];
        if (!sc.gps) return;
        var catId = sc.categoryIds && sc.categoryIds[0];
        var cat   = catId ? TOUR.categories[catId] : null;
        var color = cat ? cat.color : '#6b7280';
        _markerColors[slug] = color;
        var iconSvg = cat ? (cat.iconSvg || null) : null;
        var isActive = slug === _curScene;
        var iconHtml = _mkMarkerHtml(color, isActive, iconSvg);
        var icon = L.divIcon({
          html: iconHtml,
          className: '',
          iconSize:   [64, 64],
          iconAnchor: [32, 32],
          popupAnchor:[0, -20],
        });
        var m = L.marker([sc.gps.lat, sc.gps.lng], { icon: icon });
        m.addTo(_lmap);
        m.on('click', function() {
          window.hideHotspotPreview();
          _closeMap();
          window._track('map_marker_click', {scene: slug});
          _navTo(slug);
        });
        m.on('mouseover', function() {
          showHotspotPreview(slug);
          if (window.__mapTourSync && window._krpano && window.__sceneHotspotMap) {
            var hsMap = window.__sceneHotspotMap[_curScene];
            var hsn = hsMap && hsMap[slug];
            if (hsn) window._krpano.call('if(hotspot[' + hsn + '],tween(hotspot[' + hsn + '].scale,1.18,0.15));');
          }
        });
        m.on('mouseout', function() {
          hideHotspotPreview();
          if (window.__mapTourSync && window._krpano && window.__sceneHotspotMap) {
            var hsMap = window.__sceneHotspotMap[_curScene];
            var hsn = hsMap && hsMap[slug];
            if (hsn) window._krpano.call('if(hotspot[' + hsn + '],tween(hotspot[' + hsn + '].scale,1.0,0.15));');
          }
        });
        _markers[slug] = m;
        bounds.push([sc.gps.lat, sc.gps.lng]);
      });
      if (bounds.length === 1) { _lmap.setView(bounds[0], 15); }
      else if (bounds.length > 1) { _lmap.fitBounds(bounds, {padding:[32,32]}); }
    }, 300);
  }
  function _closeMap() { document.getElementById('map-panel').classList.remove('open'); }
  function _toggleMap() { document.getElementById('map-panel').classList.contains('open') ? _closeMap() : _openMap(); }
  document.getElementById('map-close').addEventListener('click', _closeMap);

  // Part 3 — scene-change transitions on the map
  window._onSceneMap = function(prevSlug, newSlug) {
    if (!_lmap) return;
    var sz = TOUR.hotspotSizePx || 32;
    var ph = Math.round(sz * 1.2);

    // Update marker icons: deactivate prev, activate new
    function _refreshIcon(slug, active) {
      var m = _markers[slug];
      if (!m) return;
      var color = _markerColors[slug] || '#6b7280';
      var sc2 = TOUR.scenes[slug];
      var catId2 = sc2 && sc2.categoryIds && sc2.categoryIds[0];
      var cat2 = catId2 ? TOUR.categories[catId2] : null;
      var iconSvg2 = cat2 ? (cat2.iconSvg || null) : null;
      var iconHtml = _mkMarkerHtml(color, active, iconSvg2);
      m.setIcon(L.divIcon({ html: iconHtml, className: '', iconSize:[64,64], iconAnchor:[32,32], popupAnchor:[0,-20] }));
    }
    if (prevSlug) _refreshIcon(prevSlug, false);
    _refreshIcon(newSlug, true);

    // Draw animated transition polyline (fade in → flow → fade out)
    var prevSc = prevSlug ? TOUR.scenes[prevSlug] : null;
    var newSc  = TOUR.scenes[newSlug];
    if (_transLine) { _lmap.removeLayer(_transLine); _transLine = null; }
    if (prevSc && prevSc.gps && newSc && newSc.gps) {
      var poly = L.polyline(
        [[prevSc.gps.lat, prevSc.gps.lng],[newSc.gps.lat, newSc.gps.lng]],
        { color:'white', weight:3, opacity:0, dashArray:'8 8', dashOffset:'0' }
      ).addTo(_lmap);
      _transLine = poly;
      var tStart = performance.now();
      (function animTrans() {
        var dt = performance.now() - tStart;
        var fadeIn  = Math.min(1, dt / 400);
        var fadeOut = Math.max(0, Math.min(1, (dt - 1200) / 400));
        poly.setStyle({ opacity: fadeIn - fadeOut, dashOffset: String(-((dt / 30) % 16)) });
        if (dt < 1600) { requestAnimationFrame(animTrans); }
        else { if (_transLine === poly) { _lmap.removeLayer(poly); _transLine = null; } }
      })();
    }

    // Auto-pan if new marker out of view
    if (newSc && newSc.gps) {
      var ll = L.latLng(newSc.gps.lat, newSc.gps.lng);
      if (!_lmap.getBounds().contains(ll)) {
        _lmap.flyTo(ll, _lmap.getZoom(), { duration:0.8, easeLinearity:0.5 });
      }
    }

    // Toast: "Prev title → New title"
    var toastEl = document.getElementById('map-toast');
    if (toastEl) {
      var prevTitle = prevSlug ? _displayTitle(prevSlug) : '';
      var newTitle  = _displayTitle(newSlug);
      toastEl.textContent = prevTitle ? (prevTitle + ' → ' + newTitle) : newTitle;
      toastEl.classList.add('visible');
      clearTimeout(_mapToastTimer);
      _mapToastTimer = setTimeout(function() { toastEl.classList.remove('visible'); }, 2200);
    }
  };

  // Radar/compass: rotates the fan SVG to show camera direction on map
  // trueAz = (scene.heading + krpano.yaw) mod 360
  // scene.heading = compass bearing the camera lens faced at capture (ath=0 direction)
  window._updateRadar = function(yaw) {
    if (!_lmap || !_curScene) return;
    var m = _markers[_curScene];
    if (!m || !m._icon) return;
    var radarEl = m._icon.querySelector('.mp-radar');
    if (!radarEl) return;
    var sc = TOUR.scenes[_curScene];
    var trueAz = (((sc ? sc.heading : 0) || 0) + (parseFloat(yaw) || 0) + 720) % 360;
    radarEl.style.transform = 'rotate(' + trueAz.toFixed(1) + 'deg)';
  };

  // Mobile: toggle between pano-fullscreen and 50/50 pano+map
  window._togglePanoMap = function() {
    var openingMap = !document.body.classList.contains('mob-map-open');
    document.body.classList.toggle('mob-map-open');
    var colIcon = document.getElementById('mob-toggle-icon-collapse');
    var expIcon = document.getElementById('mob-toggle-icon-expand');
    if (colIcon) colIcon.hidden = openingMap;
    if (expIcon) expIcon.hidden = !openingMap;
    if (openingMap && window._openMap) {
      _openMap();
      setTimeout(function() { if (_lmap) _lmap.invalidateSize(); }, 350);
    }
  };
  // Mobile: init (map starts hidden — opened lazily on first FAB tap)
  (function() {
    if (!window.matchMedia('(max-width:768px)').matches) return;
    // Legacy collapse toggle kept for has-strip mode (strip uses old strip-outer)
    window._mobToggleCollapse = function() {
      document.body.classList.toggle('mob-fullscreen');
      if (_lmap) setTimeout(function() { _lmap.invalidateSize(); }, 350);
    };
  })();
  </script>\n` : ''}  <script src="/krpano/krpano.js"></script>
  <script>
  (function(){
    var _splashDone=false;
    function _hideSplash(){
      if(_splashDone)return;
      _splashDone=true;
      var sp=document.getElementById('splash');
      if(sp){sp.classList.add('hidden');setTimeout(function(){if(sp)sp.style.display='none';},520);}
    }
    var _krpanoReady=false, _timerDone=false;
    function _trySplash(){ if(_krpanoReady&&_timerDone) _hideSplash(); }
    setTimeout(function(){_timerDone=true;_trySplash();},3000);
    setTimeout(_hideSplash,10000);
    embedpano({xml:"/tour.xml",basepath:"/",target:"pano",html5:"only",mobilescale:1.0,passQueryParameters:false,onready:function(krp){
      _krpano = krp;
      ${loadSceneCall}
      // Seed _curScene immediately — krp.get('xml.scene') may return null here
      // because tour.xml loads async, so we fall back to TOUR.startScene
      if (TOUR.startScene) _onScene('scene_' + TOUR.startScene);
      setTimeout(_setHeaderTitle, 50);
      setTimeout(_setHeaderTitle, 500);
      setInterval(function(){
        var s=krp.get('xml.scene');
        if(s&&s!==_curScene) _onScene(s);
      }, 250);
      // Poll view yaw at 50ms for smooth radar rotation
      setInterval(function(){
        if (window._updateRadar && window._lmap) {
          window._updateRadar(krp.get('view.hlookat'));
        }
      }, 50);
      _krpanoReady=true;_trySplash();
    }});
  })();
  </script>
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

// SVG inner content for each built-in Lucide icon (24×24 viewBox, stroke-based)
const BUILTIN_ICON_SVG: Record<string, string> = {
  building:   `<rect width="16" height="20" x="4" y="2" rx="2" ry="2"></rect><path d="M9 22v-4h6v4"></path><path d="M8 6h.01"></path><path d="M16 6h.01"></path><path d="M12 6h.01"></path><path d="M12 10h.01"></path><path d="M12 14h.01"></path><path d="M16 10h.01"></path><path d="M16 14h.01"></path><path d="M8 10h.01"></path><path d="M8 14h.01"></path>`,
  skyscraper: `<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path><path d="M10 6h4"></path><path d="M10 10h4"></path><path d="M10 14h4"></path><path d="M10 18h4"></path>`,
  museum:     `<line x1="3" x2="21" y1="22" y2="22"></line><line x1="6" x2="6" y1="18" y2="11"></line><line x1="10" x2="10" y1="18" y2="11"></line><line x1="14" x2="14" y1="18" y2="11"></line><line x1="18" x2="18" y1="18" y2="11"></line><polygon points="12 2 20 7 4 7"></polygon>`,
  shop:       `<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path>`,
  music:      `<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>`,
  leaf:       `<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"></path><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"></path>`,
  camera:     `<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle>`,
  star:       `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>`,
  heart:      `<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>`,
  mappin:     `<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle>`,
  flag:       `<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" x2="4" y1="22" y2="15"></line>`,
  home:       `<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"></path><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>`,
  info:       `<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>`,
  eye:        `<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle>`,
  mail:       `<rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>`,
};

function generateHotspotSvg(color: string, label: string, iconSvg?: string | null): string {
  const c = /^#[0-9a-fA-F]{3,6}$/.test(color) ? color : '#555555';
  let inner = '';
  if (iconSvg?.startsWith('builtin:')) {
    const builtinContent = BUILTIN_ICON_SVG[iconSvg.slice(8)];
    if (builtinContent) {
      // stroke-based Lucide icon, centered in the 40×48 pin (24×24 → translate(8,8))
      inner = `<g transform="translate(8,8)" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${builtinContent}</g>`;
    }
  } else if (iconSvg) {
    const m = iconSvg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
    if (m) {
      inner = `<g transform="translate(8,8)" fill="white" stroke="none">${m[1]}</g>`;
    }
  }
  if (!inner) {
    const letter = xmlEsc((label || '?').charAt(0).toUpperCase());
    inner = `<text x="20" y="25" text-anchor="middle" dominant-baseline="auto" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="white">${letter}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="144" viewBox="0 0 40 48">
  <defs>
    <filter id="sh" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.5"/>
    </filter>
  </defs>
  <path d="M20,2 C10.06,2 2,10.06 2,20 C2,31 20,46 20,46 C20,46 38,31 38,20 C38,10.06 29.94,2 20,2Z" fill="${c}" filter="url(#sh)"/>
  <path d="M20,2.5 C10.35,2.5 2.5,10.35 2.5,20 C2.5,31 20,45.5 20,45.5 C20,45.5 37.5,31 37.5,20 C37.5,10.35 29.65,2.5 20,2.5Z" fill="none" stroke="#ffffff" stroke-width="2"/>
  <path d="M20,4.5 C11.44,4.5 4.5,11.44 4.5,20 C4.5,29.8 20,43 20,43 C20,43 35.5,29.8 35.5,20 C35.5,11.44 28.56,4.5 20,4.5Z" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>
  ${inner}
</svg>`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateServerJs(project: any): string {
  const defaultLang: string = project.languages?.default || 'en';
  const allLangs: string[]  = project.languages?.available || [defaultLang];
  const scenes: any[] = project.scenes || [];
  const startSceneId: string | undefined = project.branding?.startSceneId;
  const startScene = (startSceneId ? scenes.find((s: any) => s.id === startSceneId) : null) ?? scenes[0];
  const defaultStartSlug: string = startScene?.slug || '';
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
var LANGS         = ${JSON.stringify(allLangs)};
var DEFAULT       = ${JSON.stringify(defaultLang)};
var DEFAULT_SCENE = ${JSON.stringify(defaultStartSlug)};
var ROOT          = __dirname;

// Strict routing: /en and /en/ are distinct routes (prevents redirect loops)
app.set('strict routing', true);

// Long-lived static assets — redirect:false so only our explicit routes issue redirects
['panos','krpano','skin','media','plugins','assets','hotspots'].forEach(function(dir) {
  app.use('/' + dir, express.static(path.join(ROOT, dir), { maxAge: '365d', redirect: false }));
});
// tour.xml, sitemap.xml, robots.txt — no cache, no auto-redirects
app.use(express.static(ROOT, { index: false, maxAge: 0, redirect: false }));

// Detect user language from Accept-Language header
function _detectLang(req) {
  var accept = req.headers['accept-language'] || '';
  var parts = accept.split(',');
  for (var i = 0; i < parts.length; i++) {
    var lang = parts[i].trim().split(';')[0].split('-')[0].toLowerCase();
    if (LANGS.indexOf(lang) !== -1) return lang;
  }
  return DEFAULT;
}

// Root → detect language, jump straight to opening scene URL
app.get('/', function(req, res) {
  var lang = _detectLang(req);
  if (DEFAULT_SCENE) return res.redirect(302, '/scene/' + DEFAULT_SCENE + '/' + lang + '/');
  res.redirect(302, '/' + lang + '/');
});

// /:lang  (no trailing slash) → add trailing slash then redirect to scene
app.get('/:lang', function(req, res, next) {
  if (!LANGS.includes(req.params.lang)) return next();
  if (DEFAULT_SCENE) return res.redirect(302, '/scene/' + DEFAULT_SCENE + '/' + req.params.lang + '/');
  res.redirect(302, '/' + req.params.lang + '/');
});

// /:lang/ → redirect to opening scene URL (or serve default page as fallback)
app.get('/:lang/', function(req, res, next) {
  if (!LANGS.includes(req.params.lang)) return next();
  if (DEFAULT_SCENE) return res.redirect(302, '/scene/' + DEFAULT_SCENE + '/' + req.params.lang + '/');
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

// /page/:slug/:lang  (no trailing slash) → add it
app.get('/page/:slug/:lang', function(req, res, next) {
  if (!LANGS.includes(req.params.lang)) return next();
  res.redirect(302, '/page/' + req.params.slug + '/' + req.params.lang + '/');
});

// /page/:slug/:lang/
app.get('/page/:slug/:lang/', function(req, res, next) {
  if (!LANGS.includes(req.params.lang)) return next();
  var file = path.join(ROOT, 'page', req.params.slug, req.params.lang, 'index.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  // Page not available in this lang → try default lang
  var fb = path.join(ROOT, 'page', req.params.slug, DEFAULT, 'index.html');
  if (fs.existsSync(fb)) return res.redirect(302, '/page/' + req.params.slug + '/' + DEFAULT + '/');
  next();
});

// /page/:slug/ (no lang) → detect language
app.get('/page/:slug/', function(req, res) {
  var lang = _detectLang(req);
  res.redirect(302, '/page/' + req.params.slug + '/' + lang + '/');
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

type ProgressFn   = (msg: string, status: 'running' | 'ok' | 'error' | 'info') => void;
type TileProgressFn = (data: { sceneSlug: string; sceneIndex: number; totalScenes: number; percent: number }) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runCompilePipeline(project: any, outputDir: string, opts: { forceRegenTiles?: boolean; isPreview?: boolean }, onProgress: ProgressFn, onTileProgress: TileProgressFn, getIsCanceled: () => boolean): Promise<{ ok: boolean; outputDir?: string; fileCount?: number; sizeBytes?: number; previewUrl?: string; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scenes: any[] = project.scenes || [];
  const settings = await readSettings();
  const forceRegenTiles: boolean = opts.forceRegenTiles ?? false;
  const localLicense = await getLocalLicense();
  const isTrialBuild = localLicense?.status === 'trial';
  const progress = onProgress;

  function checkCancel() {
    if (getIsCanceled()) throw new Error('Compile canceled');
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

    // ── Assets (logo, branding) ────────────────────────────────────────────
    const assetsOutDir = path.join(outputDir, 'assets');
    await fs.mkdir(assetsOutDir, { recursive: true });
    const logoSrcPath: string | undefined = project.branding?.logoPath;
    if (logoSrcPath) {
      try {
        const logoExt = path.extname(logoSrcPath);
        await fs.copyFile(logoSrcPath, path.join(assetsOutDir, `logo${logoExt}`));
        progress('Logo copied to assets/', 'ok');
      } catch {
        progress('Logo file not found — header logo will not display', 'info');
      }
    }
    const loaderSrcPath: string | undefined = project.branding?.loaderPath;
    if (loaderSrcPath) {
      try {
        const loaderExt = path.extname(loaderSrcPath);
        await fs.copyFile(loaderSrcPath, path.join(assetsOutDir, `loader${loaderExt}`));
        progress('Loader image copied to assets/', 'ok');
      } catch {
        progress('Loader image not found — splash will show color only', 'info');
      }
    }
    const faviconSrcPath: string | undefined = project.branding?.faviconPath;
    if (faviconSrcPath) {
      try {
        const favExt = path.extname(faviconSrcPath);
        await fs.copyFile(faviconSrcPath, path.join(assetsOutDir, `favicon${favExt}`));
        progress('Favicon copied to assets/', 'ok');
      } catch {
        progress('Favicon file not found — browser tab icon will not display', 'info');
      }
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
            if (entry.startsWith('conchitour-')) {
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

        const tmpBase = path.join(os.tmpdir(), `conchitour-${Date.now()}`);
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
                  onProgress(`  ${line}`, 'info');
                  const pctMatch = line.match(/(\d+)%/);
                  if (pctMatch) {
                    onTileProgress({ sceneSlug, sceneIndex, totalScenes, percent: parseInt(pctMatch[1], 10) });
                  }
                }
              });
              proc.stderr?.on('data', (chunk: Buffer) => {
                lastOutputAt = Date.now();
                const line = chunk.toString().trim();
                if (line) onProgress(`  ${line}`, 'info');
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

    // ── Share preview for og:image (1200×630 center-crop) ─────────────────
    let sharePreviewGenerated = false;
    {
      const br = project.branding || {};
      const startSc = scenes.find((s: any) => s.id === br.startSceneId) ?? scenes[0];
      const srcPath: string | undefined = startSc?.media?.sourcePath;
      if (srcPath) {
        try {
          await fs.access(srcPath);
          const sharp = (await import(/* @vite-ignore */ 'sharp')).default;
          const meta  = await sharp(srcPath).metadata();
          const w = meta.width  ?? 1200;
          const h = meta.height ?? 630;
          const targetAR = 1200 / 630;
          const srcAR = w / h;
          let cropW: number, cropH: number;
          if (srcAR > targetAR) { cropH = h; cropW = Math.round(h * targetAR); }
          else                   { cropW = w; cropH = Math.round(w / targetAR); }
          const left = Math.max(0, Math.round((w - cropW) / 2));
          const top  = Math.max(0, Math.round((h - cropH) / 2));
          await sharp(srcPath)
            .extract({ left, top, width: Math.min(cropW, w), height: Math.min(cropH, h) })
            .resize(1200, 630)
            .jpeg({ quality: 85 })
            .toFile(path.join(outputDir, 'share-preview.jpg'));
          sharePreviewGenerated = true;
          progress('share-preview.jpg generated (1200×630)', 'ok');
        } catch {
          progress('share-preview.jpg skipped — source file not accessible', 'info');
        }
      }
    }

    // ── Per-language HTML pages ────────────────────────────────────────────
    const langs: string[] = project.languages?.available?.length
      ? project.languages.available
      : [project.languages?.default || 'en'];
    const tiledSlugsSet = new Set(tiledScenes.keys());

    // ── Hotspot category icons ──────────────────────────────────────────────
    const hotspotsDir = path.join(outputDir, 'hotspots');
    await fs.mkdir(hotspotsDir, { recursive: true });
    await fs.writeFile(path.join(hotspotsDir, 'default.svg'), generateHotspotSvg('#6b7280', '?'), 'utf8');
    // Special-type hotspot pins
    await fs.writeFile(path.join(hotspotsDir, 'hs-text.svg'), generateHotspotSvg('#6366f1', 'i', 'builtin:info'), 'utf8');
    await fs.writeFile(path.join(hotspotsDir, 'hs-video.svg'), generateHotspotSvg('#f59e0b', 'v',
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="white" stroke="white" stroke-linejoin="round"/></svg>'), 'utf8');
    await fs.writeFile(path.join(hotspotsDir, 'hs-external.svg'), generateHotspotSvg('#3b82f6', 'e', 'builtin:eye'), 'utf8');
    await fs.writeFile(path.join(hotspotsDir, 'hs-form.svg'), generateHotspotSvg('#10b981', 'f', 'builtin:mail'), 'utf8');
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

    // ── Strip thumbnails (320×200 from equirectangular preview.jpg) ────────────
    checkCancel();
    progress('Generate thumbnails', 'running');
    const thumbsDir = path.join(outputDir, 'thumbs');
    await fs.mkdir(thumbsDir, { recursive: true });
    {
      const sharpThumb = (await import(/* @vite-ignore */ 'sharp')).default;
      let thumbCount = 0;
      for (const scene of scenes) {
        const slug = scene.slug as string;
        if (!tiledSlugsSet.has(slug)) continue;
        const destPath = path.join(thumbsDir, `${slug}.jpg`);

        // 1. Custom thumb captured by user takes priority
        const customSrc = currentProjectDir ? path.join(currentProjectDir, 'thumbs', `${slug}.jpg`) : null;
        let usedCustom = false;
        if (customSrc) {
          try { await fs.access(customSrc); await fs.copyFile(customSrc, destPath); usedCustom = true; } catch { /* fall through */ }
        }

        if (!usedCustom) {
          // 2. Auto-extract: front face (face 2) from krpano cubemap preview strip
          const previewPath = path.join(outputDir, 'panos', `${slug}.tiles`, 'preview.jpg');
          try {
            await fs.access(previewPath);
            const meta = await sharpThumb(previewPath).metadata();
            const faceSize = meta.width ?? 256;
            await sharpThumb(previewPath)
              .extract({ left: 0, top: 2 * faceSize, width: faceSize, height: faceSize })
              .resize(320, 200, { fit: 'cover', position: 'center' })
              .jpeg({ quality: 85 })
              .toFile(destPath);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            progress(`Thumb skipped for "${slug}" — ${msg}`, 'info');
            continue;
          }
        }
        thumbCount++;
      }
      progress(`Thumbnails generated (${thumbCount} scenes)`, thumbCount > 0 ? 'ok' : 'info');
    }

    for (const lang of langs) {
      const langDir = path.join(outputDir, lang);
      await fs.mkdir(langDir, { recursive: true });

      // /:lang/index.html — tour entry point for this language
      const rootHtml = generateTourHtml(project, lang, null, tiledSlugsSet, sharePreviewGenerated, isTrialBuild);
      await fs.writeFile(path.join(langDir, 'index.html'), rootHtml, 'utf8');

      // /:lang/scene/:slug/index.html — per-scene deep-link
      const sceneLangDir = path.join(langDir, 'scene');
      await fs.mkdir(sceneLangDir, { recursive: true });
      for (const scene of scenes) {
        const dir = path.join(sceneLangDir, scene.slug);
        await fs.mkdir(dir, { recursive: true });
        const sceneHtml = generateTourHtml(project, lang, scene.slug, tiledSlugsSet, sharePreviewGenerated, isTrialBuild);
        await fs.writeFile(path.join(dir, 'index.html'), sceneHtml, 'utf8');
      }
    }
    progress(`HTML pages: ${langs.length} lang(s) × ${scenes.length + 1} pages`, 'ok');

    // ── Static pages (/page/<slug>/<lang>/index.html) ─────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enabledPages: any[] = ((project.pages || []) as any[]).filter((p: any) => p.enabled);
    const pagesDefaultLang: string = project.languages?.default || 'en';
    if (enabledPages.length > 0) {
      for (const page of enabledPages) {
        for (const lang of langs) {
          const dir = path.join(outputDir, 'page', page.slug, lang);
          await fs.mkdir(dir, { recursive: true });
          const md: string = (page.content?.[lang] || page.content?.[pagesDefaultLang] || '') as string;
          const bodyHtml = marked.parse(md) as string;
          const html = generatePageHtml(project, page, lang, bodyHtml);
          await fs.writeFile(path.join(dir, 'index.html'), html, 'utf8');
        }
      }
      progress(`Static pages: ${enabledPages.length} page(s) × ${langs.length} language(s)`, 'ok');
    }

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

    // Persist output dir in project lock file (skip for preview builds — temp dir)
    if (!opts.isPreview && currentProjectDir) {
      try {
        const lockPath = path.join(currentProjectDir, 'conchitour.lock');
        const existing = JSON.parse(await fs.readFile(lockPath, 'utf-8').catch(() => '{}')).valueOf() as Record<string, unknown>;
        await fs.writeFile(lockPath, JSON.stringify({ ...existing, lastOutputDir: outputDir }, null, 2), 'utf-8');
      } catch { /* non-fatal */ }
    }

    return { ok: true, outputDir, fileCount: totalFiles, sizeBytes: totalBytes, previewUrl };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isCanceled = getIsCanceled();
    progress(isCanceled ? 'Compile canceled' : `Error: ${msg}`, isCanceled ? 'info' : 'error');
    return { ok: false, error: isCanceled ? 'Compile canceled' : msg };
  }
}

ipcMain.handle('compile:run', async (event, projectData: unknown, outputDir: string) => {
  const localLicense = await getLocalLicense();
  if (localLicense?.status === 'trial') {
    return { ok: false, error: 'TRIAL_BLOCKED' };
  }
  const project = projectData as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const forceRegenTiles: boolean = (projectData as Record<string, unknown>)?.__forceRegenTiles === true;
  compileRunState = { running: true, log: [], startedAt: Date.now() };
  compileCancelToken = { canceled: false };
  const token = compileCancelToken;
  const onProgress: ProgressFn = (msg, status) => {
    const entry: CompileLogEntry = { msg, status };
    if (compileRunState) compileRunState.log.push(entry);
    try { event.sender.send('compile:progress', { msg, status }); } catch { /* window closed */ }
  };
  const onTileProgress: TileProgressFn = (data) => {
    try { event.sender.send('compile:tile-progress', data); } catch { /* window closed */ }
  };
  const result = await runCompilePipeline(project, outputDir, { forceRegenTiles }, onProgress, onTileProgress, () => token.canceled);
  if (compileRunState) { compileRunState.running = false; compileRunState.result = result; }
  try { event.sender.send('compile:done', result); } catch { /* window closed */ }
  return result;
});

ipcMain.handle('preview:start', async (event, projectData: unknown) => {
  // Clean up any existing preview temp dirs, then create a fresh one
  await cleanupOldPreviews();
  const outputDir = getTrialPreviewDir();
  await fs.mkdir(outputDir, { recursive: true });

  compileRunState = { running: true, log: [], startedAt: Date.now() };
  compileCancelToken = { canceled: false };
  const token = compileCancelToken;
  const onProgress: ProgressFn = (msg, status) => {
    const entry: CompileLogEntry = { msg, status };
    if (compileRunState) compileRunState.log.push(entry);
    try { event.sender.send('compile:progress', { msg, status }); } catch { /* window closed */ }
  };
  const onTileProgress: TileProgressFn = (data) => {
    try { event.sender.send('compile:tile-progress', data); } catch { /* window closed */ }
  };
  const project = projectData as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const result = await runCompilePipeline(project, outputDir, { isPreview: true }, onProgress, onTileProgress, () => token.canceled);
  if (compileRunState) { compileRunState.running = false; compileRunState.result = result; }

  if (result.ok && result.previewUrl) {
    try { await shell.openExternal(result.previewUrl); } catch { /* ignore */ }
  } else if (!result.ok) {
    // Compile failed — clean up the temp dir
    try { await fs.rm(outputDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  const finalResult = { ...result, isPreview: true };
  try { event.sender.send('compile:done', finalResult); } catch { /* window closed */ }
  return finalResult;
});

ipcMain.handle('preview:stop', async () => {
  if (tourPreviewServer) {
    await new Promise<void>(r => { tourPreviewServer!.close(() => r()); }).catch(() => {});
    tourPreviewServer = null;
    tourPreviewPort = 0;
    if (tourPreviewDir && path.basename(tourPreviewDir).startsWith('.conchitour-preview-')) {
      try { await fs.rm(tourPreviewDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tourPreviewDir = '';
  }
  return { ok: true };
});

ipcMain.handle('preview:status', () => {
  if (tourPreviewServer && tourPreviewPort > 0) {
    return { running: true, url: `http://localhost:${tourPreviewPort}/`, port: tourPreviewPort };
  }
  return { running: false };
});

ipcMain.handle('preview:lan-url', () => {
  if (!tourPreviewServer || tourPreviewPort === 0) return null;
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces).flat()) {
    if (iface && iface.family === 'IPv4' && !iface.internal) {
      return `http://${iface.address}:${tourPreviewPort}/`;
    }
  }
  return null;
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
    const lockPath = path.join(currentProjectDir, 'conchitour.lock');
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as Record<string, unknown>;
    if (lock.lastOutputDir && typeof lock.lastOutputDir === 'string') return lock.lastOutputDir;
  } catch { /* fall through */ }
  // Suggest a sibling folder: <parent>/<projectSlug>-web
  const parent = path.dirname(currentProjectDir);
  const base   = path.basename(currentProjectDir).replace(/\.Conchitour$/, '');
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

// ── License IPC ───────────────────────────────────────────────────────────────

ipcMain.handle('license:get-initial-status', () => ({
  status: initialLicenseStatus,
}));

ipcMain.handle('license:check', async () => {
  const status = await checkLicenseStatus();
  initialLicenseStatus = status;
  const license = await getLocalLicense();
  return { status, license };
});

ipcMain.handle('license:activate', async (_e, key: string) => {
  const result = await activateLicense(key);
  if (result.ok) initialLicenseStatus = 'valid';
  return result;
});

ipcMain.handle('license:start-trial', async () => {
  const result = await startTrial();
  if (result.ok) initialLicenseStatus = 'trial';
  return result;
});

ipcMain.handle('license:deactivate', async () => {
  const result = await deactivateThisMachine();
  if (result.ok) initialLicenseStatus = 'none';
  return result;
});

ipcMain.handle('license:get-local', async () => {
  return getLocalLicense();
});

// ── Trial IPC ─────────────────────────────────────────────────────────────────

ipcMain.handle('trial:get-state', async (_e, sceneCount: number, languageCount: number) => {
  return getTrialState(sceneCount, languageCount);
});

ipcMain.handle('trial:consume-ai-call', async () => {
  try {
    await consumeTrialAiCall();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});
