import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  RefreshCw, Sparkles, AlertCircle, AlertTriangle, Lightbulb, Info,
  ExternalLink, Check, X, ChevronDown, Loader2, Bot, Square,
} from 'lucide-react';
import clsx from 'clsx';
import { useProject, type ScreenId } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { runStaticAudit } from '@/lib/audit/static-checks';
import { runAiAuditStreaming, type AuditStreamEvent } from '@/lib/audit/ai-checks';
import { resolveAiProvider } from '@/lib/ai-resolve';
import { computeAiCost, resolvedModelId } from '@/lib/ai-tracking';
import { runSeoAudit } from '@/lib/seo-audit';
import { consumeTrialAiCall } from '@/lib/trial';
import { withContextGate } from '@/lib/ai-context-gate';
import { UpgradeModal } from '@/components/UpgradeModal';
import type { UpgradeFeature } from '@/components/UpgradeModal';
import type { AuditIssue, AuditReport, AuditSeverity, AuditCategory } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildReport(issues: AuditIssue[], aiUsed: boolean, tokensIn = 0, tokensOut = 0): AuditReport {
  const summary: Record<AuditSeverity, number> = { error: 0, warning: 0, suggestion: 0, info: 0 };
  for (const i of issues) summary[i.severity]++;
  return { generatedAt: Date.now(), issues, summary, aiUsed, aiTokensIn: tokensIn, aiTokensOut: tokensOut };
}

const SEVERITY_ORDER: AuditSeverity[] = ['error', 'warning', 'suggestion', 'info'];

