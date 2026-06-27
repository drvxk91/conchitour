import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('conchitect', {
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  // Project lifecycle
  newProject: (parentFolder: string, name: string): Promise<{ projectDir: string }> =>
    ipcRenderer.invoke('project:new', parentFolder, name),
  openProject: (): Promise<{ projectDir: string; project: unknown } | { error: string } | null> =>
    ipcRenderer.invoke('project:open'),
  saveProject: (data: unknown): Promise<boolean> =>
    ipcRenderer.invoke('project:save', data),
  saveProjectAs: (data: unknown): Promise<string | null> =>
    ipcRenderer.invoke('project:save-as', data),
  getProjectDir: (): Promise<string | null> =>
    ipcRenderer.invoke('project:get-current-path'),
  copySourceToProject: (srcPath: string): Promise<string | null> =>
    ipcRenderer.invoke('project:copy-source', srcPath),
  onMenuAction: (action: string, cb: () => void): (() => void) => {
    const ch = `menu:${action}`;
    const handler = () => cb();
    ipcRenderer.on(ch, handler);
    return () => ipcRenderer.removeListener(ch, handler);
  },
  loadProject: (p: string) => ipcRenderer.invoke('project:load', p),
  readPhotosMeta: (paths: string[]) => ipcRenderer.invoke('photos:readMeta', paths),
  copyToProject: (paths: string[], destDir: string) => ipcRenderer.invoke('photos:copyToProject', paths, destDir),
  generateTiles: (scenePath: string) => ipcRenderer.invoke('tiles:generate', scenePath),
  openPreview: (sourcePath: string, heading: number, sceneData?: unknown) => ipcRenderer.invoke('preview:open', sourcePath, heading, sceneData),
  getPreviewData: () => ipcRenderer.invoke('preview:getData'),
  exportExcel: (projectData: unknown) => ipcRenderer.invoke('excel:export', projectData),
  downloadExcelTemplate: (projectData: unknown) => ipcRenderer.invoke('excel:download-template', projectData),
  importExcel: (projectData: unknown) => ipcRenderer.invoke('excel:import', projectData),
  gitCommit: (projectDir: string, message: string): Promise<GitCommitResult> =>
    ipcRenderer.invoke('project:git-commit', projectDir, message),
  // Electron 32+: file.path is not available with contextIsolation; use this instead.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  // Synchronous: returns the port of the localhost file server started in main.
  getFileServerPort: () => ipcRenderer.sendSync('file-server:port') as number,
  // Settings
  settingsGet: (): Promise<ConchitectSettings> => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch: Partial<ConchitectSettings>): Promise<boolean> => ipcRenderer.invoke('settings:set', patch),
  krpanoValidate: (krpanoPath: string): Promise<KrpanoValidationResult> => ipcRenderer.invoke('krpano:validate', krpanoPath),
  krpanoLicenseStatus: (krpanoPath: string): Promise<KrpanoLicenseStatus> => ipcRenderer.invoke('krpano:license-status', krpanoPath),
  krpanoRegister: (krpanoPath: string, code: string): Promise<KrpanoRegisterResult> => ipcRenderer.invoke('krpano:register', krpanoPath, code),
  // Compile pipeline
  showFolderDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  showProjectFolderDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openProjectFolder'),
  getDefaultOutputDir: (): Promise<string | null> => ipcRenderer.invoke('project:default-output-dir'),
  compileRun: (projectData: unknown, outputDir: string): Promise<CompileResult> => ipcRenderer.invoke('compile:run', projectData, outputDir),
  onCompileProgress: (cb: (msg: string, status: string) => void): (() => void) => {
    const handler = (_event: unknown, data: { msg: string; status: string }) => cb(data.msg, data.status);
    ipcRenderer.on('compile:progress', handler as Parameters<typeof ipcRenderer.on>[1]);
    return () => ipcRenderer.removeListener('compile:progress', handler as Parameters<typeof ipcRenderer.removeListener>[1]);
  },
  compileGetState: (): Promise<CompileRunState | null> => ipcRenderer.invoke('compile:get-state'),
  compileCancel: (): Promise<boolean> => ipcRenderer.invoke('compile:cancel'),
  onCompileDone: (cb: (result: CompileResult) => void): (() => void) => {
    const handler = (_event: unknown, result: CompileResult) => cb(result);
    ipcRenderer.on('compile:done', handler as Parameters<typeof ipcRenderer.on>[1]);
    return () => ipcRenderer.removeListener('compile:done', handler as Parameters<typeof ipcRenderer.removeListener>[1]);
  },
  onTileProgress: (cb: (data: TileProgressData) => void): (() => void) => {
    const handler = (_event: unknown, data: TileProgressData) => cb(data);
    ipcRenderer.on('compile:tile-progress', handler as Parameters<typeof ipcRenderer.on>[1]);
    return () => ipcRenderer.removeListener('compile:tile-progress', handler as Parameters<typeof ipcRenderer.removeListener>[1]);
  },
  openFolder: (folderPath: string): Promise<void> => ipcRenderer.invoke('shell:openFolder', folderPath),
  tourServerStart: (outputDir: string, defaultLang: string): Promise<TourServerResult> => ipcRenderer.invoke('tour-server:start', outputDir, defaultLang),
  tourServerStop: (): Promise<boolean> => ipcRenderer.invoke('tour-server:stop'),
  tourServerStatus: (): Promise<TourServerStatus | null> => ipcRenderer.invoke('tour-server:status'),
  openUrl: (url: string): Promise<void> => ipcRenderer.invoke('shell:openUrl', url),
  captureSceneThumbnail: (slug: string, rect: { x: number; y: number; width: number; height: number }): Promise<boolean> =>
    ipcRenderer.invoke('capture-scene-thumbnail', slug, rect),
  compressForAi: (args: { sourcePath: string; targetWidth: number; quality: number }): Promise<CompressForAiResult> =>
    ipcRenderer.invoke('media:compress-for-ai', args),
  excelBackup: (projectData: unknown, projectDir: string): Promise<ExcelBackupResult> =>
    ipcRenderer.invoke('excel:backup', projectData, projectDir),
  exportExcelStyled: (projectData: unknown): Promise<ExcelExportResult> =>
    ipcRenderer.invoke('excel:export-styled', projectData),
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

export interface ImportChange {
  id: string;
  entityType: 'scene' | 'category' | 'page' | 'analytics' | 'hotspot' | 'project' | 'modules' | 'ai_context';
  entityId: string;
  parentId?: string;  // hotspot only: scene ID
  entityLabel: string;
  field: string;
  oldValue: string;
  newValue: string;
  patchValue: unknown;
}

export interface ImportValidationError {
  entityLabel: string;
  field: string;
  value: string;
  message: string;
}

export interface ImportDiffResult {
  canceled: boolean;
  changes: ImportChange[];
  validationErrors: ImportValidationError[];
  error?: string;
}

export interface GitCommitResult {
  ok: boolean;
  sha?: string;
  error?: string;
}

export interface ExcelExportResult {
  canceled: boolean;
  path?: string;
  error?: string;
}

export interface LicenseInfo {
  name?: string;
  email?: string;
  domain?: string;
  type?: string;
  validUntil?: string;
}

export interface ConchitectSettings {
  krpanoPath: string;
  includeLicense: boolean;
  includeTestServer: boolean;
  useKrpanoTiles: boolean;
  lastOutputDir: string;
  licenseInfo?: LicenseInfo;
}

export interface KrpanoValidationResult {
  valid: boolean;
  missing: string[];
}

export interface KrpanoLicenseStatus {
  present: boolean;
  path: string;
}

export interface KrpanoRegisterResult {
  ok: boolean;
  message: string;
}

export interface CompileResult {
  ok: boolean;
  outputDir?: string;
  fileCount?: number;
  sizeBytes?: number;
  previewUrl?: string;
  error?: string;
}

export interface TourServerResult {
  ok: boolean;
  port?: number;
  url?: string;
  error?: string;
}

export interface TourServerStatus {
  port: number;
  url: string;
  dir: string;
}

export interface TileProgressData {
  sceneSlug: string;
  sceneIndex: number;
  totalScenes: number;
  percent: number;
}

export interface CompileRunState {
  running: boolean;
  log: Array<{ msg: string; status: 'running' | 'ok' | 'error' | 'info' }>;
  result?: CompileResult;
  startedAt: number;
}

export interface CompressForAiResult {
  ok: boolean;
  dataUrl?: string;
  bytes?: number;
  error?: string;
}

export interface ExcelBackupResult {
  ok: boolean;
  path?: string;
  filename?: string;
  bytes?: number;
  cleaned?: number;
  error?: string;
}

export interface ProjectOpenResult {
  projectDir: string;
  project: unknown;
}
export interface ProjectOpenError {
  error: string;
}

declare global {
  interface Window {
    conchitect: {
      openFiles: () => Promise<string[]>;
      // Project lifecycle
      newProject: (parentFolder: string, name: string) => Promise<{ projectDir: string }>;
      openProject: () => Promise<ProjectOpenResult | ProjectOpenError | null>;
      saveProject: (data: unknown) => Promise<boolean>;
      saveProjectAs: (data: unknown) => Promise<string | null>;
      getProjectDir: () => Promise<string | null>;
      copySourceToProject: (srcPath: string) => Promise<string | null>;
      onMenuAction: (action: string, cb: () => void) => () => void;
      loadProject: (p: string) => Promise<unknown>;
      readPhotosMeta: (paths: string[]) => Promise<PhotoMetaResult[]>;
      copyToProject: (paths: string[], destDir: string) => Promise<string[]>;
      generateTiles: (scenePath: string) => Promise<boolean>;
      openPreview: (sourcePath: string, heading: number, sceneData?: unknown) => Promise<boolean>;
      getPreviewData: () => Promise<unknown>;
      exportExcel: (projectData: unknown) => Promise<ExcelExportResult>;
      downloadExcelTemplate: (projectData: unknown) => Promise<ExcelExportResult>;
      importExcel: (projectData: unknown) => Promise<ImportDiffResult>;
      gitCommit: (projectDir: string, message: string) => Promise<GitCommitResult>;
      getPathForFile: (file: File) => string;
      getFileServerPort: () => number;
      settingsGet: () => Promise<ConchitectSettings>;
      settingsSet: (patch: Partial<ConchitectSettings>) => Promise<boolean>;
      krpanoValidate: (krpanoPath: string) => Promise<KrpanoValidationResult>;
      krpanoLicenseStatus: (krpanoPath: string) => Promise<KrpanoLicenseStatus>;
      krpanoRegister: (krpanoPath: string, code: string) => Promise<KrpanoRegisterResult>;
      showFolderDialog: () => Promise<string | null>;
      showProjectFolderDialog: () => Promise<string | null>;
      getDefaultOutputDir: () => Promise<string | null>;
      compileRun: (projectData: unknown, outputDir: string) => Promise<CompileResult>;
      onCompileProgress: (cb: (msg: string, status: string) => void) => () => void;
      compileGetState: () => Promise<CompileRunState | null>;
      compileCancel: () => Promise<boolean>;
      onCompileDone: (cb: (result: CompileResult) => void) => () => void;
      onTileProgress: (cb: (data: TileProgressData) => void) => () => void;
      openFolder: (folderPath: string) => Promise<void>;
      tourServerStart: (outputDir: string, defaultLang: string) => Promise<TourServerResult>;
      tourServerStop: () => Promise<boolean>;
      tourServerStatus: () => Promise<TourServerStatus | null>;
      openUrl: (url: string) => Promise<void>;
      captureSceneThumbnail: (slug: string, rect: { x: number; y: number; width: number; height: number }) => Promise<boolean>;
      compressForAi: (args: { sourcePath: string; targetWidth: number; quality: number }) => Promise<CompressForAiResult>;
      excelBackup: (projectData: unknown, projectDir: string) => Promise<ExcelBackupResult>;
      exportExcelStyled: (projectData: unknown) => Promise<ExcelExportResult>;
    };
  }
}
