import { useState, useRef, useEffect } from 'react';
import { X, Send, Sparkles, CheckCircle, Loader2 } from 'lucide-react';
import { callAiStreaming } from '@/lib/ai-content';
import type { Project } from '@/types';

type Msg = { role: 'user' | 'ai'; text: string };

interface Props {
  ai: { provider: 'claude' | 'gpt'; apiKey: string; modelId?: string };
  project: Project;
  onApply: (context: string, tokensIn: number, tokensOut: number) => void;
  onClose: () => void;
}

function buildSystemPrompt(project: Project): string {
  const name = project.meta?.name ? `"${project.meta.name}"` : 'a virtual tour';
  const sceneCount = project.scenes.length;
  const langs = (project.languages.available ?? ['en']).join(', ');
  const existingContext = project.aiContext?.projectContext?.trim();

  return `You are helping write a "project context" for ${name} (${sceneCount} scene${sceneCount !== 1 ? 's' : ''}, language${langs.includes(',') ? 's' : ''}: ${langs}).
${existingContext ? `\nAn existing context already exists:\n"${existingContext}"\nYou may improve it based on the conversation.\n` : ''}
The project context (3–5 sentences) is sent with every AI request to anchor the editorial voice and ensure consistent, relevant content generation.

Your mission: collect information through a friendly, professional conversation, then synthesize a final context paragraph.

Ask ONE short question per turn. Cover these topics (not necessarily in this order, adapt to what's already been answered):
• What the tour is about — place, venue, region, type of attraction
• Who the target audience is — tourists, real estate buyers, professionals, families, students…
• Desired tone and style — warm, authoritative, poetic, factual, enthusiastic…
• Key highlights or unique features that make this tour special
• Languages / markets / any editorial requirements or things to avoid

Once you have 4 or more substantive answers, synthesize a project context paragraph and signal completion by responding with EXACTLY this format and nothing else:
[CONTEXT]
<your 3–5 sentence context paragraph>

Rules:
- Ask one question at a time, be concise.
- Do not offer multiple choice options unless the user seems stuck.
- Generate the context as soon as you have enough information — do not keep asking.
- The context paragraph should be written in the second person ("You are writing for…") to work well as an AI instruction.`;
}

function buildTurnPrompt(systemPrompt: string, msgs: Msg[]): string {
  const history = msgs
    .map((m) => `${m.role === 'ai' ? 'Assistant' : 'User'}: ${m.text}`)
    .join('\n\n');
  return `${systemPrompt}\n\n---\n\n${history}\n\nAssistant:`;
}

function getFirstMessage(project: Project): string {
  const name = project.meta?.name ? `"${project.meta.name}"` : 'your virtual tour';
  return `Hi! I will help you write the project context for ${name}.\n\nTo start — what is this tour about? (location, type of place, main subject...)`;
}

export function ProjectContextInterviewModal({ ai, project, onApply, onClose }: Props) {
  const systemPrompt = buildSystemPrompt(project);

  const [msgs, setMsgs] = useState<Msg[]>([
    { role: 'ai', text: getFirstMessage(project) },
  ]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [generatedContext, setGeneratedContext] = useState<string | null>(null);
  const totalTokensRef = useRef<{ in: number; out: number }>({ in: 0, out: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, streamingText, generatedContext]);

  useEffect(() => {
    if (!streaming) inputRef.current?.focus();
  }, [streaming]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

    const newMsgs: Msg[] = [...msgs, { role: 'user', text }];
    setMsgs(newMsgs);
    setInput('');
    setStreaming(true);
    setStreamingText('');

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let fullResponse = '';
    try {
      const prompt = buildTurnPrompt(systemPrompt, newMsgs);
      const { tokensIn, tokensOut } = await callAiStreaming(
        ai.provider, ai.apiKey, prompt, null, ctrl.signal,
        (token) => { fullResponse += token; setStreamingText(fullResponse); },
        ai.modelId,
      );
      totalTokensRef.current = {
        in: totalTokensRef.current.in + tokensIn,
        out: totalTokensRef.current.out + tokensOut,
      };
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      fullResponse = `Sorry, something went wrong: ${String(err)}`;
    } finally {
      setStreaming(false);
      setStreamingText('');
    }

    const contextMatch = fullResponse.match(/\[CONTEXT\]\s*([\s\S]+)/);
    if (contextMatch) {
      setGeneratedContext(contextMatch[1].trim());
    } else {
      setMsgs((prev) => [...prev, { role: 'ai', text: fullResponse.trim() }]);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleClose() {
    abortRef.current?.abort();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-paper rounded-2xl shadow-2xl border border-line w-[540px] max-h-[82vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-line shrink-0">
          <Sparkles size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-ink-strong flex-1">Generate project context</h2>
          <button onClick={handleClose} className="text-ink-faded hover:text-ink p-1 rounded transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        {generatedContext !== null ? (
          /* ── Context ready ── */
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle size={14} />
              <span className="text-sm font-medium">Context ready — review and edit before saving</span>
            </div>
            <textarea
              className="w-full bg-paper-strong border border-accent/40 rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent resize-none leading-relaxed"
              rows={7}
              value={generatedContext}
              onChange={(e) => setGeneratedContext(e.target.value)}
            />
            <p className="text-[11px] text-ink-faded">
              You can edit the text above before saving it.
            </p>
          </div>
        ) : (
          /* ── Chat ── */
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
            {msgs.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'ai' && (
                  <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles size={11} className="text-accent" />
                  </div>
                )}
                <div
                  className={`rounded-2xl px-3.5 py-2 text-sm max-w-[80%] leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-accent text-white rounded-br-sm'
                      : 'bg-paper-strong text-ink rounded-bl-sm'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {/* Streaming bubble */}
            {streaming && (
              <div className="flex gap-2 justify-start">
                <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles size={11} className="text-accent" />
                </div>
                <div className="bg-paper-strong rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm text-ink max-w-[80%] leading-relaxed whitespace-pre-wrap min-w-[40px] min-h-[36px]">
                  {streamingText || <Loader2 size={13} className="animate-spin text-ink-faded mt-0.5" />}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-3 border-t border-line shrink-0">
          {generatedContext !== null ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setGeneratedContext(null)}
                className="btn text-xs"
              >
                Continue chatting
              </button>
              <div className="flex-1" />
              <button
                onClick={() => onApply(generatedContext, totalTokensRef.current.in, totalTokensRef.current.out)}
                className="btn btn-accent text-xs"
              >
                Use this context
              </button>
            </div>
          ) : (
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                rows={1}
                className="flex-1 bg-paper-strong border border-line-soft rounded-xl px-3 py-2 text-sm text-ink placeholder-ink-faded focus:outline-none focus:border-accent resize-none leading-relaxed"
                placeholder="Type your answer… (Enter to send)"
                value={input}
                disabled={streaming}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{ maxHeight: 96, overflowY: 'auto' }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || streaming}
                className="btn btn-accent p-2.5 shrink-0 disabled:opacity-40 transition-opacity"
              >
                {streaming
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Send size={14} />}
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
