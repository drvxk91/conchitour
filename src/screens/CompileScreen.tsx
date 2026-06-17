import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  FolderOpen, Play, CheckCircle, AlertTriangle, Circle,
  Loader2, ExternalLink, Copy, Settings, RotateCw, XCircle, ChevronDown, Key,
} from 'lucide-react';
import clsx from 'clsx';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import type { CompileResult, ConchitectSettings, KrpanoValidationResult, KrpanoLicenseStatus, KrpanoRegisterResult, TileProgressData, LicenseInfo } from '../../electron/preload';

// Parse human-readable fields from a krpano registration code block.
// krpano purchase emails contain lines like "Name: ...", "Domain: ...", etc.
function parseLicenseCode(code: string): LicenseInfo | null {
  const result: LicenseInfo = {};
  for (const line of code.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w][\w\s\-]*?)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase().replace(/[\s-]+/g, '');
    const val = m[2].trim();
    if (['name', 'user', 'registeredto'].includes(key)) result.name = val;
    else if (['email', 'mail', 'email'].includes(key)) result.email = val;
    else if (key === 'domain') result.domain = val;
    else if (['license', 'licensetype', 'type', 'edition'].includes(key)) result.type = val;
    else if (['valid', 'validuntil', 'validthrough', 'expires'].includes(key)) result.validUntil = val;
  }
  return (result.name || result.domain || result.email) ? result : null;
}

interface LogEntry {
  msg: string;
  status: 'running' | 'ok' | 'error' | 'info';
}

// Named compile steps (matches main.ts progress messages)
const COMPILE_STEPS = [
  { id: 'init',     label: 'Prepare output folder' },
  { id: 'runtime',  label: 'Copy krpano runtime' },
  { id: 'skin',     label: 'Copy vtour skin' },
  { id: 'media',    label: 'Copy scene images' },
  { id: 'tiles',    label: 'Generate cube tiles' },
  { id: 'xml',      label: 'Generate tour.xml' },
  { id: 'html',     label: 'Generate HTML pages' },
  { id: 'seo',      label: 'Generate SEO files' },
  { id: 'done',     label: 'Finished' },
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
  if (m.includes('index.html') || m.includes('scene page')) return 'html';
  if (m.includes('sitemap') || m.includes('robots') || m.includes('readme') || m.includes('rewrite')) return 'seo';
  if (m.includes('done —') || m.includes('files,')) return 'done';
  return null;
}

