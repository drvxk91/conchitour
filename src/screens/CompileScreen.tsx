import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  FolderOpen, Play, CheckCircle, AlertTriangle, Circle,
  Loader2, ExternalLink, Copy, Settings, RotateCw, XCircle, ChevronDown, Key,
  ClipboardCheck,
} from 'lucide-react';
import clsx from 'clsx';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { runStaticAudit } from '@/lib/audit/static-checks';
import type { CompileResult, ConchitectSettings, KrpanoValidationResult, KrpanoLicenseStatus, KrpanoRegisterResult, TileProgressData, LicenseInfo } from '../../electron/preload';

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

export function CompileScreen() {
  const { project, setIsCompiling, clearDirty, setActiveScreen } = useProject();

  const [settings, setSettings]             = useState<ConchitectSettings | null>(null);
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
  const [result, setResult]                 = useState<CompileResult | null>(null);
  const [copied, setCopied]                 = useState(false);
  const [forceRegenTiles, setForceRegenTiles] = useState(false);
  const [currentStep, setCurrentStep]       = useState<StepId | null>(null);
  const [tileProgress, setTileProgress]     = useState<TileProgressData | null>(null);
  const completedStepsRef                   = useRef<Set<StepId>>(new Set());
  const logRef                              = useRef<HTMLDivElement>(null);
  const resultRef                           = useRef<HTMLDivElement>(null);

  const parsedLicense = useMemo(() => parseLicenseCode(licenseCode), [licenseCode]);

  useEffect(() => {
    window.conchitect.settingsGet().then((s) => {
      setSettings(s);
      setKrpanoPathDraft(s.krpanoPath);
      window.conchitect.getDefaultOutputDir().then((d) => { if (d) setOutputDir(d); });
      window.conchitect.krpanoValidate(s.krpanoPath).then(setValidation);
      if (s.krpanoPath) window.conchitect.krpanoLicenseStatus(s.krpanoPath).then(setLicenseStatus);
    });

    window.conchitect.compileGetState().then((state) => {
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
    const unsub = window.conchitect.onCompileDone((res) => {
      setRunning(false);
      setIsCompiling(false);
      setResult(res);
    });
    return unsub;
  }, [setIsCompiling]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // Scroll result into view when it appears
  useEffect(() => {
    if (result && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [result]);

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

  useEffect(() => {
    const unsub = window.conchitect.onTileProgress((data) => { setTileProgress(data); });
    return unsub;
  }, []);

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
      const res = await window.conchitect.krpanoRegister(settings.krpanoPath, licenseCode);
      setLicenseResult(res);
      if (res.ok) {
        const ls = await window.conchitect.krpanoLicenseStatus(settings.krpanoPath);
        setLicenseStatus(ls);
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
    const dir = await window.conchitect.showFolderDialog();
    if (dir) { setOutputDir(dir); patchSettings({ lastOutputDir: dir }); }
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
      const saved = await window.conchitect.saveProject(project);
      if (saved) clearDirty();
      const projectData = forceRegenTiles ? { ...project, __forceRegenTiles: true } : project;
      const res = await window.conchitect.compileRun(projectData, outputDir);
      setResult(res);
    } finally {
      setRunning(false);
      setIsCompiling(false);
    }
  }, [outputDir, running, project, setIsCompiling, forceRegenTiles]);

  const handleCancel = useCallback(() => { window.conchitect.compileCancel(); }, []);

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

  const auditIssues = useMemo(() => runStaticAudit(project), [project]);
  const auditErrors   = auditIssues.filter((i) => i.severity === 'error').length;
  const auditWarnings = auditIssues.filter((i) => i.severity === 'warning').length;

  const checks = [
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

  return (
    <ScreenShell title="Compile" subtitle="Generate a static folder ready to upload anywhere.">
      <div className="grid grid-cols-2 gap-8 max-w-5xl">

        {/* ── LEFT: Setup ─────────────────────────────────────────────── */}
        <div className="space-y-7">

          {/* krpano — installation + license in one card */}
          <section className="rounded-xl border border-line-soft bg-paper-tinted p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Settings size={13} className="text-ink-soft" />
              <span className="text-sm font-medium text-ink">krpano</span>
            </div>

            {/* Path */}
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

            {/* License — shown once the path is set */}
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
                {/* Result shown regardless of activated/not — survives status flip */}
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

          {/* Output folder */}
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

          {/* Options */}
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

        {/* ── RIGHT: Pre-flight + Compile + Progress + Result ──────────── */}
        <div className="space-y-6">

          {/* Pre-flight */}
          <section className="space-y-2">
            <p className="text-sm font-medium text-ink">Pre-flight</p>
            <ul className="space-y-1.5">
              {checks.map((c, i) => (
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

          {/* Audit banner */}
          {auditErrors > 0 ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3">
              <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-red-700">
                  {auditErrors} error{auditErrors !== 1 ? 's' : ''} found — visitors may see problems.
                </p>
                <button
                  onClick={() => setActiveScreen('audit')}
                  className="mt-1 text-xs text-red-600 underline"
                >
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
                <button
                  onClick={() => setActiveScreen('audit')}
                  className="mt-1 text-xs text-amber-600 underline"
                >
                  Review suggestions
                </button>
              </div>
            </div>
          ) : sceneCount > 0 ? (
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-3">
              <ClipboardCheck size={15} className="text-green-500 shrink-0" />
              <p className="text-sm text-green-700 font-medium">Audit passed — ready to compile.</p>
            </div>
          ) : null}

          {/* Compile button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleCompile}
              disabled={!canCompile}
              className={clsx(
                'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all',
                canCompile ? 'bg-accent text-white hover:opacity-90 shadow-sm cursor-pointer' : 'bg-paper-strong text-ink-faded cursor-not-allowed'
              )}
            >
              {running ? <><Loader2 size={15} className="animate-spin" />Compiling…</> : <><Play size={15} />Compile tour</>}
            </button>
            {running && (
              <button onClick={handleCancel} className="btn btn-danger">
                <XCircle size={14} />
                Cancel
              </button>
            )}
          </div>

          {(log.length > 0 || running) && (
            <section className="space-y-3">
              <p className="text-sm font-medium text-ink">Progress</p>

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

              {/* Raw log (collapsible) */}
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

          {/* Result banner */}
          {result && (
            <section ref={resultRef} className={clsx('rounded-lg border px-4 py-4', result.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50')}>
              {result.ok ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-emerald-700">Tour compiled successfully!</p>
                    {result.fileCount != null && result.sizeBytes != null && (
                      <p className="text-xs text-emerald-600 mt-0.5">{result.fileCount} files — {(result.sizeBytes / 1048576).toFixed(1)} MB</p>
                    )}
                  </div>
                  {result.previewUrl && (
                    <div className="flex items-center gap-2 bg-white border border-emerald-200 rounded-md px-3 py-2">
                      <span className="text-xs text-emerald-700 font-mono flex-1 truncate">{result.previewUrl}</span>
                      <button onClick={() => window.conchitect.openUrl(result.previewUrl!)} className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 shrink-0">
                        <ExternalLink size={11} />
                        Open
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => window.conchitect.openFolder(result.outputDir!)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">
                      <ExternalLink size={12} />
                      Open folder
                    </button>
                    <button onClick={handleCopyPath} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-300 text-emerald-700 text-xs font-medium hover:bg-emerald-100">
                      <Copy size={12} />
                      {copied ? 'Copied!' : 'Copy path'}
                    </button>
                  </div>
                  <p className="text-xs text-emerald-600/70 font-mono">
                    Deploy: cd &quot;{result.outputDir}&quot; &amp;&amp; npm install &amp;&amp; node server.js
                  </p>
                </div>
              ) : (
                <p className="text-sm font-medium text-red-700">Compile failed: {result.error}</p>
              )}
            </section>
          )}
        </div>

      </div>
    </ScreenShell>
  );
}
