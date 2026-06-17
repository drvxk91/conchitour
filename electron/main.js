import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
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
    }
    else {
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
            const filePath = decodeURIComponent(req.url.slice(1));
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
        }
        catch {
            res.writeHead(404).end();
        }
    });
    await new Promise((resolve) => {
        fileServer.listen(0, '127.0.0.1', () => {
            fileServerPort = fileServer.address().port;
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
    if (process.platform !== 'darwin')
        app.quit();
});
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
// ------ IPC handlers ------
ipcMain.handle('dialog:openFiles', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Equirectangular images', extensions: ['jpg', 'jpeg', 'png'] }],
    });
    return result.canceled ? [] : result.filePaths;
});
ipcMain.handle('project:save', async (_e, projectPath, data) => {
    await fs.writeFile(projectPath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
});
ipcMain.handle('project:load', async (_e, projectPath) => {
    const raw = await fs.readFile(projectPath, 'utf-8');
    return JSON.parse(raw);
});
ipcMain.handle('photos:readMeta', async (_e, filePaths) => {
    // Dynamic import handles ESM-only builds of exifr
    const mod = await import('exifr');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parse = (mod.default?.parse ?? mod.parse).bind(mod.default ?? mod);
    const results = [];
    for (const filePath of filePaths) {
        try {
            const stats = await fs.stat(filePath);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw = await parse(filePath, {
                tiff: true,
                exif: true,
                gps: true,
            }).catch(() => null);
            const exif = {};
            if (raw?.DateTimeOriginal instanceof Date) {
                exif.dateTime = raw.DateTimeOriginal.toISOString();
            }
            else if (typeof raw?.DateTimeOriginal === 'string') {
                exif.dateTime = raw.DateTimeOriginal;
            }
            const make = typeof raw?.Make === 'string' ? raw.Make.trim() : '';
            const model = typeof raw?.Model === 'string' ? raw.Model.trim() : '';
            const camera = [make, model].filter(Boolean).join(' ');
            if (camera)
                exif.camera = camera;
            // GPSImgDirection (standard EXIF) or Insta360 XMP heading tags
            const dir = raw?.GPSImgDirection ?? raw?.Heading ?? raw?.['Insta360.Heading'] ?? raw?.Yaw;
            if (dir != null) {
                exif.direction = Number(dir);
            }
            if (raw?.latitude != null && raw?.longitude != null) {
                exif.gps = { lat: Number(raw.latitude), lng: Number(raw.longitude) };
                if (raw?.altitude != null)
                    exif.gps.altitude = Number(raw.altitude);
            }
            results.push({
                path: filePath,
                width: Number(raw?.PixelXDimension ?? raw?.ExifImageWidth ?? 0),
                height: Number(raw?.PixelYDimension ?? raw?.ExifImageHeight ?? 0),
                fileSize: stats.size,
                exif: Object.keys(exif).length > 0 ? exif : undefined,
            });
        }
        catch {
            results.push({ path: filePath, width: 0, height: 0, fileSize: 0 });
        }
    }
    return results;
});
ipcMain.handle('photos:copyToProject', async (_e, filePaths, destDir) => {
    await fs.mkdir(path.join(destDir, 'media'), { recursive: true });
    const results = [];
    for (const src of filePaths) {
        const name = path.basename(src);
        const dest = path.join(destDir, 'media', name);
        await fs.copyFile(src, dest);
        results.push(dest);
    }
    return results;
});
ipcMain.handle('tiles:generate', async (_e, _scenePath) => {
    // Placeholder — real sharp tile pipeline comes in a later sprint.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return true;
});
ipcMain.handle('preview:open', async (_e, sourcePath, heading) => {
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
    }
    else {
        await previewWin.loadFile(path.join(__dirname, '../dist/index.html'), {
            query: { preview: sourcePath, heading: String(heading) },
        });
    }
    return true;
});
