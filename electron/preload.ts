import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('conchitect', {
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  saveProject: (p: string, data: unknown) => ipcRenderer.invoke('project:save', p, data),
  loadProject: (p: string) => ipcRenderer.invoke('project:load', p),
  readPhotosMeta: (paths: string[]) => ipcRenderer.invoke('photos:readMeta', paths),
  copyToProject: (paths: string[], destDir: string) => ipcRenderer.invoke('photos:copyToProject', paths, destDir),
  generateTiles: (scenePath: string) => ipcRenderer.invoke('tiles:generate', scenePath),
  // Electron 32+: file.path is not available with contextIsolation; use this instead.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
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

declare global {
  interface Window {
    conchitect: {
      openFiles: () => Promise<string[]>;
      saveProject: (p: string, data: unknown) => Promise<boolean>;
      loadProject: (p: string) => Promise<unknown>;
      readPhotosMeta: (paths: string[]) => Promise<PhotoMetaResult[]>;
      copyToProject: (paths: string[], destDir: string) => Promise<string[]>;
      generateTiles: (scenePath: string) => Promise<boolean>;
      getPathForFile: (file: File) => string;
    };
  }
}
