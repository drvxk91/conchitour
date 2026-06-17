import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('conchitect', {
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  saveProject: (p: string, data: unknown) => ipcRenderer.invoke('project:save', p, data),
  loadProject: (p: string) => ipcRenderer.invoke('project:load', p),
  readPhotosMeta: (paths: string[]) => ipcRenderer.invoke('photos:readMeta', paths),
  copyToProject: (paths: string[], destDir: string) => ipcRenderer.invoke('photos:copyToProject', paths, destDir),
  generateTiles: (scenePath: string) => ipcRenderer.invoke('tiles:generate', scenePath),
  openPreview: (sourcePath: string, heading: number, sceneData?: unknown) => ipcRenderer.invoke('preview:open', sourcePath, heading, sceneData),
  getPreviewData: () => ipcRenderer.invoke('preview:getData'),
  exportExcel: (projectData: unknown) => ipcRenderer.invoke('excel:export', projectData),
  importExcel: (projectData: unknown) => ipcRenderer.invoke('excel:import', projectData),
  // Electron 32+: file.path is not available with contextIsolation; use this instead.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  // Synchronous: returns the port of the localhost file server started in main.
  getFileServerPort: () => ipcRenderer.sendSync('file-server:port') as number,
  // Compile pipeline
  showFolderDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  compileRun: (projectData: unknown, outputDir: string): Promise<unknown> => ipcRenderer.invoke('compile:run', projectData, outputDir),
  onCompileProgress: (cb: (msg: string, status: string) => void): (() => void) => {
    const handler = (_event: unknown, data: { msg: string; status: string }) => cb(data.msg, data.status);
    ipcRenderer.on('compile:progress', handler as Parameters<typeof ipcRenderer.on>[1]);
    return () => ipcRenderer.removeListener('compile:progress', handler as Parameters<typeof ipcRenderer.removeListener>[1]);
  },
  openFolder: (folderPath: string): Promise<void> => ipcRenderer.invoke('shell:openFolder', folderPath),
});

export interface PhotoExif {
  dateTime?: string;
  camera?: string;
  direction?: number;
  gps?: { lat: number; lng: number; altitude?: number };
}

export interface PhotoMetaResult {
  path: string;
  width: number;
  height: number;
  fileSize: number;
  exif?: PhotoExif;
}

export interface ExcelImportResult {
  canceled: boolean;
  updated?: number;
  skipped?: number;
  errors?: string[];
  scenePatch?: Record<string, Record<string, unknown>>;
  catPatch?: Record<string, Record<string, unknown>>;
}

export interface ExcelExportResult {
  canceled: boolean;
  path?: string;
}

export interface CompileResult {
  ok: boolean;
  outputDir?: string;
  error?: string;
}

declare global {
  interface Window {
    conchitect: {
      openFiles: () => Promise<string[]>;
      saveProject: (p: string, data: unknown) => Promise<boolean>;
      loadProject: (p: string) => Promise<unknown>;
      readPhotosMeta: (paths: string[]) => Promise<PhotoMetaResult[]>;
      copyToProject: (paths: string[], destDir: string) => Promise<string[]>;
      generateTiles: (scenePath: string) => Promise<boolean>;
      openPreview: (sourcePath: string, heading: number, sceneData?: unknown) => Promise<boolean>;
      getPreviewData: () => Promise<unknown>;
      exportExcel: (projectData: unknown) => Promise<ExcelExportResult>;
      importExcel: (projectData: unknown) => Promise<ExcelImportResult>;
      getPathForFile: (file: File) => string;
      getFileServerPort: () => number;
      showFolderDialog: () => Promise<string | null>;
      compileRun: (projectData: unknown, outputDir: string) => Promise<CompileResult>;
      onCompileProgress: (cb: (msg: string, status: string) => void) => () => void;
      openFolder: (folderPath: string) => Promise<void>;
    };
  }
}
