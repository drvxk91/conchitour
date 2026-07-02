import { contextBridge, ipcRenderer, webUtils } from 'electron';
contextBridge.exposeInMainWorld('conchitour', {
    openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
    // Project lifecycle
    newProject: (parentFolder, name) => ipcRenderer.invoke('project:new', parentFolder, name),
    openProject: () => ipcRenderer.invoke('project:open'),
    saveProject: (data) => ipcRenderer.invoke('project:save', data),
    saveProjectAs: (data) => ipcRenderer.invoke('project:save-as', data),
    getProjectDir: () => ipcRenderer.invoke('project:get-current-path'),
    copySourceToProject: (srcPath) => ipcRenderer.invoke('project:copy-source', srcPath),
    onMenuAction: (action, cb) => {
        const ch = `menu:${action}`;
        const handler = () => cb();
        ipcRenderer.on(ch, handler);
        return () => ipcRenderer.removeListener(ch, handler);
    },
    loadProject: (p) => ipcRenderer.invoke('project:load', p),
    readPhotosMeta: (paths) => ipcRenderer.invoke('photos:readMeta', paths),
    copyToProject: (paths, destDir) => ipcRenderer.invoke('photos:copyToProject', paths, destDir),
    generateTiles: (scenePath) => ipcRenderer.invoke('tiles:generate', scenePath),
    openPreview: (sourcePath, heading, sceneData) => ipcRenderer.invoke('preview:open', sourcePath, heading, sceneData),
    getPreviewData: () => ipcRenderer.invoke('preview:getData'),
    exportExcel: (projectData) => ipcRenderer.invoke('excel:export', projectData),
    downloadExcelTemplate: (projectData) => ipcRenderer.invoke('excel:download-template', projectData),
    importExcel: (projectData) => ipcRenderer.invoke('excel:import', projectData),
    gitCommit: (projectDir, message) => ipcRenderer.invoke('project:git-commit', projectDir, message),
    // Electron 32+: file.path is not available with contextIsolation; use this instead.
    getPathForFile: (file) => webUtils.getPathForFile(file),
    // Synchronous: returns the port of the localhost file server started in main.
    getFileServerPort: () => ipcRenderer.sendSync('file-server:port'),
    // Settings
    settingsGet: () => ipcRenderer.invoke('settings:get'),
    settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
    krpanoValidate: (krpanoPath) => ipcRenderer.invoke('krpano:validate', krpanoPath),
    krpanoLicenseStatus: (krpanoPath) => ipcRenderer.invoke('krpano:license-status', krpanoPath),
    krpanoRegister: (krpanoPath, code) => ipcRenderer.invoke('krpano:register', krpanoPath, code),
    // Compile pipeline
    showFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
    showProjectFolderDialog: () => ipcRenderer.invoke('dialog:openProjectFolder'),
    getDefaultOutputDir: () => ipcRenderer.invoke('project:default-output-dir'),
    compileRun: (projectData, outputDir) => ipcRenderer.invoke('compile:run', projectData, outputDir),
    // Preview (trial + licensed)
    previewStart: (projectData) => ipcRenderer.invoke('preview:start', projectData),
    previewStop: () => ipcRenderer.invoke('preview:stop'),
    previewStatus: () => ipcRenderer.invoke('preview:status'),
    previewGetLanUrl: () => ipcRenderer.invoke('preview:lan-url'),
    onCompileProgress: (cb) => {
        const handler = (_event, data) => cb(data.msg, data.status);
        ipcRenderer.on('compile:progress', handler);
        return () => ipcRenderer.removeListener('compile:progress', handler);
    },
    compileGetState: () => ipcRenderer.invoke('compile:get-state'),
    compileCancel: () => ipcRenderer.invoke('compile:cancel'),
    onCompileDone: (cb) => {
        const handler = (_event, result) => cb(result);
        ipcRenderer.on('compile:done', handler);
        return () => ipcRenderer.removeListener('compile:done', handler);
    },
    onTileProgress: (cb) => {
        const handler = (_event, data) => cb(data);
        ipcRenderer.on('compile:tile-progress', handler);
        return () => ipcRenderer.removeListener('compile:tile-progress', handler);
    },
    openFolder: (folderPath) => ipcRenderer.invoke('shell:openFolder', folderPath),
    tourServerStart: (outputDir, defaultLang) => ipcRenderer.invoke('tour-server:start', outputDir, defaultLang),
    tourServerStop: () => ipcRenderer.invoke('tour-server:stop'),
    tourServerStatus: () => ipcRenderer.invoke('tour-server:status'),
    openUrl: (url) => ipcRenderer.invoke('shell:openUrl', url),
    captureSceneThumbnail: (slug, rect) => ipcRenderer.invoke('capture-scene-thumbnail', slug, rect),
    compressForAi: (args) => ipcRenderer.invoke('media:compress-for-ai', args),
    excelBackup: (projectData, projectDir) => ipcRenderer.invoke('excel:backup', projectData, projectDir),
    exportExcelStyled: (projectData) => ipcRenderer.invoke('excel:export-styled', projectData),
    // License
    licenseGetInitialStatus: () => ipcRenderer.invoke('license:get-initial-status'),
    licenseCheck: () => ipcRenderer.invoke('license:check'),
    licenseActivate: (key) => ipcRenderer.invoke('license:activate', key),
    licenseStartTrial: () => ipcRenderer.invoke('license:start-trial'),
    licenseDeactivate: () => ipcRenderer.invoke('license:deactivate'),
    licenseGetLocal: () => ipcRenderer.invoke('license:get-local'),
    onLicenseStatusChanged: (cb) => {
        const handler = (_event, status) => cb(status);
        ipcRenderer.on('license:status-changed', handler);
        return () => ipcRenderer.removeListener('license:status-changed', handler);
    },
    // Trial
    trialGetState: (sceneCount, languageCount) => ipcRenderer.invoke('trial:get-state', sceneCount, languageCount),
    trialConsumeAiCall: () => ipcRenderer.invoke('trial:consume-ai-call'),
    // Wizard mobile server
    wizardStartServer: () => ipcRenderer.invoke('wizard:start-server'),
    wizardStopServer: () => ipcRenderer.invoke('wizard:stop-server'),
    onWizardMobileAnswers: (cb) => {
        const handler = (_event, data) => cb(data);
        ipcRenderer.on('wizard:mobile-answers', handler);
        return () => ipcRenderer.removeListener('wizard:mobile-answers', handler);
    },
});
