import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
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

ipcMain.handle('project:save', async (_e, projectPath: string, data: unknown) => {
  await fs.writeFile(projectPath, JSON.stringify(data, null, 2), 'utf-8');
  return true;
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

  XLSX.writeFile(wb, result.filePath);
  return { canceled: false, path: result.filePath };
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

ipcMain.handle('preview:open', async (_e, sourcePath: string, heading: number) => {
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