const SEV_CONFIG: Record<AuditSeverity, { label: string; bg: string; text: string; icon: React.ElementType; iconColor: string }> = {
  error:      { label: 'Error',      bg: 'bg-red-50 border-red-200',    text: 'text-red-700',    icon: AlertCircle,   iconColor: 'text-red-500' },
  warning:    { label: 'Warning',    bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700',  icon: AlertTriangle, iconColor: 'text-amber-500' },
  suggestion: { label: 'Suggestion', bg: 'bg-blue-50 border-blue-200',  text: 'text-blue-700',   icon: Lightbulb,     iconColor: 'text-blue-500' },
  info:       { label: 'Info',       bg: 'bg-paper border-line',        text: 'text-ink-soft',   icon: Info,          iconColor: 'text-ink-faded' },
};

const CAT_LABELS: Record<AuditCategory, string> = {
  content: 'Content', navigation: 'Navigation', seo: 'SEO', i18n: 'Languages',
  branding: 'Branding', modules: 'Modules', pages: 'Pages', analytics: 'Analytics',
  media: 'Media', 'ai-content': 'AI · Content', 'ai-narrative': 'AI · Narrative',
};

function SeverityBadge({ sev }: { sev: AuditSeverity }) {
  const { label, text, bg } = SEV_CONFIG[sev];
  return (
    <span className={clsx('inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border', bg, text)}>
      {label}
    </span>
  );
}

function CategoryBadge({ cat }: { cat: AuditCategory }) {
  return (
    <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-paper-strong text-ink-faded border border-line-soft">
      {CAT_LABELS[cat]}
    </span>
  );
}

function SummaryTile({ sev, count }: { sev: AuditSeverity; count: number }) {
  const { icon: Icon, iconColor, label, bg, text } = SEV_CONFIG[sev];
  return (
    <div className={clsx('flex items-center gap-3 rounded-xl border px-4 py-3', bg)}>
      <Icon size={20} className={iconColor} />
      <div>
        <p className={clsx('text-2xl font-bold leading-none', text)}>{count}</p>
        <p className={clsx('text-[10px] font-medium uppercase tracking-wide mt-0.5', text)}>{label}{count !== 1 ? 's' : ''}</p>
      </div>
    </div>
  );
}

// ── Streaming pane ────────────────────────────────────────────────────────────

interface StreamingPaneProps {
  status: string;
  streamText: string;
  tokensIn: number;
  tokensOut: number;
  modelId: string;
  providerName: string;
  onCancel: () => void;
}

function StreamingPane({ status, streamText, tokensIn, tokensOut, modelId, providerName, onCancel }: StreamingPaneProps) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamText, expanded]);

  const costEst = tokensIn > 0 ? computeAiCost(modelId, tokensIn, tokensOut).toFixed(4) : null;

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-purple-100">
        <Bot size={16} className="text-purple-600 shrink-0" />
        <span className="text-sm font-medium text-purple-900 flex-1">{providerName} is reviewing your tour…</span>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
        >
          <Square size={10} /> Cancel
        </button>
      </div>

      <div className="px-4 py-2.5 space-y-2">
        <p className="text-xs text-purple-700 font-medium">Status: {status}</p>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-purple-600 font-medium hover:text-purple-800 transition-colors"
        >
          <ChevronDown size={12} className={clsx('transition-transform', expanded && 'rotate-180')} />
          {expanded ? 'Hide live response' : 'Show live response'}
          {streamText && !expanded && (
            <span className="text-purple-400 font-normal">
              ({streamText.length} chars)
            </span>
          )}
        </button>

        {expanded && (
          <div
            ref={scrollRef}
            className="bg-white/60 border border-purple-100 rounded-lg p-3 max-h-48 overflow-y-auto text-xs text-ink-soft font-mono leading-relaxed whitespace-pre-wrap"
          >
            {streamText || <span className="text-ink-faded italic">Waiting for response…</span>}
            {streamText && <span className="inline-block w-0.5 h-3 bg-purple-500 ml-0.5 animate-pulse align-middle" />}
          </div>
        )}

        {(tokensIn > 0 || tokensOut > 0) && (
          <p className="text-[11px] text-purple-500">
            Tokens: {tokensIn.toLocaleString()} in · {tokensOut.toLocaleString()} out
            {costEst && ` · ~$${costEst}`}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export function AuditScreen() {
  const { project, setActiveScreen, setActiveScene, updateScene, recordAiUsage } = useProject();

  const [report, setReport] = useState<AuditReport | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [appliedFixes, setAppliedFixes] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<AuditSeverity | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<AuditCategory | 'all'>('all');
  const [showAiOnly, setShowAiOnly] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [aiStreamText, setAiStreamText] = useState('');
  const [aiTokensIn, setAiTokensIn] = useState(0);
  const [aiTokensOut, setAiTokensOut] = useState(0);
  const [aiError, setAiError] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [upgradeFeature, setUpgradeFeature] = useState<UpgradeFeature | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ai = resolveAiProvider(project.modules ?? {});
  const defaultLang = project.languages.default || 'en';
  const auditModelId = resolvedModelId(
    ai?.provider ?? 'claude',
    ai?.provider === 'gpt' ? project.modules?.openaiModel : project.modules?.claudeModel,
  );
  const auditProviderName = ai?.provider === 'gpt' ? 'ChatGPT' : 'Claude';

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  const runStatic = useCallback(() => {
    const issues = runStaticAudit(project);
    const aiIssues = report?.issues.filter((i) => i.aiGenerated) ?? [];
    const merged = [...issues, ...aiIssues];
    setReport(buildReport(merged, report?.aiUsed ?? false, report?.aiTokensIn, report?.aiTokensOut));
    setDismissed(new Set());
  }, [project, report]);

  useEffect(() => {
    const issues = runStaticAudit(project);
    setReport(buildReport(issues, false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleCancel() {
    abortRef.current?.abort();
  }

  async function handleRunAi() {
    if (!ai || aiRunning) return;
    await withContextGate(project, async () => {
      const trialErr = await consumeTrialAiCall();
      if (trialErr) { setUpgradeFeature('ai'); return; }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setAiRunning(true);
      setAiError('');
      setAiStatus('');
      setAiStreamText('');
      setAiTokensIn(0);
      setAiTokensOut(0);

      try {
        const staticIssues = runStaticAudit(project);

        const handleEvent = (ev: AuditStreamEvent) => {
          if (ev.type === 'status') setAiStatus(ev.message);
          if (ev.type === 'token') setAiStreamText((t) => t + ev.text);
        };

        const { issues: aiIssues, tokensIn, tokensOut } = await runAiAuditStreaming(
          project, { ...ai!, modelId: auditModelId }, handleEvent, ctrl.signal,
        );

        setAiTokensIn(tokensIn);
        setAiTokensOut(tokensOut);
        const costUsd = computeAiCost(auditModelId, tokensIn, tokensOut);
        recordAiUsage({
          provider: ai!.provider === 'gpt' ? 'openai' : 'anthropic',
          modelId: auditModelId,
          inputTokens: tokensIn,
          outputTokens: tokensOut,
          costUsd,
          operation: 'audit',
        });
        setReport(buildReport([...staticIssues, ...aiIssues], true, tokensIn, tokensOut));
        showToast(`AI audit complete — ${aiIssues.length} suggestion${aiIssues.length !== 1 ? 's' : ''}`);
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          showToast('AI audit cancelled');
        } else {
          setAiError(String(err));
        }
      } finally {
        setAiRunning(false);
        setAiStatus('');
      }
    }, 'audit');
  }

  function handleDismiss(id: string) {
    setDismissed((prev) => new Set([...prev, id]));
  }

  function handleNavigate(issue: AuditIssue) {
    if (!issue.targetScreen) return;
    setActiveScreen(issue.targetScreen as ScreenId);
    if (issue.targetScreen === 'scenes' && issue.targetEntityId && issue.targetEntityType === 'scene') {
      setActiveScene(issue.targetEntityId);
    }
  }

  function handleApply(issue: AuditIssue) {
    if (!issue.targetEntityId || !issue.suggestion || !issue.fixField) return;
    const scene = project.scenes.find((s) => s.id === issue.targetEntityId);
    if (!scene) return;
    const existing = (scene[issue.fixField as keyof typeof scene] as Record<string, string>) ?? {};
    updateScene(issue.targetEntityId, { [issue.fixField]: { ...existing, [defaultLang]: issue.suggestion } });
    setAppliedFixes((prev) => new Set([...prev, `${issue.fixField}|${issue.targetEntityId}`]));
    handleDismiss(issue.id);
    showToast('Applied ✓');
  }

  // ── Filtered issue list ────────────────────────────────────────────────────

  const visibleIssues = useMemo(() => {
    if (!report) return [];
    return report.issues.filter((i) => {
      if (!showDismissed && dismissed.has(i.id)) return false;
      if (showDismissed && !dismissed.has(i.id)) return false;
      if (severityFilter !== 'all' && i.severity !== severityFilter) return false;
      if (categoryFilter !== 'all' && i.category !== categoryFilter) return false;
      if (showAiOnly && !i.aiGenerated) return false;
      if (!showDismissed && i.fixField && i.targetEntityId && appliedFixes.has(`${i.fixField}|${i.targetEntityId}`)) return false;
      return true;
    });
  }, [report, dismissed, appliedFixes, severityFilter, categoryFilter, showAiOnly, showDismissed]);

  const groupedIssues = useMemo(() => {
    const groups: { sev: AuditSeverity; issues: AuditIssue[] }[] = [];
    for (const sev of SEVERITY_ORDER) {
      const items = visibleIssues.filter((i) => i.severity === sev);
      if (items.length) groups.push({ sev, issues: items });
    }
    return groups;
  }, [visibleIssues]);

  const availableCategories = useMemo(() => {
    if (!report) return [];
    return [...new Set(report.issues.map((i) => i.category))];
  }, [report]);

  const estimatedCost = report?.aiTokensIn != null
    ? computeAiCost(auditModelId, report.aiTokensIn, report.aiTokensOut ?? 0).toFixed(4)
    : null;

  const seoAudit = useMemo(() => runSeoAudit(project), [project]);
  const SEO_GRADE = {
    good: { color: 'text-green-600', bg: 'bg-green-50 border-green-200', label: 'Good' },
    ok:   { color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', label: 'Needs work' },
    poor: { color: 'text-red-600',   bg: 'bg-red-50 border-red-200',     label: 'Poor' },
  } as const;
  const seoG          = SEO_GRADE[seoAudit.grade];
  const seoProblems   = seoAudit.checks.filter((c) => c.status === 'problem').length;
  const seoImprove    = seoAudit.checks.filter((c) => c.status === 'improvement').length;
  const seoGood       = seoAudit.checks.filter((c) => c.status === 'good').length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ScreenShell title="Tour Audit" subtitle="Pre-flight checks before publishing.">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* ── Header actions ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={runStatic} className="btn gap-2">
            <RefreshCw size={13} />
            Refresh static checks
          </button>
          <button
            onClick={handleRunAi}
            disabled={!ai || aiRunning}
            title={!ai ? 'Add an Anthropic or OpenAI key in Modules to enable AI checks' : `Using ${ai.provider === 'gpt' ? 'ChatGPT' : 'Claude'}`}
            className={clsx(
              'btn gap-2 transition-colors',
              ai && !aiRunning ? 'btn-accent' : 'opacity-50 cursor-not-allowed'
            )}
          >
            {aiRunning
              ? <><Loader2 size={13} className="animate-spin" />Reviewing…</>
              : <><Sparkles size={13} />Run AI checks</>}
          </button>
          {!ai && (
            <p className="text-xs text-ink-faded">
              Add an Anthropic or OpenAI key in{' '}
              <button className="underline text-accent" onClick={() => setActiveScreen('modules')}>Modules</button>
              {' '}to enable AI checks (~$0.01–0.05 per audit).
            </p>
          )}
          {aiError && (
            <p className="text-xs text-red-500 flex items-center gap-1">
              <AlertCircle size={12} /> {aiError}
            </p>
          )}
        </div>

        {/* ── Live streaming pane ────────────────────────────────────────── */}
        {aiRunning && (
          <StreamingPane
            status={aiStatus}
            streamText={aiStreamText}
            tokensIn={aiTokensIn}
            tokensOut={aiTokensOut}
            modelId={auditModelId}
            providerName={auditProviderName}
            onCancel={handleCancel}
          />
        )}

        {/* ── Summary tiles ──────────────────────────────────────────────── */}
        {report && (
          <>
            <div className="grid grid-cols-4 gap-3">
              {SEVERITY_ORDER.map((sev) => (
                <SummaryTile key={sev} sev={sev} count={report.summary[sev]} />
              ))}
            </div>

            {/* SEO score */}
            <div className={clsx('flex items-center gap-3 rounded-xl border px-4 py-3', seoG.bg)}>
              <div className="flex items-baseline gap-1 flex-shrink-0">
                <span className={clsx('text-2xl font-bold leading-none', seoG.color)}>{seoAudit.score}</span>
                <span className="text-[10px] text-ink-faded">/100</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className={clsx('text-sm font-semibold', seoG.color)}>SEO Score</span>
                <span className={clsx('text-xs', seoG.color)}>— {seoG.label}</span>
              </div>
              <div className="flex gap-2.5 text-[11px] ml-1">
                {seoProblems > 0 && <span className="text-red-500">{seoProblems} problem{seoProblems !== 1 ? 's' : ''}</span>}
                {seoImprove  > 0 && <span className="text-amber-500">{seoImprove} improvement{seoImprove !== 1 ? 's' : ''}</span>}
                {seoGood     > 0 && <span className="text-green-600">{seoGood} good</span>}
              </div>
              <div className="flex-1" />
              <button
                onClick={() => setActiveScreen('seo' as ScreenId)}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-line-soft bg-white/60 hover:bg-white transition-colors text-ink-soft hover:text-ink"
              >
                <ExternalLink size={11} /> Edit SEO
              </button>
            </div>

            <div className="flex items-center gap-4 text-xs text-ink-faded">
              <span>Last audit: {new Date(report.generatedAt).toLocaleTimeString()}</span>
              {report.aiUsed
                ? <span>AI checks: last run just now{estimatedCost ? ` (~$${estimatedCost})` : ''}</span>
                : <span>AI checks: not run</span>}
            </div>
          </>
        )}

        {/* ── Filters ────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          {(['all', ...SEVERITY_ORDER] as const).map((sev) => (
            <button
              key={sev}
              onClick={() => { setSeverityFilter(sev); setShowDismissed(false); }}
              className={clsx(
                'text-xs px-2.5 py-1 rounded-full border transition-colors',
                severityFilter === sev && !showDismissed
                  ? 'bg-ink text-paper border-ink'
                  : 'border-line-soft text-ink-soft hover:border-line-strong'
              )}
            >
              {sev === 'all' ? 'All' : SEV_CONFIG[sev].label + 's'}
              {sev !== 'all' && report ? ` (${report.summary[sev]})` : ''}
            </button>
          ))}

          <div className="relative ml-auto">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as AuditCategory | 'all')}
              className="text-xs pl-2.5 pr-7 py-1 rounded-full border border-line-soft bg-paper text-ink-soft appearance-none focus:outline-none focus:border-accent"
            >
              <option value="all">All categories</option>
              {availableCategories.map((c) => (
                <option key={c} value={c}>{CAT_LABELS[c]}</option>
              ))}
            </select>
            <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faded pointer-events-none" />
          </div>

          {report?.aiUsed && (
            <label className="flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer">
              <input
                type="checkbox"
                checked={showAiOnly}
                onChange={(e) => setShowAiOnly(e.target.checked)}
                className="w-3 h-3 accent-accent"
              />
              AI only
            </label>
          )}

          <button
            onClick={() => { setShowDismissed((v) => !v); setSeverityFilter('all'); }}
            className={clsx(
              'text-xs px-2.5 py-1 rounded-full border transition-colors',
              showDismissed
                ? 'bg-ink text-paper border-ink'
                : 'border-line-soft text-ink-soft hover:border-line-strong'
            )}
          >
            Dismissed ({dismissed.size})
          </button>
        </div>

        {/* ── Issue list ─────────────────────────────────────────────────── */}
        {!report && (
          <div className="flex items-center gap-2 text-sm text-ink-faded">
            <Loader2 size={14} className="animate-spin" /> Running checks…
          </div>
        )}

        {report && visibleIssues.length === 0 && !showDismissed && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-700 flex items-center gap-3">
            <Check size={16} className="text-green-500" />
            {severityFilter === 'all' && categoryFilter === 'all' && !showAiOnly
              ? 'All clear — no issues found. Ready to compile!'
              : 'No issues match the current filter.'}
          </div>
        )}

        {groupedIssues.map(({ sev, issues: items }) => {
          const { icon: SevIcon, iconColor } = SEV_CONFIG[sev];
          return (
            <div key={sev} className="space-y-2">
              <div className="flex items-center gap-2">
                <SevIcon size={13} className={iconColor} />
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-faded">
                  {SEV_CONFIG[sev].label}s — {items.length}
                </span>
              </div>
              {items.map((issue) => {
                const targetScene = issue.targetEntityId && issue.targetEntityType === 'scene'
                  ? project.scenes.find((s) => s.id === issue.targetEntityId)
                  : undefined;
                const sceneName = targetScene
                  ? (targetScene.title?.[defaultLang] || targetScene.slug)
                  : undefined;
                return (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    sceneName={sceneName}
                    dismissed={dismissed.has(issue.id)}
                    onNavigate={issue.targetScreen ? () => handleNavigate(issue) : undefined}
                    onApply={issue.fixable ? () => handleApply(issue) : undefined}
                    onDismiss={() => handleDismiss(issue.id)}
                    onRestore={() => setDismissed((prev) => { const n = new Set(prev); n.delete(issue.id); return n; })}
                  />
                );
              })}
            </div>
          );
        })}

      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-xs px-4 py-2 rounded-full shadow-lg z-50 pointer-events-none">
          {toast}
        </div>
      )}
      {upgradeFeature && <UpgradeModal feature={upgradeFeature} onClose={() => setUpgradeFeature(null)} />}
    </ScreenShell>
  );
}

// ── Issue Card ────────────────────────────────────────────────────────────────

interface IssueCardProps {
  issue: AuditIssue;
  sceneName?: string;
  dismissed: boolean;
  onNavigate?: () => void;
  onApply?: () => void;
  onDismiss: () => void;
  onRestore: () => void;
}

function IssueCard({ issue, sceneName, dismissed, onNavigate, onApply, onDismiss, onRestore }: IssueCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { bg } = SEV_CONFIG[issue.severity];

  return (
    <div className={clsx(
      'rounded-xl border p-4 transition-opacity',
      bg,
      dismissed && 'opacity-40'
    )}>
      <div className="flex items-start gap-2 flex-wrap">
        <SeverityBadge sev={issue.severity} />
        <CategoryBadge cat={issue.category} />
        {sceneName && (
          <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700 max-w-[180px] truncate" title={sceneName}>
            {sceneName}
          </span>
        )}
        {issue.aiGenerated && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-purple-50 border-purple-200 text-purple-700">
            <Sparkles size={9} /> AI
          </span>
        )}
      </div>

      <p className="mt-2 text-sm font-medium text-ink leading-snug">{issue.title}</p>
      <p className="mt-1 text-xs text-ink-soft leading-relaxed">{issue.description}</p>

      {issue.aiGenerated && issue.suggestion && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-accent font-medium"
          >
            <ChevronDown size={12} className={clsx('transition-transform', expanded && 'rotate-180')} />
            {expanded ? 'Hide suggestion' : 'View AI suggestion'}
          </button>
          {expanded && (
            <div className="mt-2 bg-white/60 border border-white/80 rounded-lg px-3 py-2 text-xs text-ink italic leading-relaxed">
              {issue.suggestion}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {!dismissed && (
          <>
            {onNavigate && (
              <button onClick={onNavigate} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-line-soft bg-white/70 hover:bg-white transition-colors">
                <ExternalLink size={11} /> Open
              </button>
            )}
            {onApply && (
              <button onClick={onApply} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors font-medium">
                <Check size={11} /> Apply fix
              </button>
            )}
            <button onClick={onDismiss} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-line-soft bg-white/40 text-ink-faded hover:bg-white/70 transition-colors ml-auto">
              <X size={11} /> Dismiss
            </button>
          </>
        )}
        {dismissed && (
          <button onClick={onRestore} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-line-soft bg-white/40 text-ink-faded hover:bg-white/70 transition-colors">
            <RefreshCw size={11} /> Restore
          </button>
        )}
      </div>
    </div>
  );
}
