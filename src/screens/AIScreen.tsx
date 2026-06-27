import { useState } from 'react';
import {
  Sparkles, Bot, CheckCircle, AlertCircle, Loader2,
  RotateCcw, Brain, ChevronDown,
} from 'lucide-react';
import clsx from 'clsx';
import { useProject } from '@/store/project';
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
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

interface UsageLineProps {
  totals: AiUsageTotals;
  modelId: string;
  currency: Currency;
}

function UsageLine({ totals, modelId, currency }: UsageLineProps) {
  const total = totals.inputTokens + totals.outputTokens;
  const costStr = formatCurrency(totals.costUsd, currency);

  if (total === 0) {
    return <p className="text-[11px] text-ink-faded">No usage recorded yet.</p>;
  }

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-ink-faded">
      <Brain size={11} className="shrink-0" />
      <span className="flex-1">
        {fmt(totals.inputTokens)} in / {fmt(totals.outputTokens)} out · <strong className="text-ink">{costStr}</strong>
      </span>
      <span className="text-[10px] opacity-60">{modelId.split('-').slice(0, 3).join('-')}</span>
    </div>
  );
}

export function AIScreen() {
  const { project, updateModules, updateAiContext, recordAiUsage, resetAiUsage, updateUiPreferences } = useProject();
  const m = project.modules;
  const ai = project.aiContext ?? { tone: 'marketing' as const, audience: 'general' as const, theme: 'Tourism', length: 'medium' as const };

  const provider = m.aiProvider ?? 'claude';
  const resolvedAi = resolveAiProvider(m);

  const currency: Currency = (project.uiPreferences?.currency ?? detectDefaultCurrency()) as Currency;

  const aiUsage = project.aiUsage ?? {
    records: [],
    totals: { anthropic: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, openai: { inputTokens: 0, outputTokens: 0, costUsd: 0 } },
  };

  const claudeModel = m.claudeModel ?? 'claude-sonnet-4-6';
  const openaiModel = m.openaiModel ?? 'gpt-4o';

  // Local draft states for key inputs (auto-save on blur)
  const [claudeKeyDraft, setClaudeKeyDraft] = useState(m.anthropicApiKey ?? '');
  const [gptKeyDraft, setGptKeyDraft]       = useState(m.openaiApiKey ?? '');
  const [contextDraft, setContextDraft]     = useState(ai.projectContext ?? '');
  const [showInterview, setShowInterview]   = useState(false);

  // Test connection state — one per provider
  const [claudeTestState, setClaudeTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [claudeTestMsg, setClaudeTestMsg]     = useState('');
  const [gptTestState, setGptTestState]       = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [gptTestMsg, setGptTestMsg]           = useState('');

  async function autoSaveModules(patch: Parameters<typeof updateModules>[0]) {
    updateModules(patch);
    try {
      const dir = await window.conchitect.getProjectDir();
      if (dir) await window.conchitect.saveProject(useProject.getState().project);
    } catch { /* non-fatal */ }
  }

  async function autoSaveAiContext(patch: Partial<AiContext>) {
    updateAiContext(patch);
    try {
      const dir = await window.conchitect.getProjectDir();
      if (dir) await window.conchitect.saveProject(useProject.getState().project);
    } catch { /* non-fatal */ }
  }

  async function handleTestClaude() {
    const key = claudeKeyDraft.trim();
    if (!key) return;
    setClaudeTestState('testing');
    setClaudeTestMsg('');
    const result = await testAiConnection(key);
    setClaudeTestState(result.ok ? 'ok' : 'error');
    setClaudeTestMsg(result.error ?? '');
  }

  async function handleTestGpt() {
    const key = gptKeyDraft.trim();
    if (!key) return;
    setGptTestState('testing');
    setGptTestMsg('');
    const result = await testOpenAIConnection(key);
    setGptTestState(result.ok ? 'ok' : 'error');
    setGptTestMsg(result.error ?? '');
  }

  function handleResetAll() {
    if (!window.confirm('Reset all AI usage counters? This cannot be undone.')) return;
    resetAiUsage();
  }

  const claudeModels  = modelsForProvider('anthropic');
  const openaiModels  = modelsForProvider('openai');

  return (
    <ScreenShell title="AI" subtitle="Configure AI providers, model selection, and editorial context.">
      <div className="max-w-xl space-y-5">

        {/* ── Active provider segmented control ─────────────────────────────── */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink-faded font-semibold mb-2">Active provider</p>
          <div className="flex p-0.5 rounded-lg bg-paper-strong border border-line-soft gap-0.5">
            <button
              onClick={() => autoSaveModules({ aiProvider: 'claude' })}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded transition-all',
                provider === 'claude'
                  ? 'bg-paper shadow-sm text-ink-strong'
                  : 'text-ink-faded hover:text-ink'
              )}
            >
              <Sparkles size={12} className={provider === 'claude' ? 'text-accent' : ''} />
              Claude
            </button>
            <button
              onClick={() => autoSaveModules({ aiProvider: 'gpt' })}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded transition-all',
                provider === 'gpt'
                  ? 'bg-paper shadow-sm text-ink-strong'
                  : 'text-ink-faded hover:text-ink'
              )}
            >
              <Bot size={12} className={provider === 'gpt' ? 'text-accent' : ''} />
              ChatGPT
            </button>
          </div>
        </div>

        {/* ── Provider settings card ────────────────────────────────────────── */}
        <div className="rounded-xl border border-line-soft bg-paper-tinted p-4 space-y-4">

          {/* Claude section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles size={13} className="text-accent shrink-0" />
              <span className="text-xs font-semibold text-ink">Claude (Anthropic)</span>
              {provider === 'claude' && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-accent bg-accent/10 rounded-full px-1.5 py-0.5">Active</span>
              )}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); window.conchitect.openUrl('https://console.anthropic.com'); }}
                className="ml-auto text-[11px] text-accent underline"
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
                onChange={(e) => { setClaudeKeyDraft(e.target.value); setClaudeTestState('idle'); }}
                onBlur={() => autoSaveModules({ anthropicApiKey: claudeKeyDraft.trim() || undefined })}
              />
              <button
                onClick={handleTestClaude}
                disabled={!claudeKeyDraft.trim() || claudeTestState === 'testing'}
                className={clsx('btn shrink-0 text-xs disabled:opacity-50', claudeTestState === 'ok' && 'text-green-600', claudeTestState === 'error' && 'text-red-500')}
              >
                {claudeTestState === 'testing' ? <Loader2 size={12} className="animate-spin" />
                  : claudeTestState === 'ok' ? <CheckCircle size={12} />
                  : claudeTestState === 'error' ? <AlertCircle size={12} />
                  : 'Test'}
              </button>
            </div>

            {claudeTestState === 'error' && (
              <p className="text-[11px] text-red-500">{claudeTestMsg || 'Connection failed. Check your key.'}</p>
            )}

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <select
                  className={selectCls + ' w-full appearance-none pr-6'}
                  value={claudeModel}
                  onChange={(e) => autoSaveModules({ claudeModel: e.target.value })}
                >
                  {claudeModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}{m.recommended ? ' ★' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faded pointer-events-none" />
              </div>
            </div>

            <UsageLine totals={aiUsage.totals.anthropic} modelId={claudeModel} currency={currency} />
          </div>

          <div className="border-t border-line-soft" />

          {/* GPT section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Bot size={13} className="text-ink shrink-0" />
              <span className="text-xs font-semibold text-ink">ChatGPT (OpenAI)</span>
              {provider === 'gpt' && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-accent bg-accent/10 rounded-full px-1.5 py-0.5">Active</span>
              )}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); window.conchitect.openUrl('https://platform.openai.com/api-keys'); }}
                className="ml-auto text-[11px] text-accent underline"
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
                onChange={(e) => { setGptKeyDraft(e.target.value); setGptTestState('idle'); }}
                onBlur={() => autoSaveModules({ openaiApiKey: gptKeyDraft.trim() || undefined })}
              />
              <button
                onClick={handleTestGpt}
                disabled={!gptKeyDraft.trim() || gptTestState === 'testing'}
                className={clsx('btn shrink-0 text-xs disabled:opacity-50', gptTestState === 'ok' && 'text-green-600', gptTestState === 'error' && 'text-red-500')}
              >
                {gptTestState === 'testing' ? <Loader2 size={12} className="animate-spin" />
                  : gptTestState === 'ok' ? <CheckCircle size={12} />
                  : gptTestState === 'error' ? <AlertCircle size={12} />
                  : 'Test'}
              </button>
            </div>

            {gptTestState === 'error' && (
              <p className="text-[11px] text-red-500">{gptTestMsg || 'Connection failed. Check your key.'}</p>
            )}

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <select
                  className={selectCls + ' w-full appearance-none pr-6'}
                  value={openaiModel}
                  onChange={(e) => autoSaveModules({ openaiModel: e.target.value })}
                >
                  {openaiModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}{m.recommended ? ' ★' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faded pointer-events-none" />
              </div>
            </div>

            <UsageLine totals={aiUsage.totals.openai} modelId={openaiModel} currency={currency} />
          </div>

          <div className="border-t border-line-soft pt-2 flex items-center gap-3 flex-wrap">
            <label className="text-[11px] text-ink-faded shrink-0">Currency</label>
            <div className="relative">
              <select
                className={selectCls + ' appearance-none pr-6'}
                value={currency}
                onChange={(e) => updateUiPreferences({ currency: e.target.value as Currency })}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-faded pointer-events-none" />
            </div>
            <button
              onClick={handleResetAll}
              className="ml-auto flex items-center gap-1 text-[11px] text-ink-faded hover:text-ink transition-colors"
            >
              <RotateCcw size={10} /> Reset counters
            </button>
          </div>
        </div>

        {/* ── Project context card ──────────────────────────────────────────── */}
        <div className="rounded-xl border border-line-soft bg-paper-tinted p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h2 className="text-xs font-semibold text-ink">Project context</h2>
              <p className="text-[11px] text-ink-faded mt-0.5">
                Sent with every AI request to anchor the editorial voice.
              </p>
            </div>
            <button
              onClick={() => setShowInterview(true)}
              disabled={!resolvedAi}
              title={!resolvedAi ? 'Configure an AI key above to use this feature' : 'Let the AI interview you and write the context'}
              className="btn gap-1.5 shrink-0 text-xs disabled:opacity-40"
            >
              <Sparkles size={12} />
              Generate
            </button>
          </div>

          <textarea
            rows={5}
            className="w-full bg-paper-strong border border-line-soft rounded px-3 py-2 text-sm text-ink placeholder-ink-faded focus:outline-none focus:border-accent resize-none leading-relaxed"
            placeholder={`Example:\nYou are writing for the Hossegor tourist office. The goal is to showcase local culture and activities (surfing, architecture, nature). Tone: warm and welcoming, aimed at French and international visitors.`}
            value={contextDraft}
            onChange={(e) => setContextDraft(e.target.value)}
            onBlur={() => autoSaveAiContext({ projectContext: contextDraft })}
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium">Tone</label>
              <div className="relative">
                <select
                  className={selectCls + ' w-full appearance-none pr-6'}
                  value={ai.tone}
                  onChange={(e) => autoSaveAiContext({ tone: e.target.value as AiContext['tone'] })}
                >
                  {Object.entries(AI_TONE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faded pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium">Audience</label>
              <div className="relative">
                <select
                  className={selectCls + ' w-full appearance-none pr-6'}
                  value={ai.audience}
                  onChange={(e) => autoSaveAiContext({ audience: e.target.value as AiContext['audience'] })}
                >
                  {Object.entries(AI_AUDIENCE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faded pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium">Theme</label>
              <div className="relative">
                <select
                  className={selectCls + ' w-full appearance-none pr-6'}
                  value={ai.theme}
                  onChange={(e) => autoSaveAiContext({ theme: e.target.value })}
                >
                  {AI_THEMES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faded pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium">Length</label>
              <div className="relative">
                <select
                  className={selectCls + ' w-full appearance-none pr-6'}
                  value={ai.length}
                  onChange={(e) => autoSaveAiContext({ length: e.target.value as AiContext['length'] })}
                >
                  {Object.entries(AI_LENGTH_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faded pointer-events-none" />
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
