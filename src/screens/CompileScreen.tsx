import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  FolderOpen, Play, CheckCircle, AlertTriangle, Circle,
  Loader2, ExternalLink, Copy, Settings, RotateCw, XCircle, ChevronDown, Key,
  ClipboardCheck, Globe, Lock, Wifi, QrCode, Eye, Square, Zap, ArrowRight, UploadCloud, GitBranch, X,
} from 'lucide-react';
import QRCode from 'qrcode';
import clsx from 'clsx';
import { useProject } from '@/store/project';
import { useLicense } from '@/store/license';
import { useTrialState } from '@/lib/trial';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { runStaticAudit } from '@/lib/audit/static-checks';
import type { CompileResult, ConchitourSettings, KrpanoValidationResult, KrpanoLicenseStatus, KrpanoRegisterResult, TileProgressData, LicenseInfo } from '../../electron/preload';

function parseLicenseCode(code: string): LicenseInfo | null {
  const result: LicenseInfo = {};
  for (const line of code.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w][\w\s\-]*?)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase().replace(/[\s-]+/g, '');
    const val = m[2].trim();
    if (['name', 'user', 'registeredto'].includes(key)) result.name = val;
    else if (['email', 'mail'].includes(key)) result.email = val;
    else if (key === 'domain') result.domain = val;
    else if (['license', 'licensetype', 'type', 'edition'].includes(key)) result.type = val;
    else if (['valid', 'validuntil', 'validthrough', 'expires'].includes(key)) result.validUntil = val;
  }
  return (result.name || result.domain || result.email) ? result : null;
}

interface LogEntry { msg: string; status: 'running' | 'ok' | 'error' | 'info'; }

const COMPILE_STEPS = [
  { id: 'init',    label: 'Prepare output folder' },
  { id: 'runtime', label: 'Copy krpano runtime' },
  { id: 'skin',    label: 'Copy vtour skin' },
  { id: 'media',   label: 'Copy scene images' },
  { id: 'tiles',   label: 'Generate cube tiles' },
  { id: 'xml',     label: 'Generate tour.xml' },
  { id: 'html',    label: 'Generate HTML pages' },
  { id: 'seo',     label: 'Generate SEO files' },
  { id: 'done',    label: 'Finished' },
] as const;

type StepId = typeof COMPILE_STEPS[number]['id'];

function msgToStep(msg: string): StepId | null {
  const m = msg.toLowerCase();
  if (m.includes('output folder'))   return 'init';
  if (m.includes('krpano.js'))       return 'runtime';
  if (m.includes('skin'))            return 'skin';
  if (m.includes('scene images'))    return 'media';
  if (m.includes('tile') || m.includes('pano')) return 'tiles';
  if (m.includes('tour.xml'))        return 'xml';
  if (m.includes('HTML pages') || m.includes('server.js') || m.includes('index.html')) return 'html';
  if (m.includes('sitemap') || m.includes('robots') || m.includes('readme')) return 'seo';
  if (m.includes('done —') || m.includes('files,')) return 'done';
  return null;
}

