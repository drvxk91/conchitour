import { useState, useRef, useEffect, useCallback } from 'react';
import { FolderOpen, Play, CheckCircle, AlertTriangle, Circle, Loader2, ExternalLink, Copy } from 'lucide-react';
import clsx from 'clsx';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import type { CompileResult } from '../../electron/preload';

interface LogEntry {
  msg: string;
  status: 'running' | 'ok' | 'error' | 'info';
}

export function CompileScreen() {
  const { project } = useProject();
  const [outputDir, setOutputDir] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CompileResult | null>(null);
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log to bottom on each new entry
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  // Subscribe to progress events from the main process
  useEffect(() => {
    const unsub = window.conchitect.onCompileProgress((msg, status) => {
      setLog((prev) => [...prev, { msg, status: status as LogEntry['status'] }]);
    });
    return unsub;
  }, []);

  const handlePickFolder = useCallback(async () => {
    const dir = await window.conchitect.showFolderDialog();
    if (dir) setOutputDir(dir);
  }, []);

  const handleCompile = useCallback(async () => {
    if (!outputDir || running) return;
    setLog([]);
    setResult(null);
    setRunning(true);
    try {
      const res = await window.conchitect.compileRun(project, outputDir);
      setResult(res);
    } finally {
      setRunning(false);
    }
  }, [outputDir, running, project]);

  const handleCopyPath = useCallback(() => {
    if (!result?.outputDir) return;
    navigator.clipboard.writeText(result.outputDir).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  const sceneCount = project.scenes.length;
  const canCompile = outputDir.length > 0 && sceneCount > 0 && !running;

  const checks = [
    {
      label: sceneCount > 0 ? `${sceneCount} scene${sceneCount !== 1 ? 's' : ''} ready` : 'No scenes — add scenes first',
      ok: sceneCount > 0,
    },
    {
      label: outputDir ? `Output: ${outputDir}` : 'No output folder selected',
      ok: outputDir.length > 0,
    },
    {
      label: 'krpano runtime — checked at compile time',
      ok: null as boolean | null,
    },
  ];

  return (
    <ScreenShell title="Compile" subtitle="Generate a static folder ready to upload anywhere.">
      <div className="max-w-2xl space-y-8">

        {/* Output folder picker */}
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

        {/* Pre-flight checklist */}
        <section className="space-y-2">
          <p className="text-sm font-medium text-ink-base">Pre-flight</p>
          <ul className="space-y-1.5">
            {checks.map((c, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                {c.ok === null
                  ? <Circle size={14} className="text-line-strong shrink-0" />
                  : c.ok
                    ? <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                    : <AlertTriangle size={14} className="text-amber-400 shrink-0" />}
                <span className={clsx(!c.ok && c.ok !== null ? 'text-amber-600' : 'text-ink-soft')}>
                  {c.label}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Compile button */}
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

        {/* Progress log */}
        {log.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-medium text-ink-faded uppercase tracking-wider">Output</p>
            <div
              ref={logRef}
              className="bg-zinc-900 rounded-lg px-4 py-3 space-y-1 max-h-64 overflow-y-auto font-mono text-xs"
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
          </section>
        )}

        {/* Result banner */}
        {result && (
          <section className={clsx(
            'rounded-lg border px-4 py-3',
            result.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'
          )}>
            {result.ok ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-emerald-700">Tour compiled successfully!</p>
                <div className="flex gap-2">
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