function LicenseInfoCard({ info, preview = false }: { info: LicenseInfo; preview?: boolean }) {
  const rows = [
    { label: 'Name',    value: info.name },
    { label: 'Email',   value: info.email },
    { label: 'Domain',  value: info.domain },
    { label: 'Type',    value: info.type },
    { label: 'Valid',   value: info.validUntil },
  ].filter(r => r.value);
  if (rows.length === 0) return null;
  return (
    <div className={clsx(
      'rounded-md px-3 py-2 text-xs space-y-0.5',
      preview ? 'bg-blue-50 border border-blue-100' : 'bg-emerald-50 border border-emerald-100'
    )}>
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

export function CompileScreen() {
  const { project, setIsCompiling } = useProject();

  // Settings state
  const [settings, setSettings] = useState<ConchitectSettings | null>(null);
  const [krpanoPathDraft, setKrpanoPathDraft]   = useState('');
  const [validation, setValidation]             = useState<KrpanoValidationResult | null>(null);
  const [validating, setValidating]             = useState(false);

  // License state
  const [licenseStatus, setLicenseStatus]       = useState<KrpanoLicenseStatus | null>(null);
  const [licenseCode, setLicenseCode]           = useState('');
  const [activating, setActivating]             = useState(false);
  const [licenseResult, setLicenseResult]       = useState<KrpanoRegisterResult | null>(null);

  // Compile state
  const [outputDir, setOutputDir]         = useState('');
  const [log, setLog]                     = useState<LogEntry[]>([]);
  const [running, setRunning]             = useState(false);
  const [result, setResult]               = useState<CompileResult | null>(null);
  const [copied, setCopied]               = useState(false);
  const [forceRegenTiles, setForceRegenTiles] = useState(false);
  const [currentStep, setCurrentStep]     = useState<StepId | null>(null);
  const [tileProgress, setTileProgress]   = useState<TileProgressData | null>(null);
  const completedStepsRef = useRef<Set<StepId>>(new Set());
  const logRef = useRef<HTMLDivElement>(null);

  // License code parsed preview (computed from textarea)
  const parsedLicense = useMemo(() => parseLicenseCode(licenseCode), [licenseCode]);

  // Load settings and restore any in-progress compile on mount
  useEffect(() => {
    window.conchitect.settingsGet().then((s) => {
      setSettings(s);
      setKrpanoPathDraft(s.krpanoPath);
      if (s.lastOutputDir) setOutputDir(s.lastOutputDir);
      window.conchitect.krpanoValidate(s.krpanoPath).then(setValidation);
      if (s.krpanoPath) window.conchitect.krpanoLicenseStatus(s.krpanoPath).then(setLicenseStatus);
    });

    window.conchitect.compileGetState().then((state) => {
      if (!state) return;
      setLog(state.log.map((e) => ({ msg: e.msg, status: e.status as LogEntry['status'] })));
      setRunning(state.running);
      setIsCompiling(state.running);
      if (state.result) setResult(state.result);
      // Restore step progress by replaying log entries
      const restoredSteps = new Set<StepId>();
      let lastStep: StepId | null = null;
      for (const entry of state.log) {
        const step = msgToStep(entry.msg);
        if (step) {
          lastStep = step;
          if (entry.status === 'ok') restoredSteps.add(step);
        }
      }
      completedStepsRef.current = restoredSteps;
      if (state.running && lastStep) setCurrentStep(lastStep);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear running state when compile finishes (even if handleCompile ran on a prior component instance)
  useEffect(() => {
    const unsub = window.conchitect.onCompileDone((res) => {
      setRunning(false);
      setIsCompiling(false);
      setResult(res);
    });
    return unsub;
  }, [setIsCompiling]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // Subscribe to compile progress events
  useEffect(() => {
    const unsub = window.conchitect.onCompileProgress((msg, status) => {
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

  // Subscribe to per-tile % progress
  useEffect(() => {
    const unsub = window.conchitect.onTileProgress((data) => {
      setTileProgress(data);
    });
    return unsub;
  }, []);

  // Persist a settings field
  const patchSettings = useCallback((patch: Partial<ConchitectSettings>) => {
    setSettings((prev) => prev ? { ...prev, ...patch } : prev);
    window.conchitect.settingsSet(patch);
  }, []);

  const handleValidate = useCallback(async () => {
    if (!krpanoPathDraft) return;
    setValidating(true);
    setValidation(null);
    patchSettings({ krpanoPath: krpanoPathDraft });
    const r = await window.conchitect.krpanoValidate(krpanoPathDraft);
    setValidation(r);
    const ls = await window.conchitect.krpanoLicenseStatus(krpanoPathDraft);
    setLicenseStatus(ls);
    setValidating(false);
  }, [krpanoPathDraft, patchSettings]);

  const handleActivateLicense = useCallback(async () => {
    if (!settings?.krpanoPath || !licenseCode.trim()) return;
    setActivating(true);
    setLicenseResult(null);
    const res = await window.conchitect.krpanoRegister(settings.krpanoPath, licenseCode);
    setLicenseResult(res);
    if (res.ok) {
      const ls = await window.conchitect.krpanoLicenseStatus(settings.krpanoPath);
      setLicenseStatus(ls);
      // Persist whatever we could extract from the code so we can show it to the client
      const info = parseLicenseCode(licenseCode);
      if (info) patchSettings({ licenseInfo: info });
      setLicenseCode('');
    }
    setActivating(false);
  }, [settings?.krpanoPath, licenseCode, patchSettings]);

  const handlePickFolder = useCallback(async () => {
    const dir = await window.conchitect.showFolderDialog();
    if (dir) {
      setOutputDir(dir);
      patchSettings({ lastOutputDir: dir });
    }
  }, [patchSettings]);

  const handleCompile = useCallback(async () => {
    if (!outputDir || running) return;
    setLog([]);
    setResult(null);
    setCurrentStep(null);
    completedStepsRef.current = new Set();
    setRunning(true);
    setIsCompiling(true);
    try {
      // Pass __forceRegenTiles as a side-channel flag on the project object
      const projectData = forceRegenTiles ? { ...project, __forceRegenTiles: true } : project;
      const res = await window.conchitect.compileRun(projectData, outputDir);
      setResult(res);
    } finally {
      setRunning(false);
      setIsCompiling(false);
    }
  }, [outputDir, running, project, setIsCompiling, forceRegenTiles]);

  const handleCancel = useCallback(() => {
    window.conchitect.compileCancel();
  }, []);

  const handleCopyPath = useCallback(() => {
    if (!result?.outputDir) return;
    navigator.clipboard.writeText(result.outputDir).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  const sceneCount = project.scenes.length;
  const krpanoOk   = validation?.valid ?? false;
  const canCompile = outputDir.length > 0 && sceneCount > 0 && !running;

  const checks = [
    {
      label: sceneCount > 0
        ? `${sceneCount} scene${sceneCount !== 1 ? 's' : ''} ready`
        : 'No scenes — add scenes first',
      ok: sceneCount > 0,
    },
    {
      label: outputDir ? `Output: ${outputDir}` : 'No output folder selected',
      ok: outputDir.length > 0,
    },
    {
      label: validation
        ? (krpanoOk
            ? 'krpano installation detected'
            : `krpano incomplete — missing: ${validation.missing.join(', ')}`)
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

  return (
    <ScreenShell title="Compile" subtitle="Generate a static folder ready to upload anywhere.">
      <div className="max-w-2xl space-y-8">

        {/* ── krpano Installation ──────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Settings size={14} className="text-ink-soft" />
            <span className="text-sm font-medium text-ink-base">krpano installation</span>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={krpanoPathDraft}
              onChange={(e) => setKrpanoPathDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleValidate()}
              placeholder="C:\Users\...\krpano"
              className="flex-1 px-3 py-2 rounded-md border border-line-strong bg-paper-soft text-sm font-mono text-ink-base min-w-0 focus:outline-none focus:border-blue-400"
            />
            <button
              onClick={handleValidate}
              disabled={validating || !krpanoPathDraft}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-line-strong bg-white text-sm text-ink-base hover:bg-paper-soft transition-colors shrink-0 disabled:opacity-50"
            >
              {validating
                ? <Loader2 size={13} className="animate-spin" />
                : <RotateCw size={13} />}
              Detect
            </button>
          </div>

          {validation && (
            <div className={clsx(
              'rounded-md px-3 py-2 text-xs',
              validation.valid
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            )}>
              {validation.valid
                ? 'krpano installation OK — vtour skin, viewer runtime, and tools found.'
                : <>
                    Missing files:{' '}
                    {validation.missing.map((m, i) => (
                      <span key={m}><code className="font-mono bg-amber-100 px-0.5 rounded">{m}</code>{i < validation.missing.length - 1 ? ', ' : ''}</span>
                    ))}
                  </>}
            </div>
          )}
        </section>

        {/* ── License ──────────────────────────────────────────────────── */}
        {settings?.krpanoPath && licenseStatus !== null && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key size={14} className="text-ink-soft" />
                <span className="text-sm font-medium text-ink-base">krpano license</span>
              </div>
              <span className={clsx(
                'text-xs px-2 py-0.5 rounded-full font-medium',
                licenseStatus.present
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              )}>
                {licenseStatus.present ? '✓ Activated' : 'Not activated'}
              </span>
            </div>

            {/* Activated: show stored license info */}
            {licenseStatus.present && settings.licenseInfo && (
              <LicenseInfoCard info={settings.licenseInfo} />
            )}

            {/* Not activated: registration form */}
            {!licenseStatus.present && (
              <div className="space-y-2 pl-5">
                <p className="text-xs text-ink-faded">
                  Paste your registration code from the krpano purchase email to remove the watermark.
                </p>
                <textarea
                  value={licenseCode}
                  onChange={(e) => setLicenseCode(e.target.value)}
                  placeholder="Paste your registration code here…"
                  rows={5}
                  className="w-full px-3 py-2 rounded-md border border-line-strong bg-paper-soft text-xs font-mono text-ink-base focus:outline-none focus:border-blue-400 resize-none"
                />
                {/* Preview of parsed info while typing */}
                {parsedLicense && <LicenseInfoCard info={parsedLicense} preview />}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleActivateLicense}
                    disabled={activating || !licenseCode.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {activating
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Key size={13} />}
                    Activate
                  </button>
                  {licenseResult && (
                    <span className={clsx(
                      'text-xs',
                      licenseResult.ok ? 'text-emerald-600' : 'text-red-500'
                    )}>
                      {licenseResult.message}
                    </span>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Output folder ────────────────────────────────────────────── */}
        <section className="space-y-2">
          <label className="text-sm font-medium text-ink-base">Output folder</label>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center px-3 py-2 rounded-md border border-line-strong bg-paper-soft text-sm font-mono text-ink-base min-w-0">
              {outputDir
                ? <span className="truncate">{outputDir}</span>
                : <span className="text-ink-faded">No folder selected</span>}
            </div>
            <button
              onClick={handlePickFolder}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-line-strong bg-white text-sm text-ink-base hover:bg-paper-soft transition-colors shrink-0"
            >
              <FolderOpen size={14} />
              Choose
            </button>
          </div>
        </section>

        {/* ── Options ──────────────────────────────────────────────────── */}
        <section className="space-y-2">
          <p className="text-sm font-medium text-ink-base">Options</p>
          <div className="space-y-2.5">
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.useKrpanoTiles}
                onChange={(e) => patchSettings({ useKrpanoTiles: e.target.checked })}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium text-ink-base">Generate cube tiles</span>
                <span className="text-ink-faded ml-1.5">Runs krpanotools per scene (~1–3 min each). Better quality and loading performance.</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.includeLicense}
                onChange={(e) => patchSettings({ includeLicense: e.target.checked })}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium text-ink-base">Include krpano license</span>
                <span className="text-ink-faded ml-1.5">Copies krpanolicense.xml — removes the "Not licensed" watermark.</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.includeTestServer}
                onChange={(e) => patchSettings({ includeTestServer: e.target.checked })}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium text-ink-base">Include testing server</span>
                <span className="text-ink-faded ml-1.5">Bundles "krpano Testing Server.exe" + a START_TESTING_SERVER.bat for local preview.</span>
              </span>
            </label>
            {settings.useKrpanoTiles && (
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={forceRegenTiles}
                  onChange={(e) => setForceRegenTiles(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  <span className="font-medium text-ink-base">Force regenerate tiles</span>
                  <span className="text-ink-faded ml-1.5">Ignores cache — re-runs krpanotools for every scene even if unchanged.</span>
                </span>
              </label>
            )}
          </div>
        </section>

        {/* ── Pre-flight checklist ─────────────────────────────────────── */}
        <section className="space-y-2">
          <p className="text-sm font-medium text-ink-base">Pre-flight</p>
          <ul className="space-y-1.5">
            {checks.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                {c.ok === null
                  ? <Circle size={14} className="text-line-strong shrink-0 mt-0.5" />
                  : c.ok
                    ? <CheckCircle size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                    : <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />}
                <span className={clsx(
                  !c.ok && c.ok !== null ? 'text-amber-600' : 'text-ink-soft'
                )}>
                  {c.label}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Compile button ───────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleCompile}
            disabled={!canCompile}
            className={clsx(
              'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all',
              canCompile
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm cursor-pointer'
                : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
            )}
          >
            {running
              ? <><Loader2 size={15} className="animate-spin" />Compiling…</>
              : <><Play size={15} />Compile tour</>}
          </button>
          {running && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
            >
              <XCircle size={14} />
              Cancel
            </button>
          )}
        </div>

        {/* ── Stepped progress ─────────────────────────────────────────── */}
        {(log.length > 0 || running) && (
          <section className="space-y-3">
            {/* Named steps */}
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
                          ? <Loader2 size={13} className="text-blue-500 animate-spin shrink-0" />
                          : <Circle size={13} className="text-line-strong shrink-0" />}
                      <span className={clsx(
                        isDone && 'text-ink',
                        isCurrent && 'text-ink font-medium',
                        isWaiting && 'text-ink-soft',
                      )}>{step.label}</span>
                      {showTileProgress && (
                        <span className="ml-auto text-[11px] text-ink-faded font-mono">
                          {tileProgress.sceneIndex}/{tileProgress.totalScenes} · {tileProgress.percent}%
                        </span>
                      )}
                    </div>
                    {showTileProgress && (
                      <div className="ml-[21px] h-1 rounded-full bg-line overflow-hidden">
                        <div
                          className="h-full bg-blue-400 rounded-full transition-all duration-150"
                          style={{ width: `${tileProgress.percent}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Raw log (collapsible) */}
            <details className="group">
              <summary className="flex items-center gap-1.5 text-xs text-ink-faded cursor-pointer select-none hover:text-ink-soft list-none">
                <ChevronDown size={11} className="transition-transform group-open:rotate-180" />
                Raw output ({log.length} lines)
              </summary>
              <div
                ref={logRef}
                className="mt-2 bg-zinc-900 rounded-lg px-4 py-3 space-y-0.5 max-h-48 overflow-y-auto font-mono text-[11px]"
              >
                {log.map((entry, i) => (
                  <div
                    key={i}
                    className={clsx(
                      'flex items-start gap-2',
                      entry.status === 'ok'      && 'text-emerald-400',
                      entry.status === 'error'   && 'text-red-400',
                      entry.status === 'running' && 'text-yellow-400',
                      entry.status === 'info'    && 'text-zinc-400',
                    )}
                  >
                    <span className="select-none shrink-0 w-3 text-center">
                      {entry.status === 'ok'      && '✓'}
                      {entry.status === 'error'   && '✗'}
                      {entry.status === 'running' && '●'}
                      {entry.status === 'info'    && '·'}
                    </span>
                    <span>{entry.msg}</span>
                  </div>
                ))}
              </div>
            </details>
          </section>
        )}

        {/* ── Result banner ────────────────────────────────────────────── */}
        {result && (
          <section className={clsx(
            'rounded-lg border px-4 py-3',
            result.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'
          )}>
            {result.ok ? (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-emerald-700">Tour compiled successfully!</p>
                  {result.fileCount != null && result.sizeBytes != null && (
                    <p className="text-xs text-emerald-600 mt-0.5">
                      {result.fileCount} files — {(result.sizeBytes / 1048576).toFixed(1)} MB
                    </p>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => window.conchitect.openFolder(result.outputDir!)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors"
                  >
                    <ExternalLink size={12} />
                    Open folder
                  </button>
                  <button
                    onClick={handleCopyPath}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-300 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors"
                  >
                    <Copy size={12} />
                    {copied ? 'Copied!' : 'Copy path'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm font-medium text-red-700">
                Compile failed: {result.error}
              </p>
            )}
          </section>
        )}

      </div>
    </ScreenShell>
  );
}
