import { useState } from 'react';
import {
  Sparkles, Bot, CheckCircle, AlertCircle, Loader2,
  RotateCcw, Brain, ChevronDown, AlertTriangle,
} from 'lucide-react';
import clsx from 'clsx';
import { useProject } from '@/store/project';
import { useLicense } from '@/store/license';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { testAiConnection, testOpenAIConnection } from '@/lib/audit/ai-checks';
import { AI_THEMES, AI_TONE_LABELS, AI_AUDIENCE_LABELS, AI_LENGTH_LABELS } from '@/lib/ai-themes';
import { resolveAiProvider } from '@/lib/ai-resolve';
import { ProjectContextInterviewModal } from '@/screens/ai/ProjectContextInterviewModal';
import { modelsForProvider } from '@/lib/ai-models';
import { computeAiCost } from '@/lib/ai-tracking';
import { formatCurrency, detectDefaultCurrency, SUPPORTED_CURRENCIES, type Currency } from '@/lib/currency';
import type { AiContext, AiUsageTotals } from '@/types';

const inputCls =
  'w-full bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink placeholder-ink-faded font-mono focus:outline-none focus:border-accent';

const selectCls =
  'bg-paper-strong border border-line-soft rounded px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:border-accent';

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function UsageLine({ totals, modelId, currency }: { totals: AiUsageTotals; modelId: string; currency: Currency }) {
  const total = totals.inputTokens + totals.outputTokens;
  if (total === 0) return <p className="text-[11px] text-ink-faded">No usage yet.</p>;
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-ink-faded">
      <Brain size={10} className="shrink-0" />
      <span className="flex-1">
        {fmt(totals.inputTokens)} in / {fmt(totals.outputTokens)} out · <strong className="text-ink">{formatCurrency(totals.costUsd, currency)}</strong>
      </span>
      <span className="text-[10px] opacity-60 font-mono">{modelId.split('-').slice(0, 3).join('-')}</span>
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Record<string, string> | readonly string[];
}) {
  const entries: [string, string][] = Array.isArray(options)
    ? options.map((v) => [v, v])
    : Object.entries(options);
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wide text-ink-faded font-semibold block mb-0.5">{label}</label>
      <div className="relative">
        <select
          className={selectCls + ' w-full appearance-none pr-6'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {entries.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faded pointer-events-none" />
      </div>
    </div>
  );
}

type TestState = 'idle' | 'testing' | 'ok' | 'error';

function TestButton({ state, disabled, onClick }: { state: TestState; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || state === 'testing'}
      title={state === 'error' ? 'Connection failed — check your key' : undefined}
      className={clsx(
        'btn shrink-0 text-xs px-2.5 disabled:opacity-40 transition-colors',
        state === 'ok'    && 'text-green-600 border-green-200 bg-green-50',
        state === 'error' && 'text-red-500 border-red-200 bg-red-50',
      )}
    >
      {state === 'testing' ? <Loader2 size={12} className="animate-spin" />
        : state === 'ok'   ? <CheckCircle size={12} />
        : state === 'error' ? <AlertCircle size={12} />
        : 'Test'}
    </button>
  );
}