function LicenseInfoCard({ info, preview = false }: { info: LicenseInfo; preview?: boolean }) {
  const rows = [
    { label: 'Name',   value: info.name },
    { label: 'Email',  value: info.email },
    { label: 'Domain', value: info.domain },
    { label: 'Type',   value: info.type },
    { label: 'Valid',  value: info.validUntil },
  ].filter(r => r.value);
  if (rows.length === 0) return null;
  return (
    <div className={clsx('rounded-md px-3 py-2 text-xs space-y-0.5', preview ? 'bg-blue-50 border border-blue-100' : 'bg-emerald-50 border border-emerald-100')}>
      {preview && <p className="text-blue-600 font-medium mb-1">License found in code:</p>}
      {rows.map(r => (
        <div key={r.label} className="flex gap-2">
          <span className={clsx('w-14 shrink-0 font-medium', preview ? 'text-blue-500' : 'text-emerald-600')}>{r.label}</span>
          <span className={preview ? 'text-blue-700' : 'text-emerald-800'}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function QrModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(url, { width: 280, margin: 2 }).then(setDataUrl).catch(() => {});
  }, [url]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 flex flex-col items-center gap-4 max-w-xs w-full mx-4" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-semibold text-ink">Scan to open on your phone</p>
        {dataUrl
          ? <img src={dataUrl} alt="QR code" className="w-48 h-48 rounded-lg" />
          : <div className="w-48 h-48 flex items-center justify-center"><Loader2 size={24} className="animate-spin text-ink-faded" /></div>
        }
        <p className="text-[11px] text-ink-faded font-mono text-center break-all">{url}</p>
        <button onClick={onClose} className="btn w-full justify-center">Close</button>
      </div>
    </div>
  );
}

export function CompileScreen() {
  const { project, setIsCompiling, clearDirty, setActiveScreen } = useProject();
  const { status: appLicenseStatus } = useLicense();
  const trial = useTrialState();
  const licenseExpired = appLicenseStatus === 'expired' || (trial?.isExpired ?? false);
  const isTrial   = appLicenseStatus === 'trial' && !licenseExpired;
  const isLicensed = appLicenseStatus === 'valid' && !licenseExpired;

  const [settings, setSettings]             = useState<ConchitourSettings | null>(null);
  const [krpanoPathDraft, setKrpanoPathDraft] = useState('');
  const [validation, setValidation]         = useState<KrpanoValidationResult | null>(null);
  const [validating, setValidating]         = useState(false);

  const [licenseStatus, setLicenseStatus]   = useState<KrpanoLicenseStatus | null>(null);
  const [licenseCode, setLicenseCode]       = useState('');
  const [activating, setActivating]         = useState(false);
  const [licenseResult, setLicenseResult]   = useState<KrpanoRegisterResult | null>(null);

  const [outputDir, setOutputDir]           = useState('');
  const [log, setLog]                       = useState<LogEntry[]>([]);
  const [running, setRunning]               = useState(false);
  const [runMode, setRunMode]               = useState<'compile' | 'preview' | null>(null);
  const [result, setResult]                 = useState<CompileResult | null>(null);
  const [copied, setCopied]                 = useState(false);
  const [forceRegenTiles, setForceRegenTiles] = useState(false);
  const [currentStep, setCurrentStep]       = useState<StepId | null>(null);
  const [tileProgress, setTileProgress]     = useState<TileProgressData | null>(null);
  const completedStepsRef                   = useRef<Set<StepId>>(new Set());
  const logRef                              = useRef<HTMLDivElement>(null);
  const resultRef                           = useRef<HTMLDivElement>(null);

  const [lanUrl, setLanUrl]   = useState<string | null>(null);
  const [showQr, setShowQr]  = useState(false);

  // Publish (git push)
  const [showPublish, setShowPublish]         = useState(false);
  const [publishRemote, setPublishRemote]     = useState('');
  const [publishBranch, setPublishBranch]     = useState('main');
  const [publishLog, setPublishLog]           = useState<string[]>([]);
  const [publishing, setPublishing]           = useState(false);
  const [publishDone, setPublishDone]         = useState<{ ok: boolean; error?: string } | null>(null);
  const [publishConfigured, setPublishConfigured] = useState(false);

  const parsedLicense = useMemo(() => parseLicenseCode(licenseCode), [licenseCode]);

  // Load publish config from project dir
  useEffect(() => {
    window.conchitour.getProjectDir().then(async (dir) => {
      if (!dir) return;
      const cfg = await window.conchitour.getGitRemote(dir);
      if (cfg) {
        setPublishRemote(cfg.remote);
        setPublishBranch(cfg.branch);
        setPublishConfigured(true);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unsub = window.conchitour.onGitProgress((msg) => {
      setPublishLog((prev) => [...prev, msg]);
    });
    return unsub;
  }, []);

  useEffect(() => {
    window.conchitour.settingsGet().then((s) => {
      setSettings(s);
      setKrpanoPathDraft(s.krpanoPath);
      window.conchitour.getDefaultOutputDir().then((d) => { if (d) setOutputDir(d); });
      window.conchitour.krpanoValidate(s.krpanoPath).then(setValidation);
      if (s.krpanoPath) window.conchitour.krpanoLicenseStatus(s.krpanoPath).then(setLicenseStatus);
    });

    window.conchitour.compileGetState().then((state) => {
      if (!state) return;
      setLog(state.log.map((e) => ({ msg: e.msg, status: e.status as LogEntry['status'] })));
      setRunning(state.running);
      setIsCompiling(state.running);
      if (state.result) setResult(state.result);
      const restoredSteps = new Set<StepId>();
      let lastStep: StepId | null = null;
      for (const entry of state.log) {
        const step = msgToStep(entry.msg);
        if (step) { lastStep = step; if (entry.status === 'ok') restoredSteps.add(step); }
      }
      completedStepsRef.current = restoredSteps;
      if (state.running && lastStep) setCurrentStep(lastStep);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unsub = window.conchitour.onCompileDone((res) => {
      setRunning(false);
      setIsCompiling(false);
      setResult(res);
    });
    return unsub;
  }, [setIsCompiling]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    if (result && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [result]);

  useEffect(() => {
    const unsub = window.conchitour.onCompileProgress((msg, status) => {
      setLog((prev) => [...prev, { msg, status: status as LogEntry['status'] }]);
      const step = msgToStep(msg);
      if (step) {
        setCurrentStep(step);
        if (status === 'ok') {
          completedStepsRef.current.add(step);
          if (step === 'tiles') setTileProgress(null);
        }
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = window.conchitour.onTileProgress((data) => { setTileProgress(data); });
    return unsub;
  }, []);

  const patchSettings = useCallback((patch: Partial<ConchitourSettings>) => {
    setSettings((prev) => prev ? { ...prev, ...patch } : prev);
    window.conchitour.settingsSet(patch);
  }, []);

  const handleValidate = useCallback(async () => {
    if (!krpanoPathDraft) return;
    setValidating(true);
    setValidation(null);
    patchSettings({ krpanoPath: krpanoPathDraft });
    const r = await window.conchitour.krpanoValidate(krpanoPathDraft);
    setValidation(r);
    const ls = await window.conchitour.krpanoLicenseStatus(krpanoPathDraft);
    setLicenseStatus(ls);
    setValidating(false);
  }, [krpanoPathDraft, patchSettings]);

  const handleActivateLicense = useCallback(async () => {
    if (!settings?.krpanoPath) {
      setLicenseResult({ ok: false, message: 'krpano path not set. Use the Detect button first.' });
      return;
    }
    if (!licenseCode.trim()) {
      setLicenseResult({ ok: false, message: 'Registration code is empty.' });
      return;
    }
    setActivating(true);
    setLicenseResult(null);
    try {
      const res = await window.conchitour.krpanoRegister(settings.krpanoPath, licenseCode);
      const ls = await window.conchitour.krpanoLicenseStatus(settings.krpanoPath);
      setLicenseStatus(ls);
      const effective = { ...res, ok: res.ok || ls.present };
      setLicenseResult(effective);
      if (ls.present) {
        const info = parseLicenseCode(res.message) ?? parseLicenseCode(licenseCode);
        if (info) patchSettings({ licenseInfo: info });
        setLicenseCode('');
      }
    } catch (err) {
      setLicenseResult({ ok: false, message: `IPC error: ${String(err)}` });
    } finally {
      setActivating(false);
    }
  }, [settings?.krpanoPath, licenseCode, patchSettings]);

  const handlePickFolder = useCallback(async () => {
    const dir = await window.conchitour.showFolderDialog();
    if (dir) { setOutputDir(dir); patchSettings({ lastOutputDir: dir }); }
  }, [patchSettings]);

  const resetRunState = useCallback(() => {
    setLog([]);
    setResult(null);
    setCurrentStep(null);
    setTileProgress(null);
    setLanUrl(null);
    completedStepsRef.current = new Set();
  }, []);

  const fetchLanUrl = useCallback(async () => {
    const lan = await window.conchitour.previewGetLanUrl();
    if (lan) setLanUrl(lan);
  }, []);

  const handlePreview = useCallback(async () => {
    if (running) return;
    resetRunState();
    setRunning(true);
    setRunMode('preview');
    setIsCompiling(true);
    try {
      const saved = await window.conchitour.saveProject(project);
      if (saved) clearDirty();
      const res = await window.conchitour.previewStart(project);
      setResult(res);
      if (res.ok) await fetchLanUrl();
    } finally {
      setRunning(false);
      setIsCompiling(false);
    }
  }, [running, project, setIsCompiling, clearDirty, resetRunState, fetchLanUrl]);

  const handleStopPreview = useCallback(async () => {
    await window.conchitour.previewStop();
    setResult(null);
    setLanUrl(null);
    setRunMode(null);
  }, []);

  const handleCompile = useCallback(async () => {
    if (!outputDir || running) return;
    resetRunState();
    setRunning(true);
    setRunMode('compile');
    setIsCompiling(true);
    try {
      const saved = await window.conchitour.saveProject(project);
      if (saved) clearDirty();
      const projectData = forceRegenTiles ? { ...project, __forceRegenTiles: true } : project;
      const res = await window.conchitour.compileRun(projectData, outputDir);
      setResult(res);
      if (res.ok) await fetchLanUrl();
    } finally {
      setRunning(false);
      setIsCompiling(false);
    }
  }, [outputDir, running, project, setIsCompiling, forceRegenTiles, clearDirty, resetRunState, fetchLanUrl]);

  const handleCancel = useCallback(() => { window.conchitour.compileCancel(); }, []);

  const handlePublish = useCallback(async () => {
    if (!result?.outputDir || publishing) return;
    const dir = await window.conchitour.getProjectDir();
    if (dir) await window.conchitour.setGitRemote(dir, publishRemote, publishBranch);
    setPublishConfigured(true);
    setPublishing(true);
    setPublishLog([]);
    setPublishDone(null);
    const res = await window.conchitour.gitPublish(result.outputDir, publishRemote, publishBranch);
    setPublishDone(res);
    setPublishing(false);
  }, [result, publishing, publishRemote, publishBranch]);

  const handleCopyPath = useCallback(() => {
    if (!result?.outputDir) return;
    navigator.clipboard.writeText(result.outputDir).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  const sceneCount = project.scenes.length;
  const krpanoOk   = validation?.valid ?? false;
  const canCompile = outputDir.length > 0 && sceneCount > 0 && !running && isLicensed;
  const canPreview = sceneCount > 0 && !running;

  const auditIssues = useMemo(() => runStaticAudit(project), [project]);
  const auditErrors   = auditIssues.filter((i) => i.severity === 'error').length;
  const auditWarnings = auditIssues.filter((i) => i.severity === 'warning').length;

  const compilePreflight = [
    { label: sceneCount > 0 ? `${sceneCount} scene${sceneCount !== 1 ? 's' : ''} ready` : 'No scenes — add scenes first', ok: sceneCount > 0 },
    { label: outputDir ? `Output: ${outputDir}` : 'No output folder selected', ok: outputDir.length > 0 },
    {
      label: validation
        ? (krpanoOk ? 'krpano installation detected' : `krpano incomplete — missing: ${validation.missing.join(', ')}`)
        : 'krpano installation not validated yet',
      ok: validation ? krpanoOk : null,
    },
  ];

  if (!settings) {
    return (
      <ScreenShell title="Compile" subtitle="Generate a static folder ready to upload anywhere.">
        <div className="flex items-center gap-2 text-sm text-ink-faded">
          <Loader2 size={14} className="animate-spin" />
          Loading settings…
        </div>
      </ScreenShell>
    );
  }

  /* ─── Progress + Result — shared by both trial and licensed ─────── */
  const progressAndResult = (
    <>
      {(log.length > 0 || running) && (
        <section className="space-y-3">
          <p className="text-sm font-medium text-ink">Progress</p>
          <div className="rounded-lg border border-line bg-paper space-y-1 p-3">
            {COMPILE_STEPS.map((step) => {
              const isDone    = completedStepsRef.current.has(step.id) || (!running && result?.ok);
              const isCurrent = currentStep === step.id && running;
              const isWaiting = !isDone && !isCurrent;
              const showTileProgress = step.id === 'tiles' && isCurrent && tileProgress;
              return (
                <div key={step.id} className={clsx('flex flex-col gap-0.5 py-0.5', isWaiting && 'opacity-35')}>
                  <div className="flex items-center gap-2.5 text-sm">
                    {isDone
                      ? <CheckCircle size={13} className="text-emerald-500 shrink-0" />
                      : isCurrent
                        ? <Loader2 size={13} className="text-accent animate-spin shrink-0" />
                        : <Circle size={13} className="text-line-strong shrink-0" />}
                    <span className={clsx('text-xs', isDone && 'text-ink', isCurrent && 'text-ink font-medium', isWaiting && 'text-ink-soft')}>
                      {step.label}
                    </span>
                    {showTileProgress && (
                      <span className="ml-auto text-[11px] text-ink-faded font-mono">
                        {tileProgress.sceneIndex}/{tileProgress.totalScenes} · {tileProgress.percent}%
                      </span>
                    )}
                  </div>
                  {showTileProgress && (
                    <div className="ml-[21px] h-1 rounded-full bg-line overflow-hidden">
                      <div className="h-full bg-accent rounded-full transition-all duration-150" style={{ width: `${tileProgress.percent}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <details className="group">
            <summary className="flex items-center gap-1.5 text-xs text-ink-faded cursor-pointer select-none hover:text-ink-soft list-none">
              <ChevronDown size={11} className="transition-transform group-open:rotate-180" />
              Raw output ({log.length} lines)
            </summary>
            <div ref={logRef} className="mt-2 bg-zinc-900 rounded-lg px-4 py-3 space-y-0.5 max-h-48 overflow-y-auto font-mono text-[11px]">
              {log.map((entry, i) => (
                <div key={i} className={clsx('flex items-start gap-2', entry.status === 'ok' && 'text-emerald-400', entry.status === 'error' && 'text-red-400', entry.status === 'running' && 'text-yellow-400', entry.status === 'info' && 'text-zinc-400')}>
                  <span className="select-none shrink-0 w-3 text-center">
                    {entry.status === 'ok' && '✓'}{entry.status === 'error' && '✗'}{entry.status === 'running' && '●'}{entry.status === 'info' && '·'}
                  </span>
                  <span>{entry.msg}</span>
                </div>
              ))}
            </div>
          </details>
        </section>
      )}

      {result && (
        <section ref={resultRef} className={clsx('rounded-lg border px-4 py-4', result.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50')}>
          {result.ok ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-emerald-700">
                  {result.isPreview ? 'Preview running!' : 'Tour compiled successfully!'}
                </p>
                {result.fileCount != null && result.sizeBytes != null && (
                  <p className="text-xs text-emerald-600 mt-0.5">{result.fileCount} files — {(result.sizeBytes / 1048576).toFixed(1)} MB</p>
                )}
              </div>

              {/* Local URL */}
              {result.previewUrl && (
                <div className="flex items-center gap-2 bg-white border border-emerald-200 rounded-md px-3 py-2">
                  <Globe size={12} className="text-emerald-500 shrink-0" />
                  <span className="text-xs text-emerald-700 font-mono flex-1 truncate">{result.previewUrl}</span>
                  <button onClick={() => window.conchitour.openUrl(result.previewUrl!)} className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 shrink-0">
                    <ExternalLink size={11} />
                    Open
                  </button>
                </div>
              )}

              {/* LAN URL */}
              {lanUrl && (
                <div className="flex items-center gap-2 bg-white border border-emerald-200 rounded-md px-3 py-2">
                  <Wifi size={12} className="text-emerald-500 shrink-0" />
                  <span className="text-xs text-emerald-700 font-mono flex-1 truncate">{lanUrl}</span>
                  <button onClick={() => setShowQr(true)} className="flex items-center gap-1 px-2 py-1 rounded border border-emerald-300 text-emerald-700 text-xs font-medium hover:bg-emerald-100 shrink-0">
                    <QrCode size={11} />
                    QR
                  </button>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 flex-wrap">
                {result.isPreview ? (
                  <button onClick={handleStopPreview} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-500 text-white text-xs font-medium hover:bg-red-600">
                    <Square size={11} />
                    Stop preview
                  </button>
                ) : (
                  <>
                    <button onClick={() => window.conchitour.openFolder(result.outputDir!)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">
                      <ExternalLink size={12} />
                      Open folder
                    </button>
                    <button onClick={handleCopyPath} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-300 text-emerald-700 text-xs font-medium hover:bg-emerald-100">
                      <Copy size={12} />
                      {copied ? 'Copied!' : 'Copy path'}
                    </button>
                    <button
                      onClick={() => { setShowPublish(p => !p); setPublishLog([]); setPublishDone(null); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-blue-300 text-blue-700 text-xs font-medium hover:bg-blue-50"
                    >
                      <UploadCloud size={12} />
                      Publish
                    </button>
                  </>
                )}
              </div>

              {/* Publish panel */}
              {!result.isPreview && showPublish && (
                <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-blue-800 flex items-center gap-1.5"><GitBranch size={12} />Publish via git push</p>
                    <button onClick={() => setShowPublish(false)} className="text-blue-400 hover:text-blue-600"><X size={13} /></button>
                  </div>

                  {/* Remote + branch config */}
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-blue-700 font-medium">Remote URL</label>
                      <input
                        type="text"
                        value={publishRemote}
                        onChange={(e) => setPublishRemote(e.target.value)}
                        placeholder="git@github.com:username/repo.git"
                        className="mt-1 w-full rounded border border-blue-300 bg-white px-2 py-1.5 text-xs font-mono text-ink outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-blue-700 font-medium">Branch</label>
                      <input
                        type="text"
                        value={publishBranch}
                        onChange={(e) => setPublishBranch(e.target.value)}
                        placeholder="main"
                        className="mt-1 w-full rounded border border-blue-300 bg-white px-2 py-1.5 text-xs font-mono text-ink outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                    <p className="text-xs text-blue-600/70">
                      GitHub Pages: create a public repo → Settings → Pages → Branch: <code className="font-mono">gh-pages</code> → / (root).
                      Netlify/Vercel: connect the repo once, each push auto-deploys.
                    </p>
                  </div>

                  {/* Push button */}
                  <button
                    onClick={handlePublish}
                    disabled={!publishRemote || publishing}
                    className={clsx(
                      'flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold transition-all',
                      publishRemote && !publishing
                        ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
                        : 'bg-blue-200 text-blue-400 cursor-not-allowed'
                    )}
                  >
                    {publishing
                      ? <><Loader2 size={12} className="animate-spin" />Pushing…</>
                      : <><UploadCloud size={12} />{publishConfigured ? 'Push again' : 'Push to remote'}</>}
                  </button>

                  {/* Progress log */}
                  {publishLog.length > 0 && (
                    <div className="rounded bg-white border border-blue-200 px-3 py-2 space-y-0.5 max-h-32 overflow-y-auto">
                      {publishLog.map((line, i) => (
                        <p key={i} className={clsx(
                          'text-xs font-mono',
                          line.startsWith('✓') ? 'text-emerald-700' :
                          line.startsWith('✗') ? 'text-red-700' :
                          line.startsWith('ℹ') ? 'text-amber-700' : 'text-blue-700'
                        )}>{line}</p>
                      ))}
                    </div>
                  )}

                  {/* Done state */}
                  {publishDone && (
                    <div className={clsx('text-xs font-medium rounded px-3 py-2', publishDone.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800')}>
                      {publishDone.ok
                        ? '🚀 Published! Your tour is deploying.'
                        : `Error: ${publishDone.error}`}
                    </div>
                  )}
                </div>
              )}

              {!result.isPreview && (
                <p className="text-xs text-emerald-600/70 font-mono">
                  Deploy: cd &quot;{result.outputDir}&quot; &amp;&amp; npm install &amp;&amp; node server.js
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm font-medium text-red-700">
              {result.error === 'TRIAL_BLOCKED'
                ? 'Compile to folder requires a license. Use Preview instead.'
                : `Failed: ${result.error}`}
            </p>
          )}
        </section>
      )}
    </>
  );

  /* ─── Audit banner — shared ────────────────────────────────────── */
  const auditBanner = auditErrors > 0 ? (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3">
      <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-red-700">
          {auditErrors} error{auditErrors !== 1 ? 's' : ''} found — visitors may see problems.
        </p>
        <button onClick={() => setActiveScreen('audit')} className="mt-1 text-xs text-red-600 underline">
          Review in Audit screen
        </button>
      </div>
    </div>
  ) : auditWarnings > 0 ? (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
      <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-700">
          {auditWarnings} warning{auditWarnings !== 1 ? 's' : ''} — tour will compile but quality could improve.
        </p>
        <button onClick={() => setActiveScreen('audit')} className="mt-1 text-xs text-amber-600 underline">
          Review suggestions
        </button>
      </div>
    </div>
  ) : sceneCount > 0 ? (
    <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-3">
      <ClipboardCheck size={15} className="text-green-500 shrink-0" />
      <p className="text-sm text-green-700 font-medium">Audit passed — ready to go.</p>
    </div>
  ) : null;

  /* ─── TRIAL layout ─────────────────────────────────────────────── */
  if (isTrial) {
    return (
      <ScreenShell title="Preview" subtitle="Launch a local server to test your tour in the browser.">
        {showQr && lanUrl && <QrModal url={lanUrl} onClose={() => setShowQr(false)} />}
        <div className="grid grid-cols-2 gap-8 max-w-5xl mx-auto">

          {/* LEFT — trial info */}
          <div className="space-y-6">
            <section className="rounded-xl border border-accent/30 bg-accent/5 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Eye size={16} className="text-accent" />
                <span className="text-sm font-semibold text-ink">Trial — Preview only</span>
              </div>
              <ul className="space-y-2 text-sm text-ink-soft">
                <li className="flex items-start gap-2"><CheckCircle size={14} className="text-emerald-500 shrink-0 mt-0.5" /> Preview opens in your default browser</li>
                <li className="flex items-start gap-2"><CheckCircle size={14} className="text-emerald-500 shrink-0 mt-0.5" /> Share the LAN URL with a phone or client on the same network</li>
                <li className="flex items-start gap-2"><CheckCircle size={14} className="text-emerald-500 shrink-0 mt-0.5" /> QR code for instant mobile testing</li>
                <li className="flex items-start gap-2"><Lock size={14} className="text-ink-faded shrink-0 mt-0.5" /> <span className="text-ink-faded">Trial watermark visible — license removes it</span></li>
                <li className="flex items-start gap-2"><Lock size={14} className="text-ink-faded shrink-0 mt-0.5" /> <span className="text-ink-faded">Export to folder requires a license</span></li>
              </ul>
            </section>

            <section className="rounded-xl border border-line-soft bg-paper-tinted p-4 space-y-3">
              <p className="text-sm font-semibold text-ink">Unlock full compile</p>
              <p className="text-sm text-ink-soft">Purchase a license to export your tour as a static folder you can upload to any host.</p>
              <button
                onClick={() => window.conchitour.openUrl('https://conchitour.com')}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90"
              >
                Get a license
                <ArrowRight size={14} />
              </button>
            </section>
          </div>

          {/* RIGHT — preview action */}
          <div className="space-y-6">
            {sceneCount === 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                <p className="text-sm text-amber-700">No scenes yet — add scenes first.</p>
              </div>
            )}
            {auditBanner}
            <div className="flex items-center gap-3">
              <button
                onClick={handlePreview}
                disabled={!canPreview}
                className={clsx(
                  'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all',
                  canPreview ? 'bg-accent text-white hover:opacity-90 shadow-sm cursor-pointer' : 'bg-paper-strong text-ink-faded cursor-not-allowed'
                )}
              >
                {running && runMode === 'preview' ? <><Loader2 size={15} className="animate-spin" />Building preview…</> : <><Eye size={15} />Preview tour</>}
              </button>
              {running && runMode === 'preview' && (
                <button onClick={handleCancel} className="btn btn-danger">
                  <XCircle size={14} />
                  Cancel
                </button>
              )}
            </div>
            {progressAndResult}
          </div>

        </div>
      </ScreenShell>
    );
  }

  /* ─── EXPIRED layout ───────────────────────────────────────────── */
  if (licenseExpired) {
    return (
      <ScreenShell title="Compile" subtitle="Generate a static folder ready to upload anywhere.">
        <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 max-w-5xl mx-auto">
          <AlertTriangle size={15} className="text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-800 flex-1">License expired. Compile and Preview are disabled until renewal.</p>
          <button
            onClick={() => window.conchitour.openUrl('https://conchitour.com')}
            className="text-xs font-medium text-amber-700 hover:text-amber-900 underline whitespace-nowrap"
          >
            Renew now
          </button>
        </div>
      </ScreenShell>
    );
  }

  /* ─── LICENSED layout ──────────────────────────────────────────── */
  return (
    <ScreenShell title="Compile" subtitle="Generate a static folder ready to upload anywhere.">
      {showQr && lanUrl && <QrModal url={lanUrl} onClose={() => setShowQr(false)} />}
      <div className="grid grid-cols-2 gap-8 max-w-5xl mx-auto">

        {/* LEFT: Setup */}
        <div className="space-y-7">

          <section className="rounded-xl border border-line-soft bg-paper-tinted p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Settings size={13} className="text-ink-soft" />
              <span className="text-sm font-medium text-ink">krpano</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={krpanoPathDraft}
                onChange={(e) => setKrpanoPathDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleValidate()}
                placeholder="C:\Users\...\krpano"
                className="flex-1 px-3 py-1.5 rounded-md border border-line-strong bg-paper text-sm font-mono text-ink min-w-0 focus:outline-none focus:border-accent"
              />
              <button onClick={handleValidate} disabled={validating || !krpanoPathDraft} className="btn shrink-0 disabled:opacity-50 text-xs">
                {validating ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
                Detect
              </button>
            </div>
            {validation && (
              <div className={clsx('rounded-md px-3 py-1.5 text-xs', validation.valid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                {validation.valid
                  ? 'Installation OK — vtour skin, viewer and tools found.'
                  : <>Missing: {validation.missing.map((m, i) => <span key={m}><code className="font-mono bg-amber-100 px-0.5 rounded">{m}</code>{i < validation.missing.length - 1 ? ', ' : ''}</span>)}</>}
              </div>
            )}

            {settings?.krpanoPath && licenseStatus !== null && (
              <div className="border-t border-line-soft/60 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-ink-soft">
                    <Key size={11} /> License
                  </div>
                  <span className={clsx('text-[11px] px-2 py-0.5 rounded-full font-medium', licenseStatus.present ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                    {licenseStatus.present ? '✓ Activated' : 'Not activated'}
                  </span>
                </div>
                {licenseStatus.present && settings.licenseInfo && <LicenseInfoCard info={settings.licenseInfo} />}
                {!licenseStatus.present && (
                  <>
                    <textarea
                      rows={5}
                      value={licenseCode}
                      onChange={(e) => setLicenseCode(e.target.value)}
                      placeholder={'Paste registration code from purchase email…\n(multiline code is accepted)'}
                      className="w-full px-3 py-1.5 rounded-md border border-line-strong bg-paper text-xs font-mono focus:outline-none focus:border-accent resize-none"
                    />
                    {parsedLicense && <LicenseInfoCard info={parsedLicense} preview />}
                    <div className="flex items-center gap-2">
                      <button onClick={handleActivateLicense} disabled={activating || !licenseCode.trim()} className="btn btn-accent text-xs disabled:opacity-50">
                        {activating ? <Loader2 size={12} className="animate-spin" /> : <Key size={12} />}
                        {activating ? 'Activating…' : 'Activate'}
                      </button>
                    </div>
                  </>
                )}
                {licenseResult && (
                  <div className={clsx('rounded-md px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all',
                    licenseResult.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
                  )}>
                    {licenseResult.message}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <label className="text-sm font-medium text-ink">Output folder</label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center px-3 py-2 rounded-md border border-line-strong bg-paper-soft text-sm font-mono text-ink min-w-0">
                {outputDir ? <span className="truncate">{outputDir}</span> : <span className="text-ink-faded">No folder selected</span>}
              </div>
              <button onClick={handlePickFolder} className="btn shrink-0">
                <FolderOpen size={14} />
                Choose
              </button>
            </div>
          </section>

          <section className="space-y-2">
            <p className="text-sm font-medium text-ink">Options</p>
            <div className="space-y-2.5">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={settings.useKrpanoTiles} onChange={(e) => patchSettings({ useKrpanoTiles: e.target.checked })} className="mt-0.5 accent-accent" />
                <span className="text-sm">
                  <span className="font-medium text-ink">Generate cube tiles</span>
                  <span className="text-ink-faded ml-1.5 text-xs">Runs krpanotools per scene (~1–3 min each). Better quality.</span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={settings.includeLicense} onChange={(e) => patchSettings({ includeLicense: e.target.checked })} className="mt-0.5 accent-accent" />
                <span className="text-sm">
                  <span className="font-medium text-ink">Include krpano license</span>
                  <span className="text-ink-faded ml-1.5 text-xs">Removes "Not licensed" watermark.</span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={settings.includeTestServer} onChange={(e) => patchSettings({ includeTestServer: e.target.checked })} className="mt-0.5 accent-accent" />
                <span className="text-sm">
                  <span className="font-medium text-ink">Include testing server</span>
                  <span className="text-ink-faded ml-1.5 text-xs">Bundles testing server + START_TESTING_SERVER.bat for local preview.</span>
                </span>
              </label>
              {settings.useKrpanoTiles && (
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input type="checkbox" checked={forceRegenTiles} onChange={(e) => setForceRegenTiles(e.target.checked)} className="mt-0.5 accent-accent" />
                  <span className="text-sm">
                    <span className="font-medium text-ink">Force regenerate tiles</span>
                    <span className="text-ink-faded ml-1.5 text-xs">Re-runs krpanotools for every scene even if unchanged.</span>
                  </span>
                </label>
              )}
            </div>
          </section>

        </div>

        {/* RIGHT: Pre-flight + Actions + Progress + Result */}
        <div className="space-y-6">

          <section className="space-y-2">
            <p className="text-sm font-medium text-ink">Pre-flight</p>
            <ul className="space-y-1.5">
              {compilePreflight.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  {c.ok === null
                    ? <Circle size={14} className="text-line-strong shrink-0 mt-0.5" />
                    : c.ok
                      ? <CheckCircle size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                      : <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />}
                  <span className={clsx('text-xs', !c.ok && c.ok !== null ? 'text-amber-600' : 'text-ink-soft')}>{c.label}</span>
                </li>
              ))}
            </ul>
          </section>

          {auditBanner}

          {/* Action buttons */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleCompile}
              disabled={!canCompile}
              className={clsx(
                'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all',
                canCompile ? 'bg-accent text-white hover:opacity-90 shadow-sm cursor-pointer' : 'bg-paper-strong text-ink-faded cursor-not-allowed'
              )}
            >
              {running && runMode === 'compile' ? <><Loader2 size={15} className="animate-spin" />Compiling…</> : <><Play size={15} />Compile tour</>}
            </button>
            <button
              onClick={handlePreview}
              disabled={!canPreview}
              title="Quick local preview — opens in browser, no output folder needed"
              className={clsx(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border',
                canPreview ? 'border-line-strong text-ink hover:bg-paper-tinted cursor-pointer' : 'border-line text-ink-faded cursor-not-allowed'
              )}
            >
              {running && runMode === 'preview' ? <><Loader2 size={14} className="animate-spin" />Building…</> : <><Zap size={14} />Quick preview</>}
            </button>
            {running && (
              <button onClick={handleCancel} className="btn btn-danger">
                <XCircle size={14} />
                Cancel
              </button>
            )}
          </div>

          {progressAndResult}

        </div>

      </div>
    </ScreenShell>
  );
}
