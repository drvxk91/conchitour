import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, ArrowLeft, ArrowRight, Sparkles, Loader2, Check,
  Zap, Bot, Monitor, Smartphone, QrCode,
} from 'lucide-react';
import { v4 as uuid } from 'uuid';
import QRCode from 'qrcode';
import clsx from 'clsx';
import { useProject } from '@/store/project';
import { newProject as buildDefaultProject, BUILTIN_CATEGORIES } from '@/lib/factory';
import { callAiStreaming } from '@/lib/ai-content';
import { testAiConnection, testOpenAIConnection } from '@/lib/audit/ai-checks';
import { flagFor } from '@/lib/language-flags';
import type { Project, Category } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep =
  | 'mode-select' | 'quick-name' | 'api-key' | 'routing'
  | 'q1' | 'q2' | 'q3' | 'q4' | 'q5'
  | 'generating' | 'summary' | 'qr-waiting';

interface WizardAnswers {
  loc: string;
  aud: string[];
  tone: string;
  cats: string[];
  color: string;
  vtype: string;
}

interface SummaryCat {
  slug: string;
  name: string;
  color: string;
}

interface WizardSummary {
  projectName: string;
  defaultLang: string;
  extraLanguages: string[];
  tone: string;
  categories: SummaryCat[];
  accentColor: string;
  contextPrompt: string;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const TONES = [
  { key: 'informative', label: 'Informative', example: 'Built in 1847, this hall features original oak beams…', icon: '📋' },
  { key: 'immersive',   label: 'Immersive',   example: 'Step into a world where history breathes around you…', icon: '✨' },
  { key: 'commercial',  label: 'Commercial',  example: 'Discover our award-winning spaces designed for…', icon: '🏆' },
  { key: 'luxury',      label: 'Luxury',      example: 'An exquisite retreat where every detail has been…', icon: '💎' },
];

const AUDIENCES = [
  { key: 'tourists',  label: 'International tourists' },
  { key: 'locals',    label: 'Local visitors' },
  { key: 'business',  label: 'Business professionals' },
  { key: 'families',  label: 'Families & children' },
  { key: 'luxury',    label: 'Luxury clientele' },
  { key: 'students',  label: 'Students & education' },
];

const CATEGORY_PRESETS: Record<string, SummaryCat[]> = {
  hotel: [
    { slug: 'rooms',     name: 'Rooms',      color: '#185FA5' },
    { slug: 'restaurant',name: 'Restaurant', color: '#BA7517' },
    { slug: 'spa',       name: 'Spa',        color: '#1D9E75' },
    { slug: 'pool',      name: 'Pool',       color: '#0EA5E9' },
    { slug: 'lobby',     name: 'Lobby',      color: '#8B5CF6' },
    { slug: 'terrace',   name: 'Terrace',    color: '#F59E0B' },
  ],
  museum: [
    { slug: 'exhibition', name: 'Exhibition', color: '#185FA5' },
    { slug: 'collection', name: 'Collection', color: '#8B5CF6' },
    { slug: 'garden',     name: 'Garden',     color: '#1D9E75' },
    { slug: 'workshop',   name: 'Workshop',   color: '#BA7517' },
  ],
  restaurant: [
    { slug: 'dining',   name: 'Dining Room', color: '#185FA5' },
    { slug: 'bar',      name: 'Bar',         color: '#BA7517' },
    { slug: 'terrace',  name: 'Terrace',     color: '#1D9E75' },
    { slug: 'kitchen',  name: 'Kitchen',     color: '#8B5CF6' },
  ],
  'real-estate': [
    { slug: 'living',   name: 'Living Room', color: '#185FA5' },
    { slug: 'bedroom',  name: 'Bedroom',     color: '#8B5CF6' },
    { slug: 'kitchen',  name: 'Kitchen',     color: '#1D9E75' },
    { slug: 'outdoor',  name: 'Outdoor',     color: '#F59E0B' },
    { slug: 'overview', name: 'Overview',    color: '#BA7517' },
  ],
  heritage: [
    { slug: 'exterior', name: 'Exterior', color: '#BA7517' },
    { slug: 'interior', name: 'Interior', color: '#185FA5' },
    { slug: 'garden',   name: 'Garden',   color: '#1D9E75' },
    { slug: 'chapel',   name: 'Chapel',   color: '#8B5CF6' },
  ],
  venue: [
    { slug: 'main-area', name: 'Main Area',  color: '#185FA5' },
    { slug: 'garden',    name: 'Garden',     color: '#1D9E75' },
    { slug: 'room',      name: 'Room',       color: '#8B5CF6' },
    { slug: 'entrance',  name: 'Entrance',   color: '#BA7517' },
    { slug: 'outdoor',   name: 'Outdoor',    color: '#F59E0B' },
  ],
};

const VENUE_ACCENT: Record<string, string> = {
  hotel:        '#1D9E75',
  museum:       '#8B5CF6',
  restaurant:   '#BA7517',
  'real-estate':'#185FA5',
  heritage:     '#B45309',
  venue:        '#1D9E75',
};

const TONE_TO_AI_TONE: Record<string, 'marketing' | 'factual' | 'storytelling' | 'poetic' | 'educational'> = {
  informative: 'factual',
  immersive:   'storytelling',
  commercial:  'marketing',
  luxury:      'poetic',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectVenueType(loc: string): string {
  const l = loc.toLowerCase();
  if (/hotel|resort|lodge|inn|hostel/.test(l)) return 'hotel';
  if (/museum|gallery|exhibition|heritage|archive/.test(l)) return 'museum';
  if (/restaurant|caf[eé]|bar|bistro|brasserie/.test(l)) return 'restaurant';
  if (/apartment|flat|house|villa|property|immobilier|real estate/.test(l)) return 'real-estate';
  if (/chateau|château|manor|castle|abbaye/.test(l)) return 'heritage';
  return 'venue';
}

function langLabel(code: string): string {
  const names: Record<string, string> = {
    en: 'English', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian',
    pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', ja: 'Japanese', zh: 'Chinese',
    ko: 'Korean', ar: 'Arabic', tr: 'Turkish', hi: 'Hindi', pl: 'Polish',
    sv: 'Swedish', da: 'Danish', fi: 'Finnish', nb: 'Norwegian', uk: 'Ukrainian',
  };
  return names[code] ?? code.toUpperCase();
}

function buildWizardPrompt(answers: WizardAnswers): string {
  return `You are configuring a virtual tour creation app. Based on the collected answers, produce a JSON configuration.

VENUE: "${answers.loc}"
AUDIENCE: ${answers.aud.join(', ')}
TONE: ${answers.tone}
SPACES/AREAS: ${answers.cats.join(', ')}
ACCENT COLOR: ${answers.color}

Respond with ONLY a valid JSON object (no markdown fences, no explanation):
{
  "projectName": "<short descriptive name, max 35 chars>",
  "defaultLang": "<BCP47 code of primary language for this venue's country: Paris→fr, Rome→it, Madrid→es, Berlin→de, NY→en, etc.>",
  "extraLanguages": ["<code>"],
  "contextPrompt": "<3-4 sentences starting with 'You are writing for...' describing audience, tone, editorial style>"
}

Rules:
- defaultLang must match the venue's country language
- extraLanguages: include 'en' unless it is defaultLang; add 'zh'/'ja' for Asian tourists; 'de' for German market; 'fr' for luxury; max 4 extra
- contextPrompt must be in English and serve as an AI instruction for content generation`;
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

const DESKTOP_STEPS: WizardStep[] = ['q1', 'q2', 'q3', 'q4', 'q5', 'generating', 'summary'];

function ProgressBar({ step }: { step: WizardStep }) {
  const idx = DESKTOP_STEPS.indexOf(step);
  if (idx < 0) return null;
  const pct = ((idx + 1) / DESKTOP_STEPS.length) * 100;
  return (
    <div className="h-0.5 bg-line w-full">
      <div
        className="h-full bg-accent transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ─── Sub-step components ───────────────────────────────────────────────────────

function StepQ1({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink-base">Where is your venue?</h2>
        <p className="text-sm text-ink-soft mt-1">
          City, address, or just describe the place — we'll deduce the language and context.
        </p>
      </div>
      <textarea
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Château de Versailles, France · A luxury hotel in downtown Tokyo · Miami Beach resort"
        rows={3}
        className="w-full bg-paper-strong border border-line-soft rounded-lg px-3 py-2.5 text-sm text-ink-base placeholder-ink-faded focus:outline-none focus:border-accent resize-none"
      />
    </div>
  );
}

function StepQ2({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink-base">Who are your visitors?</h2>
        <p className="text-sm text-ink-soft mt-1">Select all that apply — we'll deduce the right languages.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {AUDIENCES.map((a) => {
          const selected = value.includes(a.key);
          return (
            <button
              key={a.key}
              onClick={() => toggle(a.key)}
              className={clsx(
                'text-left px-4 py-3 rounded-lg border text-sm font-medium transition-all',
                selected
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line bg-paper-strong text-ink-soft hover:border-ink-soft hover:text-ink-base',
              )}
            >
              {selected && <Check size={12} className="inline mr-1.5" />}
              {a.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepQ3({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink-base">What's the editorial tone?</h2>
        <p className="text-sm text-ink-soft mt-1">This shapes all AI-generated text for your tour.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {TONES.map((t) => {
          const selected = value === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={clsx(
                'text-left px-4 py-3 rounded-lg border transition-all',
                selected
                  ? 'border-accent bg-accent/10'
                  : 'border-line bg-paper-strong hover:border-ink-soft',
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span>{t.icon}</span>
                <span className={clsx('text-sm font-semibold', selected ? 'text-accent' : 'text-ink-base')}>
                  {t.label}
                </span>
              </div>
              <p className="text-xs text-ink-faded line-clamp-2">"{t.example}"</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepQ4({ vtype, value, onChange }: { vtype: string; value: string[]; onChange: (v: string[]) => void }) {
  const options = CATEGORY_PRESETS[vtype] ?? CATEGORY_PRESETS.venue;
  const toggle = (slug: string) =>
    onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug]);
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink-base">What areas / spaces?</h2>
        <p className="text-sm text-ink-soft mt-1">These become your tour categories. Select what's relevant.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((cat) => {
          const selected = value.includes(cat.slug);
          return (
            <button
              key={cat.slug}
              onClick={() => toggle(cat.slug)}
              className={clsx(
                'px-3 py-1.5 rounded-full border text-xs font-medium transition-all',
                selected
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line bg-paper-strong text-ink-soft hover:border-ink-soft',
              )}
            >
              {selected && <Check size={10} className="inline mr-1" />}
              {cat.name}
            </button>
          );
        })}
      </div>
      {value.length > 0 && (
        <p className="text-xs text-ink-faded">{value.length} space{value.length > 1 ? 's' : ''} selected</p>
      )}
    </div>
  );
}

function StepQ5({
  value, onChange, vtype, onAiSuggest,
}: {
  value: string;
  onChange: (v: string) => void;
  vtype: string;
  onAiSuggest: () => void;
}) {
  const suggested = VENUE_ACCENT[vtype] ?? '#1D9E75';
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink-base">Pick an accent color</h2>
        <p className="text-sm text-ink-soft mt-1">Used for buttons, highlights, and UI accents in the compiled tour.</p>
      </div>
      <div className="flex items-center gap-4">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-16 h-16 rounded-lg border border-line cursor-pointer bg-transparent"
        />
        <div className="space-y-2">
          <div className="text-sm font-mono text-ink-base">{value.toUpperCase()}</div>
          <button
            onClick={() => onChange(suggested)}
            className="flex items-center gap-1.5 text-xs text-ink-soft hover:text-accent transition-colors border border-line rounded px-2.5 py-1"
          >
            <Sparkles size={11} />
            Use suggested ({suggested.toUpperCase()})
          </button>
          <button
            onClick={onAiSuggest}
            className="flex items-center gap-1.5 text-xs text-ink-soft hover:text-accent transition-colors border border-line rounded px-2.5 py-1"
          >
            <Bot size={11} />
            Let AI choose
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main wizard ───────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  initialStep?: WizardStep;
}

export function NewProjectWizard({ onClose, initialStep = 'mode-select' }: Props) {
  const { loadProjectData, setActiveScreen } = useProject();

  const [step, setStep] = useState<WizardStep>(initialStep);

  // Quick mode
  const [quickName, setQuickName] = useState('My Tour');
  const quickNameRef = useRef<HTMLInputElement>(null);

  // API key step
  const [apiProvider, setApiProvider] = useState<'claude' | 'gpt'>('claude');
  const [apiKey, setApiKey] = useState('');
  const [keyTestState, setKeyTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [keyTestError, setKeyTestError] = useState('');

  // Answers
  const [loc, setLoc] = useState('');
  const [aud, setAud] = useState<string[]>([]);
  const [tone, setTone] = useState('');
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [color, setColor] = useState('#1D9E75');

  // Generation
  const [generating, setGenerating] = useState(false);
  const [generatingDots, setGeneratingDots] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // Summary
  const [summary, setSummary] = useState<WizardSummary | null>(null);
  const [applying, setApplying] = useState(false);

  // QR / mobile server
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [lanUrl, setLanUrl] = useState<string | null>(null);

  // Error
  const [error, setError] = useState('');

  const vtype = detectVenueType(loc);

  // Animated dots while generating
  useEffect(() => {
    if (step !== 'generating') return;
    const interval = setInterval(() => {
      setGeneratingDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, [step]);

  // QR code startup
  useEffect(() => {
    if (step !== 'qr-waiting') return;
    let cleanup: (() => void) | null = null;

    window.conchitour.wizardStartServer().then(({ port, lanUrl: url }) => {
      if (url) {
        setLanUrl(url);
        QRCode.toDataURL(url, { width: 200, margin: 1 }).then(setQrDataUrl).catch(() => {});
      } else {
        setLanUrl(`http://localhost:${port}`);
      }
      // Listen for answers from phone
      cleanup = window.conchitour.onWizardMobileAnswers((rawAnswers) => {
        const a = rawAnswers as { loc?: string; aud?: string[]; tone?: string; cats?: string[]; color?: string; vtype?: string };
        if (a.loc) setLoc(a.loc);
        if (a.aud) setAud(a.aud);
        if (a.tone) setTone(a.tone);
        if (a.cats) setSelectedCats(a.cats);
        if (a.color) setColor(a.color);
        window.conchitour.wizardStopServer();
        setStep('generating');
      });
    });

    return () => {
      cleanup?.();
      window.conchitour.wizardStopServer();
    };
  }, [step]);

  // Run AI generation when step === 'generating'
  useEffect(() => {
    if (step !== 'generating') return;

    const answers: WizardAnswers = { loc, aud, tone, cats: selectedCats, color, vtype };
    const prompt = buildWizardPrompt(answers);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setGenerating(true);
    setError('');

    const provider = apiProvider;
    const key = apiKey;

    callAiStreaming(provider, key, prompt, null, ctrl.signal, () => {})
      .then(({ text }) => {
        // Parse JSON — strip potential markdown fences
        const cleaned = text.replace(/^```json?\n?/m, '').replace(/^```\n?/m, '').replace(/```$/m, '').trim();
        let parsed: {
          projectName?: string;
          defaultLang?: string;
          extraLanguages?: string[];
          contextPrompt?: string;
        };
        try {
          parsed = JSON.parse(cleaned) as typeof parsed;
        } catch {
          // Fallback: extract JSON from response
          const match = cleaned.match(/\{[\s\S]*\}/);
          parsed = match ? (JSON.parse(match[0]) as typeof parsed) : {};
        }

        const defaultLang = parsed.defaultLang ?? 'en';
        const cats: SummaryCat[] = (selectedCats.length > 0
          ? (CATEGORY_PRESETS[vtype] ?? CATEGORY_PRESETS.venue).filter((c) => selectedCats.includes(c.slug))
          : (CATEGORY_PRESETS[vtype] ?? CATEGORY_PRESETS.venue).slice(0, 3)
        );

        setSummary({
          projectName: parsed.projectName ?? (loc.split(',')[0].trim() || 'My Tour'),
          defaultLang,
          extraLanguages: (parsed.extraLanguages ?? []).filter((l) => l !== defaultLang).slice(0, 4),
          tone,
          categories: cats,
          accentColor: color,
          contextPrompt: parsed.contextPrompt ?? '',
        });
        setStep('summary');
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setError('AI generation failed. You can edit the summary manually.');
          // Still show summary with defaults
          const defaultLang = 'en';
          setSummary({
            projectName: loc.split(',')[0].trim() || 'My Tour',
            defaultLang,
            extraLanguages: ['fr'],
            tone,
            categories: (CATEGORY_PRESETS[vtype] ?? CATEGORY_PRESETS.venue).slice(0, 3),
            accentColor: color,
            contextPrompt: '',
          });
          setStep('summary');
        }
      })
      .finally(() => setGenerating(false));

    return () => ctrl.abort();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const testKey = useCallback(async () => {
    setKeyTestState('testing');
    setKeyTestError('');
    try {
      const result = apiProvider === 'claude'
        ? await testAiConnection(apiKey)
        : await testOpenAIConnection(apiKey);
      if (result.ok) {
        setKeyTestState('ok');
      } else {
        setKeyTestState('error');
        setKeyTestError(result.error ?? 'Connection failed');
      }
    } catch {
      setKeyTestState('error');
      setKeyTestError('Connection error');
    }
  }, [apiProvider, apiKey]);

  const applyQuick = useCallback(async () => {
    const name = quickName.trim();
    if (!name) return;
    const folder = await window.conchitour.showProjectFolderDialog();
    if (!folder) return;
    const result = await window.conchitour.newProject(folder, name);
    const proj = buildDefaultProject();
    proj.meta.name = name;
    loadProjectData(proj, result.projectDir);
    await window.conchitour.saveProject(proj);
    setActiveScreen('import');
    onClose();
  }, [quickName, loadProjectData, setActiveScreen, onClose]);

  const applySummary = useCallback(async () => {
    if (!summary) return;
    setApplying(true);
    try {
      const folder = await window.conchitour.showProjectFolderDialog();
      if (!folder) { setApplying(false); return; }

      const { projectDir } = await window.conchitour.newProject(folder, summary.projectName);

      // Build project from defaults then override with wizard config
      const proj: Project = buildDefaultProject();
      proj.meta.name = summary.projectName;
      proj.languages.default = summary.defaultLang;
      proj.languages.available = [summary.defaultLang, ...summary.extraLanguages];
      proj.branding.accentColor = summary.accentColor;
      proj.branding.introText = Object.fromEntries(
        proj.languages.available.map((l) => [l, ''])
      );

      // Custom categories (built-ins preserved by ensureBuiltins in store)
      const customCats: Category[] = summary.categories.map((c) => ({
        id: uuid(),
        slug: c.slug,
        name: { [summary.defaultLang]: c.name },
        color: c.color,
      }));
      proj.categories = [...BUILTIN_CATEGORIES, ...customCats];

      // AI context
      proj.aiContext = {
        tone: TONE_TO_AI_TONE[summary.tone] ?? 'marketing',
        audience: 'general',
        theme: 'Tourism',
        length: 'medium',
        projectContext: summary.contextPrompt,
        tokensUsed: { claude: { in: 0, out: 0 }, gpt: { in: 0, out: 0 } },
      };

      // API key
      if (apiKey) {
        if (apiProvider === 'claude') {
          proj.modules.anthropicApiKey = apiKey;
          proj.modules.aiProvider = 'claude';
        } else {
          proj.modules.openaiApiKey = apiKey;
          proj.modules.aiProvider = 'gpt';
        }
      }

      loadProjectData(proj, projectDir);
      await window.conchitour.saveProject(proj);
      setActiveScreen('import');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setApplying(false);
    }
  }, [summary, apiKey, apiProvider, loadProjectData, setActiveScreen, onClose]);

  const goBack = useCallback(() => {
    // If wizard started at api-key (no mode-select), back = close modal
    if (step === 'api-key' && initialStep === 'api-key') { onClose(); return; }
    const prev: Partial<Record<WizardStep, WizardStep>> = {
      'quick-name': 'mode-select',
      'api-key':    'mode-select',
      routing:      'api-key',
      q1:           'routing',
      q2:           'q1',
      q3:           'q2',
      q4:           'q3',
      q5:           'q4',
      summary:      'q5',
      'qr-waiting': 'routing',
    };
    const target = prev[step];
    if (target) setStep(target);
  }, [step]);

  const canAdvance = useCallback(() => {
    if (step === 'q1') return loc.trim().length > 3;
    if (step === 'q2') return aud.length > 0;
    if (step === 'q3') return tone !== '';
    if (step === 'q4') return true; // categories optional
    if (step === 'q5') return color !== '';
    if (step === 'api-key') return apiKey.trim().length > 10;
    return true;
  }, [step, loc, aud, tone, color, apiKey]);

  const advance = useCallback(() => {
    const next: Partial<Record<WizardStep, WizardStep>> = {
      q1: 'q2', q2: 'q3', q3: 'q4', q4: 'q5', q5: 'generating',
    };
    if (next[step]) setStep(next[step]!);
  }, [step]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const showBackButton = !['mode-select', 'generating', 'summary'].includes(step);
  const showNextButton = ['q1', 'q2', 'q3', 'q4', 'q5'].includes(step);
  const stepLabel: Partial<Record<WizardStep, string>> = {
    q1: 'Step 1 of 5', q2: 'Step 2 of 5', q3: 'Step 3 of 5', q4: 'Step 4 of 5', q5: 'Step 5 of 5',
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg bg-paper rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0">
          <div className="flex items-center gap-2">
            {step !== 'mode-select' && (
              <Sparkles size={16} className="text-accent" />
            )}
            <span className="text-sm font-semibold text-ink-base">
              {step === 'mode-select' ? 'New project' : 'AI project setup'}
            </span>
            {stepLabel[step] && (
              <span className="text-xs text-ink-faded ml-1">{stepLabel[step]}</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-ink-faded hover:text-ink-base transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <ProgressBar step={step} />

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── Mode select ── */}
          {step === 'mode-select' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">How do you want to start?</h2>
                <p className="text-sm text-ink-soft mt-1">Quick setup takes 10 seconds. AI setup configures everything automatically.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => { setStep('quick-name'); setTimeout(() => quickNameRef.current?.select(), 50); }}
                  className="group flex flex-col items-start gap-3 p-5 rounded-xl border border-line bg-paper-strong hover:border-ink-soft transition-all text-left"
                >
                  <Zap size={22} className="text-ink-soft group-hover:text-ink-base transition-colors" />
                  <div>
                    <div className="text-sm font-semibold text-ink-base">Quick setup</div>
                    <div className="text-xs text-ink-faded mt-0.5">Just a name, get started now</div>
                  </div>
                </button>
                <button
                  onClick={() => setStep('api-key')}
                  className="group flex flex-col items-start gap-3 p-5 rounded-xl border border-accent/40 bg-accent/5 hover:border-accent hover:bg-accent/10 transition-all text-left"
                >
                  <Bot size={22} className="text-accent" />
                  <div>
                    <div className="text-sm font-semibold text-accent">AI-assisted setup</div>
                    <div className="text-xs text-ink-faded mt-0.5">Auto-configure languages, tone, categories</div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ── Quick name ── */}
          {step === 'quick-name' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">Project name</h2>
                <p className="text-sm text-ink-soft mt-1">You can change it later in Project settings.</p>
              </div>
              <input
                ref={quickNameRef}
                autoFocus
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyQuick(); }}
                className="w-full bg-paper-strong border border-line-soft rounded-lg px-3 py-2.5 text-sm text-ink-base placeholder-ink-faded focus:outline-none focus:border-accent"
                placeholder="My Tour"
              />
            </div>
          )}

          {/* ── API key ── */}
          {step === 'api-key' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">AI provider & key</h2>
                <p className="text-sm text-ink-soft mt-1">
                  Your key is stored in this project only and never sent to our servers.
                </p>
              </div>
              <div className="flex gap-2">
                {(['claude', 'gpt'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => { setApiProvider(p); setKeyTestState('idle'); }}
                    className={clsx(
                      'flex-1 py-2 rounded-lg border text-sm font-medium transition-all',
                      apiProvider === p
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-line bg-paper-strong text-ink-soft hover:text-ink-base',
                    )}
                  >
                    {p === 'claude' ? 'Claude (Anthropic)' : 'ChatGPT (OpenAI)'}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <label className="text-xs text-ink-faded">
                  {apiProvider === 'claude' ? 'Anthropic API key (sk-ant-…)' : 'OpenAI API key (sk-…)'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => { setApiKey(e.target.value); setKeyTestState('idle'); }}
                    placeholder={apiProvider === 'claude' ? 'sk-ant-…' : 'sk-…'}
                    className="flex-1 bg-paper-strong border border-line-soft rounded-lg px-3 py-2 text-sm font-mono text-ink-base placeholder-ink-faded focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={testKey}
                    disabled={apiKey.length < 10 || keyTestState === 'testing'}
                    className={clsx(
                      'px-3 py-2 rounded-lg border text-xs font-medium shrink-0 transition-all disabled:opacity-40',
                      keyTestState === 'ok' && 'border-emerald-500 bg-emerald-500/10 text-emerald-400',
                      keyTestState === 'error' && 'border-red-500 bg-red-500/10 text-red-400',
                      keyTestState === 'idle' && 'border-line bg-paper-strong text-ink-soft hover:text-ink-base',
                      keyTestState === 'testing' && 'border-line bg-paper-strong text-ink-faded',
                    )}
                  >
                    {keyTestState === 'testing' ? <Loader2 size={12} className="animate-spin" /> :
                     keyTestState === 'ok' ? <Check size={12} /> :
                     'Test'}
                  </button>
                </div>
                {keyTestState === 'error' && (
                  <p className="text-xs text-red-400">{keyTestError || 'Connection failed — check your key'}</p>
                )}
                {keyTestState === 'ok' && (
                  <p className="text-xs text-emerald-400">Connected ✓</p>
                )}
                <button
                  onClick={() => window.conchitour.openUrl(
                    apiProvider === 'claude'
                      ? 'https://console.anthropic.com/settings/keys'
                      : 'https://platform.openai.com/api-keys'
                  )}
                  className="text-xs text-ink-faded hover:text-accent transition-colors underline underline-offset-2"
                >
                  {apiProvider === 'claude' ? 'Get your Anthropic key →' : 'Get your OpenAI key →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Routing ── */}
          {step === 'routing' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">Where do you want to answer the questions?</h2>
                <p className="text-sm text-ink-soft mt-1">5 short questions to configure your tour automatically.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setStep('q1')}
                  className="group flex flex-col items-start gap-3 p-5 rounded-xl border border-line bg-paper-strong hover:border-ink-soft transition-all text-left"
                >
                  <Monitor size={22} className="text-ink-soft group-hover:text-ink-base transition-colors" />
                  <div>
                    <div className="text-sm font-semibold text-ink-base">Here on desktop</div>
                    <div className="text-xs text-ink-faded mt-0.5">Answer inline, fast and simple</div>
                  </div>
                </button>
                <button
                  onClick={() => setStep('qr-waiting')}
                  className="group flex flex-col items-start gap-3 p-5 rounded-xl border border-line bg-paper-strong hover:border-ink-soft transition-all text-left"
                >
                  <div className="flex items-center gap-2">
                    <Smartphone size={18} className="text-ink-soft group-hover:text-ink-base transition-colors" />
                    <QrCode size={18} className="text-ink-soft group-hover:text-ink-base transition-colors" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-ink-base">On my phone</div>
                    <div className="text-xs text-ink-faded mt-0.5">Scan QR code, answer on mobile</div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ── Q1 ── */}
          {step === 'q1' && <StepQ1 value={loc} onChange={setLoc} />}

          {/* ── Q2 ── */}
          {step === 'q2' && <StepQ2 value={aud} onChange={setAud} />}

          {/* ── Q3 ── */}
          {step === 'q3' && <StepQ3 value={tone} onChange={setTone} />}

          {/* ── Q4 ── */}
          {step === 'q4' && (
            <StepQ4
              vtype={vtype}
              value={selectedCats}
              onChange={setSelectedCats}
            />
          )}

          {/* ── Q5 ── */}
          {step === 'q5' && (
            <StepQ5
              value={color}
              onChange={setColor}
              vtype={vtype}
              onAiSuggest={() => {
                // Use the venue-based suggestion immediately, AI will refine during generation
                setColor(VENUE_ACCENT[vtype] ?? '#1D9E75');
              }}
            />
          )}

          {/* ── Generating ── */}
          {step === 'generating' && (
            <div className="flex flex-col items-center justify-center gap-5 py-12">
              <div className="relative">
                <Sparkles size={32} className="text-accent" />
                <div className="absolute inset-0 animate-ping rounded-full bg-accent/20" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-ink-base">Configuring your project{generatingDots}</p>
                <p className="text-xs text-ink-soft mt-1">Deducing languages, generating context, setting up categories</p>
              </div>
            </div>
          )}

          {/* ── QR waiting ── */}
          {step === 'qr-waiting' && (
            <div className="flex flex-col items-center gap-5 py-4">
              <div>
                <h2 className="text-xl font-semibold text-ink-base text-center">Scan to continue on your phone</h2>
                <p className="text-sm text-ink-soft mt-1 text-center">
                  Make sure your phone is on the same Wi-Fi network.
                </p>
              </div>
              {qrDataUrl ? (
                <div className="p-3 bg-white rounded-xl">
                  <img src={qrDataUrl} alt="QR code" className="w-44 h-44" />
                </div>
              ) : (
                <div className="w-44 h-44 bg-paper-strong rounded-xl flex items-center justify-center">
                  <Loader2 size={24} className="animate-spin text-ink-faded" />
                </div>
              )}
              {lanUrl && (
                <p className="text-xs font-mono text-ink-faded bg-paper-strong px-3 py-1.5 rounded">
                  {lanUrl}
                </p>
              )}
              <p className="text-xs text-ink-faded text-center">
                Answer the 5 questions on your phone. This window will update automatically.
              </p>
              <div className="flex items-center gap-2 text-xs text-ink-faded">
                <Loader2 size={12} className="animate-spin" />
                Waiting for phone response…
              </div>
            </div>
          )}

          {/* ── Summary ── */}
          {step === 'summary' && summary && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">Review your configuration</h2>
                <p className="text-sm text-ink-soft mt-1">Everything is editable before applying.</p>
              </div>

              {error && (
                <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-3 py-2">{error}</p>
              )}

              {/* Project name */}
              <div className="space-y-1.5">
                <label className="text-xs text-ink-faded uppercase tracking-wide font-semibold">Project name</label>
                <input
                  value={summary.projectName}
                  onChange={(e) => setSummary({ ...summary, projectName: e.target.value })}
                  className="w-full bg-paper-strong border border-line-soft rounded-lg px-3 py-2 text-sm text-ink-base focus:outline-none focus:border-accent"
                />
              </div>

              {/* Languages */}
              <div className="space-y-1.5">
                <label className="text-xs text-ink-faded uppercase tracking-wide font-semibold">Languages</label>
                <div className="flex flex-wrap gap-1.5">
                  <span className="flex items-center gap-1 px-2.5 py-1 bg-accent/10 border border-accent/30 rounded-full text-xs text-accent font-medium">
                    {flagFor[summary.defaultLang] ?? '🌐'} {langLabel(summary.defaultLang)} (default)
                  </span>
                  {summary.extraLanguages.map((l) => (
                    <span key={l} className="flex items-center gap-1 px-2.5 py-1 bg-paper-strong border border-line rounded-full text-xs text-ink-soft">
                      {flagFor[l] ?? '🌐'} {langLabel(l)}
                      <button
                        onClick={() => setSummary({ ...summary, extraLanguages: summary.extraLanguages.filter((x) => x !== l) })}
                        className="ml-0.5 text-ink-faded hover:text-ink-base"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Accent color */}
              <div className="space-y-1.5">
                <label className="text-xs text-ink-faded uppercase tracking-wide font-semibold">Accent color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={summary.accentColor}
                    onChange={(e) => setSummary({ ...summary, accentColor: e.target.value })}
                    className="w-8 h-8 rounded cursor-pointer border border-line bg-transparent"
                  />
                  <span className="text-xs font-mono text-ink-soft">{summary.accentColor.toUpperCase()}</span>
                </div>
              </div>

              {/* Categories */}
              {summary.categories.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs text-ink-faded uppercase tracking-wide font-semibold">Categories</label>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.categories.map((c) => (
                      <span
                        key={c.slug}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
                        style={{ backgroundColor: c.color + '22', color: c.color, border: `1px solid ${c.color}44` }}
                      >
                        {c.name}
                        <button
                          onClick={() => setSummary({ ...summary, categories: summary.categories.filter((x) => x.slug !== c.slug) })}
                          className="ml-0.5 opacity-60 hover:opacity-100"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Context prompt */}
              <div className="space-y-1.5">
                <label className="text-xs text-ink-faded uppercase tracking-wide font-semibold">AI context prompt</label>
                <textarea
                  value={summary.contextPrompt}
                  onChange={(e) => setSummary({ ...summary, contextPrompt: e.target.value })}
                  rows={4}
                  className="w-full bg-paper-strong border border-line-soft rounded-lg px-3 py-2.5 text-sm text-ink-base placeholder-ink-faded focus:outline-none focus:border-accent resize-none"
                  placeholder="Describe the venue, audience, and editorial style for AI-generated content…"
                />
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-3 border-t border-line shrink-0">
          {/* Quick mode apply */}
          {step === 'quick-name' && (
            <div className="flex gap-2">
              <button onClick={goBack} className="px-4 py-2 text-sm text-ink-soft hover:text-ink-base transition-colors">
                <ArrowLeft size={14} className="inline mr-1" /> Back
              </button>
              <button
                onClick={applyQuick}
                disabled={!quickName.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-ink-base text-paper text-sm font-semibold hover:bg-ink-strong disabled:opacity-40 transition-colors"
              >
                Choose folder <ArrowRight size={14} />
              </button>
            </div>
          )}

          {/* API key proceed */}
          {step === 'api-key' && (
            <div className="flex gap-2">
              <button onClick={goBack} className="px-4 py-2 text-sm text-ink-soft hover:text-ink-base transition-colors">
                <ArrowLeft size={14} className="inline mr-1" /> Back
              </button>
              <button
                onClick={() => setStep('routing')}
                disabled={apiKey.trim().length < 10}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                Continue <ArrowRight size={14} />
              </button>
            </div>
          )}

          {/* Routing */}
          {step === 'routing' && (
            <button onClick={goBack} className="px-4 py-2 text-sm text-ink-soft hover:text-ink-base transition-colors">
              <ArrowLeft size={14} className="inline mr-1" /> Back
            </button>
          )}

          {/* Q1–Q5 navigation */}
          {showNextButton && (
            <div className="flex gap-2">
              <button onClick={goBack} className="px-4 py-2 text-sm text-ink-soft hover:text-ink-base transition-colors">
                <ArrowLeft size={14} className="inline mr-1" /> Back
              </button>
              <button
                onClick={advance}
                disabled={!canAdvance()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                {step === 'q4' || step === 'q5' ? 'Generate' : 'Next'} <ArrowRight size={14} />
              </button>
            </div>
          )}

          {/* QR waiting — cancel */}
          {step === 'qr-waiting' && (
            <button onClick={goBack} className="w-full py-2 text-sm text-ink-soft hover:text-ink-base transition-colors">
              <ArrowLeft size={14} className="inline mr-1" /> Back to routing
            </button>
          )}

          {/* Summary — apply */}
          {step === 'summary' && summary && (
            <button
              onClick={applySummary}
              disabled={applying || !summary.projectName.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              {applying ? (
                <><Loader2 size={14} className="animate-spin" /> Creating project…</>
              ) : (
                <><Check size={14} /> Apply configuration</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
