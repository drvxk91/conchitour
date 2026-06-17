import { contextBridge, ipcRenderer, webUtils } from 'electron';
contextBridge.exposeInMainWorld('conchitect', {
    openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
    saveProject: (p, data) => ipcRenderer.invoke('project:save', p, data),
    loadProject: (p) => ipcRenderer.invoke('project:load', p),
    readPhotosMeta: (paths) => ipcRenderer.invoke('photos:readMeta', paths),
    copyToProject: (paths, destDir) => ipcRenderer.invoke('photos:copyToProject', paths, destDir),
    generateTiles: (scenePath) => ipcRenderer.invoke('tiles:generate', scenePath),
    openPreview: (sourcePath, heading) => ipcRenderer.invoke('preview:open', sourcePath, heading),
    // Electron 32+: file.path is not available with contextIsolation; use this instead.
    getPathForFile: (file) => webUtils.getPathForFile(file),
    // Synchronous: returns the port of the localhost file server started in main.
    getFileServerPort: () => ipcRenderer.sendSync('file-server:port'),
});
