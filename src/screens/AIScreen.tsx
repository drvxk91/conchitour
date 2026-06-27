import { useState } from 'react';
import {
  Sparkles, Bot, CheckCircle, AlertCircle, Loader2,
  RotateCcw, Brain,
} from 'lucide-react';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { testAiConnection, testOpenAIConnection } from '@/lib/audit/ai-checks';
import { AI_THEMES, AI_TONE_LABELS, AI_AUDIENCE_LABELS, AI_LENGTH_LABELS } from '@/lib/ai-themes';
import type { AiContext } from '@/types';

const inputCls =
  'w-full bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink placeholder-ink-faded font-mono focus:outline-none focus:border-accent';

const selectCls =
  'w-full bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-accent';

function fmt(n: number) {
  return n.toLocaleString('en-US');
}

function claudeCost(input: number, output: number): string {
  const dollars = (input * 3 + output * 15) / 1_000_000;
  if (dollars < 0.01) return '< $0.01';
  return `≈ $${dollars.toFixed(2)}`;
}

export function AIScreen() {
  const { project, updateModules, updateAiContext, addAiTokens } = useProject();
  const m = project.modules;
  const ai = project.aiContext ?? { tone: 'marketing' as const, audience: 'general' as const, theme: 'Tourism', length: 'medium' as const };
  const tokensUsed = ai.tokensUsed ?? { claude: { in: 0, out: 0 }, gpt: { in: 0, out: 0 } };

  const provider = m.aiProvider ?? 'claude';

  // Local draft states for key inputs (auto-save on blur)
  const [claudeKeyDraft, setClaudeKeyDraft] = useState(m.anthropicApiKey ?? '');
  const [gptKeyDraft, setGptKeyDraft]       = useState(m.openaiApiKey ?? '');
  const [contextDraft, setContextDraft]     = useState(ai.projectContext ?? '');

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

  function handleResetTokens(p: 'claude' | 'gpt') {
    if (!window.confirm(`Reset ${p === 'claude' ? 'Claude' : 'GPT'} token counter to zero?`)) return;
    addAiTokens(p, -(tokensUsed[p]?.in ?? 0), -(tokensUsed[p]?.out ?? 0));
  }

  const claudeIn  = tokensUsed.claude?.in ?? 0;
  const claudeOut = tokensUsed.claude?.out ?? 0;
  const gptIn     = tokensUsed.gpt?.in ?? 0;
  const gptOut    = tokensUsed.gpt?.out ?? 0;

  return (
    <ScreenShell title="AI" subtitle="Configure your AI provider, API keys, and editorial context.">
      <div className="max-w-xl space-y-8">

        {/* ── Provider switch ─────────────────────────────────────────────── */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-faded mb-3">Active provider</h2>
          <div className="grid grid-cols-2 gap-3">

            {/* Claude card */}
            <button
              onClick={() => autoSaveModules({ aiProvider: 'claude' })}
              className={`rounded-xl border-2 p-4 text-left transition-all ${
                provider === 'claude'
                  ? 'border-accent bg-accent/5'
                  : 'border-line-soft bg-paper-tinted hover:border-line-strong'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Sparkles size={16} className={provider === 'claude' ? 'text-accent' : 'text-ink-faded'} />
                <span className={`text-sm font-semibold ${provider === 'claude' ? 'text-accent' : 'text-ink'}`}>Claude</span>
                {provider === 'claude' && (
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-accent bg-accent/10 rounded-full px-2 py-0.5">Active</span>
                )}
              </div>
              <p className="text-xs text-ink-faded">Anthropic — Sonnet 4.5</p>
            </button>

            {/* GPT card */}
            <button
              onClick={() => autoSaveModules({ aiProvider: 'gpt' })}
              className={`rounded-xl border-2 p-4 text-left transition-all ${
                provider === 'gpt'
                  ? 'border-accent bg-accent/5'
                  : 'border-line-soft bg-paper-tinted hover:border-line-strong'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Bot size={16} className={provider === 'gpt' ? 'text-accent' : 'text-ink-faded'} />
                <span className={`text-sm font-semibold ${provider === 'gpt' ? 'text-accent' : 'text-ink'}`}>ChatGPT</span>
                {provider === 'gpt' && (
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-accent bg-accent/10 rounded-full px-2 py-0.5">Active</span>
                )}
              </div>
              <p className="text-xs text-ink-faded">OpenAI — GPT-4o</p>
            </button>
          </div>
        </div>

        {/* ── Claude key ──────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-line-soft bg-paper-tinted p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent" />
            <span className="text-sm font-semibold text-ink">Claude (Anthropic)</span>
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
              className="btn shrink-0 disabled:opacity-50"
            >
              {claudeTestState === 'testing' ? <Loader2 size={13} className="animate-spin" /> : 'Test'}
            </button>
          </div>

          {claudeTestState === 'ok' && (
            <p className="text-[11px] text-green-600 flex items-center gap-1">
              <CheckCircle size={11} /> Connected — API key valid.
            </p>
          )}
          {claudeTestState === 'error' && (
            <p className="text-[11px] text-red-500 flex items-center gap-1">
              <AlertCircle size={11} /> {claudeTestMsg || 'Connection failed. Check your key.'}
            </p>
          )}

          {/* Token meter */}
          <div className="flex items-center gap-2 pt-1 border-t border-line-soft">
            <Brain size={12} className="text-ink-faded shrink-0" />
            {claudeIn + claudeOut > 0 ? (
              <span className="text-[11px] text-ink-faded flex-1">
                {fmt(claudeIn)} in · {fmt(claudeOut)} out — {claudeCost(claudeIn, claudeOut)}
              </span>
            ) : (
              <span className="text-[11px] text-ink-faded flex-1">No tokens used yet.</span>
            )}
            {(claudeIn + claudeOut > 0) && (
              <button
                onClick={() => handleResetTokens('claude')}
                title="Reset counter"
                className="p-0.5 rounded text-ink-faded hover:text-ink transition-colors"
              >
                <RotateCcw size={11} />
              </button>
            )}
          </div>
        </div>

        {/* ── GPT key ────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-line-soft bg-paper-tinted p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Bot size={15} className="text-ink" />
            <span className="text-sm font-semibold text-ink">ChatGPT (OpenAI)</span>
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
              className="btn shrink-0 disabled:opacity-50"
            >
              {gptTestState === 'testing' ? <Loader2 size={13} className="animate-spin" /> : 'Test'}
            </button>
          </div>

          {gptTestState === 'ok' && (
            <p className="text-[11px] text-green-600 flex items-center gap-1">
              <CheckCircle size={11} /> Connected — OpenAI key valid.
            </p>
          )}
          {gptTestState === 'error' && (
            <p className="text-[11px] text-red-500 flex items-center gap-1">
              <AlertCircle size={11} /> {gptTestMsg || 'Connection failed. Check your key.'}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1 border-t border-line-soft">
            <Brain size={12} className="text-ink-faded shrink-0" />
            {gptIn + gptOut > 0 ? (
              <span className="text-[11px] text-ink-faded flex-1">
                {fmt(gptIn)} in · {fmt(gptOut)} out
              </span>
            ) : (
              <span className="text-[11px] text-ink-faded flex-1">No tokens used yet.</span>
            )}
            {(gptIn + gptOut > 0) && (
              <button onClick={() => handleResetTokens('gpt')} title="Reset counter" className="p-0.5 rounded text-ink-faded hover:text-ink transition-colors">
                <RotateCcw size={11} />
              </button>
            )}
          </div>
        </div>

        {/* ── Project context ─────────────────────────────────────────────── */}
        <div className="space-y-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-faded mb-0.5">Project context</h2>
            <p className="text-xs text-ink-faded">
              Describe the tour's purpose, audience, and tone. This text is sent with every AI request to anchor the editorial voice.
            </p>
          </div>
          <textarea
            rows={6}
            className="w-full bg-paper-strong border border-line-soft rounded px-3 py-2 text-sm text-ink placeholder-ink-faded focus:outline-none focus:border-accent resize-none leading-relaxed"
            placeholder={`Example:\nYou are writing for the Hossegor tourist office website. The goal is to communicate the history of the places and local activities (surfing, architecture, nature). The tone should be warm and welcoming, aimed at French and international visitors.`}
            value={contextDraft}
            onChange={(e) => setContextDraft(e.target.value)}
            onBlur={() => autoSaveAiContext({ projectContext: contextDraft })}
          />
          <p className="text-[11px] text-ink-faded">
            Saved automatically when you leave the field. Used by Content generation and Tour Audit.
          </p>
        </div>

        {/* ── Editorial style ──────────────────────────────────────────────── */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-faded">Editorial style</h2>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium">Theme</label>
              <select
                className={selectCls}
                value={ai.theme}
                onChange={(e) => autoSaveAiContext({ theme: e.target.value })}
              >
                {AI_THEMES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium">Tone</label>
              <select
                className={selectCls}
                value={ai.tone}
                onChange={(e) => autoSaveAiContext({ tone: e.target.value as AiContext['tone'] })}
              >
                {Object.entries(AI_TONE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium">Audience</label>
              <select
                className={selectCls}
                value={ai.audience}
                onChange={(e) => autoSaveAiContext({ audience: e.target.value as AiContext['audience'] })}
              >
                {Object.entries(AI_AUDIENCE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium">Length</label>
              <select
                className={selectCls}
                value={ai.length}
                onChange={(e) => autoSaveAiContext({ length: e.target.value as AiContext['length'] })}
              >
                {Object.entries(AI_LENGTH_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

      </div>
    </ScreenShell>
  );
}
