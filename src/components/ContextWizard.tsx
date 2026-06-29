import { useState, useEffect, useRef } from 'react';
import { Sparkles, X, ChevronRight, Check } from 'lucide-react';
import { useProject } from '@/store/project';
import { registerContextWizard, type ContextGateTrigger } from '@/lib/ai-context-gate';

type Resolver = (completed: boolean) => void;

let _resolve: Resolver | null = null;

export function triggerContextWizard(trigger: ContextGateTrigger): Promise<boolean> {
  return new Promise((resolve) => {
    _resolve = resolve;
    _pendingTrigger = trigger;
    _setVisible?.(true);
  });
}

let _pendingTrigger: ContextGateTrigger = 'generate';
let _setVisible: ((v: boolean) => void) | null = null;

// ──────────────────────────────────────────────
// Question definitions
// ──────────────────────────────────────────────

type ChoiceQuestion = { type: 'choice'; key: string; question: string; choices: string[] };
type TextQuestion   = { type: 'text';   key: string; question: string; placeholder: string; hint: string };
type MultiQuestion  = { type: 'multi';  key: string; question: string; choices: string[] };
type Question = ChoiceQuestion | TextQuestion | MultiQuestion;

const QUESTIONS: Question[] = [
  {
    type: 'choice',
    key: 'placeType',
    question: 'What kind of place is this tour about?',
    choices: ['Hotel / Resort', 'Restaurant / Venue', 'Museum / Heritage', 'Real estate', 'Tourism site', 'Other'],
  },
  {
    type: 'choice',
    key: 'audience',
    question: 'Who is your main audience?',
    choices: ['Tourists', 'Local clients', 'International buyers', 'Students', 'Other'],
  },
  {
    type: 'choice',
    key: 'tone',
    question: "What's the editorial tone?",
    choices: ['Marketing / Enticing', 'Factual / Informative', 'Storytelling', 'Educational', 'Luxury'],
  },
  {
    type: 'text',
    key: 'features',
    question: 'Any unique features to highlight?',
    placeholder: 'e.g. Sea-facing rooms, 19th-century architecture, drone view of gardens…',
    hint: '100–300 characters',
  },
  {
    type: 'multi',
    key: 'languages',
    question: 'What languages do your visitors usually speak?',
    choices: ['French', 'English', 'Spanish', 'German', 'Italian', 'Portuguese', 'Arabic', 'Chinese'],
  },
];

function buildContext(answers: Record<string, string | string[]>): string {
  const place    = answers.placeType as string || 'a place';
  const audience = answers.audience  as string || 'visitors';
  const tone     = answers.tone      as string || 'informative';
  const features = answers.features  as string || '';
  const langs    = (answers.languages as string[] || []).join(', ') || 'multiple languages';
  return (
    `This tour is for a ${place.toLowerCase()} aimed at ${audience.toLowerCase()}. ` +
    `Editorial tone: ${tone.split(' / ')[0].toLowerCase()}. ` +
    (features ? `Key features to highlight: ${features.trim()}. ` : '') +
    `Primary visitor languages: ${langs}.`
  );
}

// ──────────────────────────────────────────────
// Provider — registers the wizard globally
// ──────────────────────────────────────────────

export function ContextWizardProvider() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [draft, setDraft] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const { updateAiContext } = useProject();

  _setVisible = setVisible;

  useEffect(() => {
    registerContextWizard(triggerContextWizard);
  }, []);

  function reset() {
    setStep(0);
    setAnswers({});
    setDraft('');
    setShowEdit(false);
  }

  function cancel() {
    setVisible(false);
    reset();
    _resolve?.(false);
    _resolve = null;
  }

  function answer(key: string, value: string | string[]) {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
    } else {
      const ctx = buildContext(next);
      setDraft(ctx);
      setShowEdit(true);
    }
  }

  function toggleMulti(key: string, choice: string) {
    const current = (answers[key] as string[] | undefined) ?? [];
    const updated = current.includes(choice)
      ? current.filter((c) => c !== choice)
      : [...current, choice];
    setAnswers((prev) => ({ ...prev, [key]: updated }));
  }

  function confirmMulti(key: string) {
    const ctx = buildContext({ ...answers });
    setDraft(ctx);
    setShowEdit(true);
  }

  function save() {
    const ctx = draft.trim();
    if (!ctx) return;
    updateAiContext({ projectContext: ctx });
    setVisible(false);
    reset();
    _resolve?.(true);
    _resolve = null;
  }

  if (!visible) return null;

  const q = QUESTIONS[step];
  const progress = Math.round(((step + (showEdit ? 1 : 0)) / QUESTIONS.length) * 100);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) cancel(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
            <Sparkles size={15} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">Set up your project context</p>
            <p className="text-xs text-gray-400">Helps AI write better content for your tour</p>
          </div>
          <button onClick={cancel} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-gray-100">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Body */}
        <div className="p-6">
          {!showEdit ? (
            <>
              <p className="text-base font-semibold text-gray-900 mb-4">{q.question}</p>

              {q.type === 'choice' && (
                <div className="flex flex-col gap-2">
                  {q.choices.map((c) => (
                    <button
                      key={c}
                      onClick={() => answer(q.key, c)}
                      className="flex items-center gap-3 text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-accent hover:bg-accent/5 transition-colors text-sm text-gray-700"
                    >
                      <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
                      {c}
                    </button>
                  ))}
                </div>
              )}

              {q.type === 'text' && (
                <div className="space-y-3">
                  <textarea
                    rows={3}
                    autoFocus
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-accent resize-none leading-relaxed"
                    placeholder={q.placeholder}
                    value={(answers[q.key] as string) ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.key]: e.target.value }))}
                  />
                  <p className="text-xs text-gray-400">{q.hint}</p>
                  <button
                    onClick={() => answer(q.key, (answers[q.key] as string) ?? '')}
                    className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    Continue
                  </button>
                </div>
              )}

              {q.type === 'multi' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {q.choices.map((c) => {
                      const selected = ((answers[q.key] as string[]) ?? []).includes(c);
                      return (
                        <button
                          key={c}
                          onClick={() => toggleMulti(q.key, c)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                            selected
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          {selected && <Check size={11} />}
                          {c}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => confirmMulti(q.key)}
                    disabled={((answers[q.key] as string[]) ?? []).length === 0}
                    className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
                  >
                    Continue
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-gray-900 mb-1">Here's your generated context</p>
                <p className="text-xs text-gray-400 mb-3">Edit freely before saving — this becomes the editorial brief for all AI actions.</p>
                <textarea
                  ref={textRef}
                  rows={5}
                  autoFocus
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-accent resize-none leading-relaxed"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={cancel}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={!draft.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  Save &amp; continue
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Step indicator */}
        {!showEdit && (
          <div className="flex items-center justify-center gap-1.5 pb-4">
            {QUESTIONS.map((_, i) => (
              <div
                key={i}
                className={`rounded-full transition-all ${
                  i === step ? 'w-4 h-1.5 bg-accent' : i < step ? 'w-1.5 h-1.5 bg-accent/40' : 'w-1.5 h-1.5 bg-gray-200'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