export function AIScreen() {
  const { project, updateModules, updateAiContext, recordAiUsage, resetAiUsage, updateUiPreferences } = useProject();
  const { status: licenseStatus } = useLicense();
  const licenseExpired = licenseStatus === 'expired';
  const m  = project.modules;
  const ai = project.aiContext ?? { tone: 'marketing' as const, audience: 'general' as const, theme: 'Tourism', length: 'medium' as const };

  const provider   = m.aiProvider ?? 'claude';
  const resolvedAi = resolveAiProvider(m);

  const currency: Currency = (project.uiPreferences?.currency ?? detectDefaultCurrency()) as Currency;

  const aiUsage = project.aiUsage ?? {
    records: [],
    totals: { anthropic: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, openai: { inputTokens: 0, outputTokens: 0, costUsd: 0 } },
  };

  const claudeModel = m.claudeModel ?? 'claude-sonnet-4-6';
  const openaiModel = m.openaiModel ?? 'gpt-4o';

  const [claudeKeyDraft, setClaudeKeyDraft] = useState(m.anthropicApiKey ?? '');
  const [gptKeyDraft,    setGptKeyDraft]    = useState(m.openaiApiKey ?? '');
  const [contextDraft,   setContextDraft]   = useState(ai.projectContext ?? '');
  const [showInterview,  setShowInterview]  = useState(false);

  const [claudeTest, setClaudeTest] = useState<TestState>('idle');
  const [claudeMsg,  setClaudeMsg]  = useState('');
  const [gptTest,    setGptTest]    = useState<TestState>('idle');
  const [gptMsg,     setGptMsg]     = useState('');

  async function autoSaveModules(patch: Parameters<typeof updateModules>[0]) {
    updateModules(patch);
    try {
      const dir = await window.conchitour.getProjectDir();
      if (dir) await window.conchitour.saveProject(useProject.getState().project);
    } catch { /* non-fatal */ }
  }

  async function autoSaveAiContext(patch: Partial<AiContext>) {
    updateAiContext(patch);
    try {
      const dir = await window.conchitour.getProjectDir();
      if (dir) await window.conchitour.saveProject(useProject.getState().project);
    } catch { /* non-fatal */ }
  }

  async function handleTestClaude() {
    const key = claudeKeyDraft.trim();
    if (!key) return;
    setClaudeTest('testing'); setClaudeMsg('');
    const r = await testAiConnection(key);
    setClaudeTest(r.ok ? 'ok' : 'error');
    setClaudeMsg(r.error ?? '');
    if (r.ok) setTimeout(() => setClaudeTest('idle'), 3000);
  }

  async function handleTestGpt() {
    const key = gptKeyDraft.trim();
    if (!key) return;
    setGptTest('testing'); setGptMsg('');
    const r = await testOpenAIConnection(key);
    setGptTest(r.ok ? 'ok' : 'error');
    setGptMsg(r.error ?? '');
    if (r.ok) setTimeout(() => setGptTest('idle'), 3000);
  }

  function handleResetAll() {
    if (!window.confirm('Reset all AI usage counters? This cannot be undone.')) return;
    resetAiUsage();
  }

  const claudeModels = modelsForProvider('anthropic');
  const openaiModels = modelsForProvider('openai');

  return (
    <ScreenShell title="AI" subtitle="Configure AI providers, model selection, and editorial context.">
      {licenseExpired && (
        <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 max-w-6xl mx-auto">
          <AlertTriangle size={15} className="text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-800 flex-1">License expired. AI features are disabled.</p>
          <button
            onClick={() => window.conchitour.openUrl('https://conchitour.com')}
            className="text-xs font-medium text-amber-700 hover:text-amber-900 underline whitespace-nowrap"
          >
            Renew now
          </button>
        </div>
      )}
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── LEFT — Active provider ──────────────────────────────────────── */}
          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-ink-faded font-semibold">Active provider</p>

            {/* Segmented control */}
            <div className="flex p-0.5 rounded-lg bg-paper-strong border border-line-soft gap-0.5">
              <button
                onClick={() => autoSaveModules({ aiProvider: 'claude' })}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded transition-all',
                  provider === 'claude' ? 'bg-paper shadow-sm text-ink-strong' : 'text-ink-faded hover:text-ink',
                )}
              >
                <Sparkles size={12} className={provider === 'claude' ? 'text-accent' : ''} />
                Claude
              </button>
              <button
                onClick={() => autoSaveModules({ aiProvider: 'gpt' })}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded transition-all',
                  provider === 'gpt' ? 'bg-paper shadow-sm text-ink-strong' : 'text-ink-faded hover:text-ink',
                )}
              >
                <Bot size={12} className={provider === 'gpt' ? 'text-accent' : ''} />
                ChatGPT
              </button>
            </div>

            {/* Active provider config card */}
            <div className="rounded-xl border border-line-soft bg-paper-tinted p-4 space-y-3">

              {/* Claude */}
              {provider === 'claude' && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Sparkles size={12} className="text-accent" />
                      <span className="text-xs font-semibold text-ink">Claude (Anthropic)</span>
                    </div>
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); window.conchitour.openUrl('https://console.anthropic.com'); }}
                      className="text-[11px] text-accent underline"
                    >
                      Get key ↗
                    </a>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="password"
                      className={inputCls + ' flex-1'}
                      value={claudeKeyDraft}
                      placeholder="sk-ant-api03-…"
                      onChange={(e) => { setClaudeKeyDraft(e.target.value); setClaudeTest('idle'); }}
                      onBlur={() => autoSaveModules({ anthropicApiKey: claudeKeyDraft.trim() || undefined })}
                    />
                    <TestButton state={claudeTest} disabled={!claudeKeyDraft.trim()} onClick={handleTestClaude} />
                  </div>
                  {claudeTest === 'error' && (
                    <p className="text-[11px] text-red-500 -mt-1">{claudeMsg || 'Connection failed. Check your key.'}</p>
                  )}

                  <div className="relative">
                    <select
                      className={selectCls + ' w-full appearance-none pr-6'}
                      value={claudeModel}
                      onChange={(e) => autoSaveModules({ claudeModel: e.target.value })}
                    >
                      {claudeModels.map((mo) => (
                        <option key={mo.id} value={mo.id}>{mo.label}{mo.recommended ? ' ★' : ''}</option>
                      ))}
                    </select>
                    <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faded pointer-events-none" />
                  </div>

                  <UsageLine totals={aiUsage.totals.anthropic} modelId={claudeModel} currency={currency} />
                </>
              )}

              {/* ChatGPT */}
              {provider === 'gpt' && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Bot size={12} className="text-ink" />
                      <span className="text-xs font-semibold text-ink">ChatGPT (OpenAI)</span>
                    </div>
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); window.conchitour.openUrl('https://platform.openai.com/api-keys'); }}
                      className="text-[11px] text-accent underline"
                    >
                      Get key ↗
                    </a>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="password"
                      className={inputCls + ' flex-1'}
                      value={gptKeyDraft}
                      placeholder="sk-proj-…"
                      onChange={(e) => { setGptKeyDraft(e.target.value); setGptTest('idle'); }}
                      onBlur={() => autoSaveModules({ openaiApiKey: gptKeyDraft.trim() || undefined })}
                    />
                    <TestButton state={gptTest} disabled={!gptKeyDraft.trim()} onClick={handleTestGpt} />
                  </div>
                  {gptTest === 'error' && (
                    <p className="text-[11px] text-red-500 -mt-1">{gptMsg || 'Connection failed. Check your key.'}</p>
                  )}

                  <div className="relative">
                    <select
                      className={selectCls + ' w-full appearance-none pr-6'}
                      value={openaiModel}
                      onChange={(e) => autoSaveModules({ openaiModel: e.target.value })}
                    >
                      {openaiModels.map((mo) => (
                        <option key={mo.id} value={mo.id}>{mo.label}{mo.recommended ? ' ★' : ''}</option>
                      ))}
                    </select>
                    <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faded pointer-events-none" />
                  </div>

                  <UsageLine totals={aiUsage.totals.openai} modelId={openaiModel} currency={currency} />
                </>
              )}

              {/* Currency + reset — always visible */}
              <div className="flex items-center gap-2 pt-2 border-t border-line-soft">
                <label className="text-[11px] text-ink-faded shrink-0">Currency</label>
                <div className="relative">
                  <select
                    className={selectCls + ' appearance-none pr-5 text-[11px] py-1'}
                    value={currency}
                    onChange={(e) => updateUiPreferences({ currency: e.target.value as Currency })}
                  >
                    {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <ChevronDown size={9} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-faded pointer-events-none" />
                </div>
                <button
                  onClick={handleResetAll}
                  className="ml-auto flex items-center gap-1 text-[11px] text-ink-faded hover:text-ink transition-colors"
                >
                  <RotateCcw size={10} /> Reset counters
                </button>
              </div>
            </div>
          </div>

          {/* ── RIGHT — Project context ─────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-widest text-ink-faded font-semibold">Project context</p>
              <button
                onClick={() => setShowInterview(true)}
                disabled={!resolvedAi}
                title={!resolvedAi ? 'Configure an AI key first' : 'Let the AI generate a context from your project'}
                className="btn gap-1.5 text-xs py-1 disabled:opacity-40"
              >
                <Sparkles size={11} /> Generate
              </button>
            </div>

            <div className="rounded-xl border border-line-soft bg-paper-tinted p-4 space-y-3">
              {/* 4-col selects */}
              <div className="grid grid-cols-4 gap-2">
                <SelectField
                  label="Tone"
                  value={ai.tone}
                  onChange={(v) => autoSaveAiContext({ tone: v as AiContext['tone'] })}
                  options={AI_TONE_LABELS}
                />
                <SelectField
                  label="Audience"
                  value={ai.audience}
                  onChange={(v) => autoSaveAiContext({ audience: v as AiContext['audience'] })}
                  options={AI_AUDIENCE_LABELS}
                />
                <SelectField
                  label="Theme"
                  value={ai.theme ?? 'Tourism'}
                  onChange={(v) => autoSaveAiContext({ theme: v })}
                  options={AI_THEMES}
                />
                <SelectField
                  label="Length"
                  value={ai.length}
                  onChange={(v) => autoSaveAiContext({ length: v as AiContext['length'] })}
                  options={AI_LENGTH_LABELS}
                />
              </div>

              {/* Custom context textarea */}
              <div>
                <label className="text-[10px] uppercase tracking-wide text-ink-faded font-semibold block mb-1">Custom context</label>
                <textarea
                  rows={5}
                  className="w-full bg-paper border border-line-soft rounded px-3 py-2 text-sm text-ink placeholder-ink-faded focus:outline-none focus:border-accent resize-none leading-relaxed"
                  placeholder={`Example: You are writing for the Hossegor tourist office. Showcase local culture and surfing. Warm tone for French and international visitors.`}
                  value={contextDraft}
                  onChange={(e) => setContextDraft(e.target.value)}
                  onBlur={() => autoSaveAiContext({ projectContext: contextDraft })}
                />
              </div>
            </div>
          </div>

        </div>
      </div>

      {showInterview && resolvedAi && (
        <ProjectContextInterviewModal
          ai={{ ...resolvedAi, modelId: resolvedAi.provider === 'gpt' ? openaiModel : claudeModel }}
          project={project}
          onApply={(ctx, tokensIn, tokensOut) => {
            setContextDraft(ctx);
            autoSaveAiContext({ projectContext: ctx });
            recordAiUsage({
              provider: resolvedAi.provider === 'gpt' ? 'openai' : 'anthropic',
              modelId: resolvedAi.provider === 'gpt' ? openaiModel : claudeModel,
              inputTokens: tokensIn,
              outputTokens: tokensOut,
              costUsd: computeAiCost(resolvedAi.provider === 'gpt' ? openaiModel : claudeModel, tokensIn, tokensOut),
              operation: 'interview',
            });
            setShowInterview(false);
          }}
          onClose={() => setShowInterview(false)}
        />
      )}
    </ScreenShell>
  );
}
