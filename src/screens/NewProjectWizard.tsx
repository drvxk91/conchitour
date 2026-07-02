import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, ArrowLeft, ArrowRight, Sparkles, Loader2, Check,
  Zap, Bot, Monitor, Smartphone, QrCode, Mic, MicOff,
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
  | 'venue' | 'analyzing' | 'project-type' | 'audience' | 'spaces' | 'tone' | 'extras'
  | 'generating' | 'summary' | 'qr-waiting';

interface DynamicOption {
  key: string;
  label: string;
  icon?: string;
  color?: string;
  example?: string;
  aiTone?: 'marketing' | 'factual' | 'storytelling' | 'poetic' | 'educational';
}

interface VenueAnalysis {
  location: string;
  detectedLang: string;
  venueSummary: string;
  typeOptions: DynamicOption[];
  audienceOptions: DynamicOption[];
  spaceOptions: DynamicOption[];
  toneOptions: DynamicOption[];
  accentColorSuggestion: string;
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
  categories: SummaryCat[];
  accentColor: string;
  contextPrompt: string;
  aiTone: 'marketing' | 'factual' | 'storytelling' | 'poetic' | 'educational';
}

// ─── Fallbacks ────────────────────────────────────────────────────────────────

const COLOR_PALETTE = ['#185FA5', '#8B5CF6', '#1D9E75', '#BA7517', '#0EA5E9', '#F59E0B', '#EF4444', '#EC4899'];

function pickColor(i: number) { return COLOR_PALETTE[i % COLOR_PALETTE.length]; }

const FALLBACK_ANALYSIS: VenueAnalysis = {
  location: '',
  detectedLang: 'en',
  venueSummary: '',
  typeOptions: [
    { key: 'hotel', label: 'Hotel / Resort', icon: '🏨' },
    { key: 'museum', label: 'Museum / Gallery', icon: '🏛️' },
    { key: 'restaurant', label: 'Restaurant / Bar', icon: '🍽️' },
    { key: 'real-estate', label: 'Real Estate', icon: '🏠' },
    { key: 'heritage', label: 'Heritage Site', icon: '🏰' },
    { key: 'venue', label: 'Event Venue', icon: '🎪' },
  ],
  audienceOptions: [
    { key: 'tourists', label: 'International tourists', icon: '✈️' },
    { key: 'locals', label: 'Local visitors', icon: '📍' },
    { key: 'business', label: 'Business professionals', icon: '💼' },
    { key: 'families', label: 'Families', icon: '👨‍👩‍👧' },
    { key: 'luxury', label: 'Luxury clientele', icon: '💎' },
  ],
  spaceOptions: [
    { key: 'main-area', label: 'Main Area', color: '#185FA5' },
    { key: 'entrance', label: 'Entrance', color: '#BA7517' },
    { key: 'garden', label: 'Garden / Outdoor', color: '#1D9E75' },
    { key: 'lounge', label: 'Lounge', color: '#8B5CF6' },
    { key: 'terrace', label: 'Terrace', color: '#F59E0B' },
  ],
  toneOptions: [
    { key: 'informative', label: 'Informative', icon: '📋', aiTone: 'factual', example: 'Built in 1847, this hall features original oak beams…' },
    { key: 'immersive', label: 'Immersive', icon: '✨', aiTone: 'storytelling', example: 'Step into a world where history breathes around you…' },
    { key: 'commercial', label: 'Commercial', icon: '🏆', aiTone: 'marketing', example: 'Discover our award-winning spaces designed for…' },
    { key: 'luxury', label: 'Luxury', icon: '💎', aiTone: 'poetic', example: 'An exquisite retreat where every detail has been…' },
  ],
  accentColorSuggestion: '#1D9E75',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function langLabel(code: string): string {
  const names: Record<string, string> = {
    en: 'English', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian',
    pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', ja: 'Japanese', zh: 'Chinese',
    ko: 'Korean', ar: 'Arabic', tr: 'Turkish', hi: 'Hindi', pl: 'Polish',
    sv: 'Swedish', da: 'Danish', fi: 'Finnish', nb: 'Norwegian', uk: 'Ukrainian',
  };
  return names[code] ?? code.toUpperCase();
}

function parseJsonFromText(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^```json?\n?/m, '').replace(/^```\n?/m, '').replace(/```$/m, '').trim();
  try { return JSON.parse(cleaned) as Record<string, unknown>; } catch { /* fall through */ }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { /* fall through */ }
  }
  return {};
}

function buildAnalysisPrompt(venue: string): string {
  return `You are configuring a virtual-tour app. Analyze this venue description and return contextual options.

VENUE: "${venue}"

Return ONLY valid JSON (no markdown fences, no explanation):
{
  "location": "<city/place name extracted>",
  "detectedLang": "<BCP47 of primary language: Paris→fr, Tokyo→ja, Madrid→es, Berlin→de, Rome→it, London/NY→en>",
  "venueSummary": "<1-2 sentence description of the place>",
  "typeOptions": [
    {"key": "slug", "label": "Display name", "icon": "emoji", "example": "Short description"}
  ],
  "audienceOptions": [
    {"key": "slug", "label": "Display name", "icon": "emoji"}
  ],
  "spaceOptions": [
    {"key": "slug", "label": "Area name", "color": "#hexcolor", "example": "What this area contains"}
  ],
  "toneOptions": [
    {"key": "slug", "label": "Tone name", "icon": "emoji", "aiTone": "one of: marketing|factual|storytelling|poetic|educational", "example": "Sample sentence in this tone about the venue"}
  ],
  "accentColorSuggestion": "#hexcolor"
}

Rules:
- typeOptions: 4-6 options SPECIFIC to this location (Hossegor→surf school, villa, sports activities, seafood; Paris→museum, boutique hotel, commerce, coworking; Bali→resort, wellness, temple tour)
- audienceOptions: 4-6 types relevant to this venue's actual visitors
- spaceOptions: 5-8 real areas visitors would tour at this specific venue — not generic
- toneOptions: exactly 4 tones suited to this venue, each with example text IN the tone and about the venue
- accentColorSuggestion: a hex color matching the venue's identity/nature (ocean→blue, forest→green, luxury→gold)`;
}

function buildFinalPrompt(
  venue: string,
  analysis: VenueAnalysis | null,
  projectType: string[],
  projectTypeFree: string,
  audience: string[],
  audienceFree: string,
  spaces: string[],
  spacesFree: string,
  toneKey: string,
  extras: string,
): string {
  const typeLabels = projectType.join(', ') + (projectTypeFree ? ` + "${projectTypeFree}"` : '');
  const audLabels = audience.join(', ') + (audienceFree ? ` + "${audienceFree}"` : '');
  const spaceLabels = spaces.join(', ') + (spacesFree ? ` + "${spacesFree}"` : '');
  return `Configure a virtual tour project based on these answers:

VENUE: "${venue}"
${analysis ? `VENUE CONTEXT: "${analysis.venueSummary}"\n` : ''}PROJECT TYPE: ${typeLabels || 'General'}
AUDIENCE: ${audLabels || 'General public'}
SPACES / AREAS: ${spaceLabels || 'To be defined'}
TONE: ${toneKey}
ADDITIONAL CONTEXT: ${extras || 'None'}

Return ONLY valid JSON (no markdown fences):
{
  "projectName": "<short descriptive project name, max 35 chars>",
  "defaultLang": "<BCP47 of venue's primary language>",
  "extraLanguages": ["<code>"],
  "contextPrompt": "<3-4 sentences starting 'You are writing for...' describing the editorial context for AI content generation. Be specific about the venue type, audience, and tone.>"
}

Rules:
- projectName: concise, reflects the venue (not generic)
- defaultLang: match venue country (Hossegor→fr, Tokyo→ja, etc.)
- extraLanguages: include 'en' unless it's defaultLang; add 'zh'/'ja' for Asian tourism, 'de' for German market; max 4 extra
- contextPrompt: highly specific, useful for generating tour copy`;
}

// ─── Speech recognition ───────────────────────────────────────────────────────

function getSpeechRecognitionClass(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as Record<string, unknown>;
  return (w['SpeechRecognition'] ?? w['webkitSpeechRecognition'] ?? null) as (new () => SpeechRecognition) | null;
}

// ─── MicButton ────────────────────────────────────────────────────────────────

function MicButton({ onTranscript, lang = 'en-US' }: { onTranscript: (text: string) => void; lang?: string }) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognition | null>(null);
  const SpeechRecognitionClass = getSpeechRecognitionClass();
  if (!SpeechRecognitionClass) return null;

  const toggle = () => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
    } else {
      const rec = new SpeechRecognitionClass();
      rec.lang = lang;
      rec.continuous = false;
      rec.interimResults = false;
      rec.onresult = (e: SpeechRecognitionEvent) => {
        const transcript = e.results[0]?.[0]?.transcript ?? '';
        if (transcript) onTranscript(transcript);
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      rec.start();
      recRef.current = rec;
      setListening(true);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={listening ? 'Stop dictation' : 'Dictate answer'}
      className={clsx(
        'flex items-center justify-center w-9 h-9 rounded-lg border shrink-0 transition-all',
        listening
          ? 'border-red-400 bg-red-400/10 text-red-400 animate-pulse'
          : 'border-line bg-paper-strong text-ink-faded hover:text-ink-soft hover:border-ink-soft',
      )}
    >
      {listening ? <MicOff size={14} /> : <Mic size={14} />}
    </button>
  );
}

// ─── DynamicChips + free text ─────────────────────────────────────────────────

interface ChipsInputProps {
  options: DynamicOption[];
  selected: string[];
  onToggle: (key: string) => void;
  freeText: string;
  onFreeTextChange: (v: string) => void;
  placeholder: string;
  speechLang?: string;
  multiSelect?: boolean;
  onSingleSelect?: (key: string) => void;
}

function DynamicChipsInput({
  options, selected, onToggle, freeText, onFreeTextChange, placeholder, speechLang = 'en-US', multiSelect = true, onSingleSelect,
}: ChipsInputProps) {
  const handleVoice = (text: string) => {
    onFreeTextChange((freeText ? freeText + ' ' : '') + text);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const sel = multiSelect ? selected.includes(opt.key) : selected[0] === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => multiSelect ? onToggle(opt.key) : (onSingleSelect ?? onToggle)(opt.key)}
              title={opt.example}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all',
                sel
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line bg-paper-strong text-ink-soft hover:border-ink-soft hover:text-ink-base',
              )}
              style={sel && opt.color ? { borderColor: opt.color, backgroundColor: opt.color + '22', color: opt.color } : undefined}
            >
              {opt.icon && <span>{opt.icon}</span>}
              {opt.label}
              {sel && <Check size={10} />}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={freeText}
          onChange={(e) => onFreeTextChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-paper-strong border border-line-soft rounded-lg px-3 py-2 text-sm text-ink-base placeholder-ink-faded focus:outline-none focus:border-accent"
        />
        <MicButton onTranscript={handleVoice} lang={speechLang} />
      </div>
    </div>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

const PROGRESS_STEPS: WizardStep[] = ['venue', 'project-type', 'audience', 'spaces', 'tone', 'extras'];

function ProgressBar({ step }: { step: WizardStep }) {
  const idx = PROGRESS_STEPS.indexOf(step);
  if (idx < 0) return null;
  const pct = ((idx + 1) / PROGRESS_STEPS.length) * 100;
  return (
    <div className="h-0.5 bg-line w-full">
      <div className="h-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
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

  // API key
  const [apiProvider, setApiProvider] = useState<'claude' | 'gpt'>('claude');
  const [apiKey, setApiKey] = useState('');
  const [keyTestState, setKeyTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [keyTestError, setKeyTestError] = useState('');

  // Step 1: venue free text
  const [venue, setVenue] = useState('');

  // AI analysis result
  const [analysis, setAnalysis] = useState<VenueAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState('');

  // Step 3: project type
  const [projectType, setProjectType] = useState<string[]>([]);
  const [projectTypeFree, setProjectTypeFree] = useState('');

  // Step 4: audience
  const [audience, setAudience] = useState<string[]>([]);
  const [audienceFree, setAudienceFree] = useState('');

  // Step 5: spaces
  const [spaces, setSpaces] = useState<string[]>([]);
  const [spacesFree, setSpacesFree] = useState('');

  // Step 6: tone (single select)
  const [toneKey, setToneKey] = useState('');

  // Step 7: extras
  const [extras, setExtras] = useState('');

  // Color (from analysis or user pick later)
  const [color, setColor] = useState('#1D9E75');

  // Generation
  const [generatingDots, setGeneratingDots] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // Summary
  const [summary, setSummary] = useState<WizardSummary | null>(null);
  const [applying, setApplying] = useState(false);

  // QR / mobile
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [lanUrl, setLanUrl] = useState<string | null>(null);

  // Error
  const [error, setError] = useState('');

  // Speech lang: use detectedLang from analysis if available
  const speechLang = analysis ? analysis.detectedLang + '-' + analysis.detectedLang.toUpperCase() : 'en-US';

  // Animated dots
  useEffect(() => {
    if (step !== 'analyzing' && step !== 'generating') return;
    const interval = setInterval(() => {
      setGeneratingDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, [step]);

  // AI venue analysis
  useEffect(() => {
    if (step !== 'analyzing') return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAnalysisError('');

    const prompt = buildAnalysisPrompt(venue);

    callAiStreaming(apiProvider, apiKey, prompt, null, ctrl.signal, () => {})
      .then(({ text }) => {
        const parsed = parseJsonFromText(text);
        const result: VenueAnalysis = {
          location: (parsed['location'] as string) ?? venue.split(',')[0].trim(),
          detectedLang: (parsed['detectedLang'] as string) ?? 'en',
          venueSummary: (parsed['venueSummary'] as string) ?? '',
          typeOptions: (parsed['typeOptions'] as DynamicOption[]) ?? FALLBACK_ANALYSIS.typeOptions,
          audienceOptions: (parsed['audienceOptions'] as DynamicOption[]) ?? FALLBACK_ANALYSIS.audienceOptions,
          spaceOptions: (parsed['spaceOptions'] as DynamicOption[]) ?? FALLBACK_ANALYSIS.spaceOptions,
          toneOptions: (parsed['toneOptions'] as DynamicOption[]) ?? FALLBACK_ANALYSIS.toneOptions,
          accentColorSuggestion: (parsed['accentColorSuggestion'] as string) ?? '#1D9E75',
        };
        setAnalysis(result);
        setColor(result.accentColorSuggestion);
        setStep('project-type');
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setAnalysisError('Analysis failed — using generic options');
          setAnalysis({ ...FALLBACK_ANALYSIS, location: venue.split(',')[0].trim() });
          setStep('project-type');
        }
      });

    return () => ctrl.abort();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // QR code startup
  useEffect(() => {
    if (step !== 'qr-waiting') return;
    let cleanup: (() => void) | null = null;

    window.conchitour.wizardStartServer().then(({ port, lanUrl: url }) => {
      const displayUrl = url ?? `http://localhost:${port}`;
      setLanUrl(displayUrl);
      if (url) {
        QRCode.toDataURL(url, { width: 200, margin: 1 }).then(setQrDataUrl).catch(() => {});
      }
      cleanup = window.conchitour.onWizardMobileAnswers((rawAnswers) => {
        // Phone sends old-format answers — map to new fields
        const a = rawAnswers as {
          loc?: string; aud?: string[]; tone?: string; cats?: string[]; color?: string;
        };
        if (a.loc) setVenue(a.loc);
        if (a.aud) setAudience(a.aud);
        if (a.tone) setToneKey(a.tone);
        if (a.cats) setSpaces(a.cats);
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

  // Final AI generation
  useEffect(() => {
    if (step !== 'generating') return;

    const eff = analysis;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError('');

    // Resolve space label strings for the prompt
    const spaceLabels = spaces.map((k) => {
      const opt = eff?.spaceOptions.find((o) => o.key === k);
      return opt ? opt.label : k;
    });

    const typeLabels = projectType.map((k) => {
      const opt = eff?.typeOptions.find((o) => o.key === k);
      return opt ? opt.label : k;
    });

    const audienceLabels = audience.map((k) => {
      const opt = eff?.audienceOptions.find((o) => o.key === k);
      return opt ? opt.label : k;
    });

    const prompt = buildFinalPrompt(
      venue,
      eff,
      typeLabels,
      projectTypeFree,
      audienceLabels,
      audienceFree,
      spaceLabels,
      spacesFree,
      toneKey,
      extras,
    );

    callAiStreaming(apiProvider, apiKey, prompt, null, ctrl.signal, () => {})
      .then(({ text }) => {
        const parsed = parseJsonFromText(text);
        const defaultLang = (parsed['defaultLang'] as string) ?? (eff?.detectedLang ?? 'en');

        // Build categories from selected spaces
        const cats: SummaryCat[] = (
          spaces.length > 0
            ? spaces.map((k, i) => {
                const opt = eff?.spaceOptions.find((o) => o.key === k);
                return { slug: k, name: opt?.label ?? k, color: opt?.color ?? pickColor(i) };
              })
            : (eff?.spaceOptions.slice(0, 3) ?? []).map((o, i) => ({
                slug: o.key, name: o.label, color: o.color ?? pickColor(i),
              }))
        );

        if (spacesFree.trim()) {
          cats.push({ slug: uuid().slice(0, 8), name: spacesFree.trim(), color: pickColor(cats.length) });
        }

        const selectedToneOpt = eff?.toneOptions.find((o) => o.key === toneKey);
        const aiTone: WizardSummary['aiTone'] = selectedToneOpt?.aiTone ?? 'marketing';

        setSummary({
          projectName: (parsed['projectName'] as string) ?? (venue.split(',')[0].trim() || 'My Tour'),
          defaultLang,
          extraLanguages: ((parsed['extraLanguages'] as string[]) ?? []).filter((l) => l !== defaultLang).slice(0, 4),
          categories: cats,
          accentColor: color,
          contextPrompt: (parsed['contextPrompt'] as string) ?? '',
          aiTone,
        });
        setStep('summary');
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setError('AI generation failed — using defaults.');
          const defaultLang = eff?.detectedLang ?? 'en';
          setSummary({
            projectName: (venue.split(',')[0].trim() || 'My Tour'),
            defaultLang,
            extraLanguages: defaultLang === 'en' ? ['fr'] : ['en'],
            categories: (eff?.spaceOptions.slice(0, 3) ?? []).map((o, i) => ({
              slug: o.key, name: o.label, color: o.color ?? pickColor(i),
            })),
            accentColor: color,
            contextPrompt: '',
            aiTone: 'marketing',
          });
          setStep('summary');
        }
      });

    return () => ctrl.abort();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Handlers ────────────────────────────────────────────────────────────────

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

      const proj: Project = buildDefaultProject();
      proj.meta.name = summary.projectName;
      proj.languages.default = summary.defaultLang;
      proj.languages.available = [summary.defaultLang, ...summary.extraLanguages];
      proj.branding.accentColor = summary.accentColor;
      proj.branding.introText = Object.fromEntries(
        proj.languages.available.map((l) => [l, ''])
      );

      const customCats: Category[] = summary.categories.map((c) => ({
        id: uuid(),
        slug: c.slug,
        name: { [summary.defaultLang]: c.name },
        color: c.color,
      }));
      proj.categories = [...BUILTIN_CATEGORIES, ...customCats];

      proj.aiContext = {
        tone: summary.aiTone,
        audience: 'general',
        theme: 'Tourism',
        length: 'medium',
        projectContext: summary.contextPrompt,
        tokensUsed: { claude: { in: 0, out: 0 }, gpt: { in: 0, out: 0 } },
      };

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
    if (step === 'api-key' && initialStep === 'api-key') { onClose(); return; }
    const prev: Partial<Record<WizardStep, WizardStep>> = {
      'quick-name':   'mode-select',
      'api-key':      'mode-select',
      routing:        'api-key',
      venue:          'routing',
      'project-type': 'venue',
      audience:       'project-type',
      spaces:         'audience',
      tone:           'spaces',
      extras:         'tone',
      summary:        'extras',
      'qr-waiting':   'routing',
    };
    const target = prev[step];
    if (target) setStep(target);
  }, [step, initialStep, onClose]);

  const canAdvance = useCallback(() => {
    if (step === 'venue') return venue.trim().length > 3;
    if (step === 'project-type') return projectType.length > 0 || projectTypeFree.trim().length > 2;
    if (step === 'audience') return audience.length > 0 || audienceFree.trim().length > 2;
    if (step === 'tone') return toneKey !== '';
    if (step === 'api-key') return apiKey.trim().length > 10;
    return true;
  }, [step, venue, projectType, projectTypeFree, audience, audienceFree, toneKey, apiKey]);

  const advance = useCallback(() => {
    const next: Partial<Record<WizardStep, WizardStep>> = {
      venue:          'analyzing',
      'project-type': 'audience',
      audience:       'spaces',
      spaces:         'tone',
      tone:           'extras',
      extras:         'generating',
    };
    const target = next[step];
    if (target) setStep(target);
  }, [step]);

  const toggleMulti = useCallback((arr: string[], key: string): string[] =>
    arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key], []);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const currentAnalysis = analysis ?? FALLBACK_ANALYSIS;
  const showBack = !['mode-select', 'analyzing', 'generating', 'summary'].includes(step);
  const showNext = ['venue', 'project-type', 'audience', 'spaces', 'tone', 'extras'].includes(step);
  const stepNum: Partial<Record<WizardStep, string>> = {
    venue: 'Step 1 of 6', 'project-type': 'Step 2 of 6', audience: 'Step 3 of 6',
    spaces: 'Step 4 of 6', tone: 'Step 5 of 6', extras: 'Step 6 of 6',
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg bg-paper rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0">
          <div className="flex items-center gap-2">
            {!['mode-select', 'quick-name'].includes(step) && (
              <Sparkles size={16} className="text-accent" />
            )}
            <span className="text-sm font-semibold text-ink-base">
              {step === 'mode-select' ? 'New project' : 'AI project setup'}
            </span>
            {stepNum[step] && (
              <span className="text-xs text-ink-faded ml-1">{stepNum[step]}</span>
            )}
          </div>
          <button onClick={onClose} className="text-ink-faded hover:text-ink-base transition-colors">
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
                <p className="text-sm text-ink-soft mt-1">Quick setup takes 10 seconds. AI setup configures everything from your venue description.</p>
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
                    <div className="text-xs text-ink-faded mt-0.5">Describe your venue — AI configures everything</div>
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
                  Your key is stored in this project only, never sent to our servers.
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
                     keyTestState === 'ok' ? <Check size={12} /> : 'Test'}
                  </button>
                </div>
                {keyTestState === 'error' && (
                  <p className="text-xs text-red-400">{keyTestError || 'Connection failed — check your key'}</p>
                )}
                {keyTestState === 'ok' && <p className="text-xs text-emerald-400">Connected ✓</p>}
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
                <p className="text-sm text-ink-soft mt-1">A few open questions to configure your tour automatically.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setStep('venue')}
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
                    <div className="text-xs text-ink-faded mt-0.5">Scan QR, dictate on mobile</div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ── Step 1: Venue ── */}
          {step === 'venue' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">Describe your venue</h2>
                <p className="text-sm text-ink-soft mt-1">
                  City, type, ambiance — the more detail, the more precise the AI configuration.
                </p>
              </div>
              <div className="flex gap-2 items-start">
                <textarea
                  autoFocus
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                  placeholder="e.g. A surf school in Hossegor, France, with a laid-back ocean vibe and lessons for all levels · Château de Versailles, historic palace near Paris · Luxury boutique hotel in downtown Tokyo with rooftop bar"
                  rows={4}
                  className="flex-1 bg-paper-strong border border-line-soft rounded-lg px-3 py-2.5 text-sm text-ink-base placeholder-ink-faded focus:outline-none focus:border-accent resize-none"
                />
                <MicButton
                  onTranscript={(text) => setVenue((v) => (v ? v + ' ' : '') + text)}
                  lang="en-US"
                />
              </div>
              <p className="text-xs text-ink-faded">AI will analyze the location to suggest relevant types, audiences, spaces, and tone.</p>
            </div>
          )}

          {/* ── Analyzing ── */}
          {step === 'analyzing' && (
            <div className="flex flex-col items-center justify-center gap-5 py-12">
              <div className="relative">
                <Sparkles size={32} className="text-accent" />
                <div className="absolute inset-0 animate-ping rounded-full bg-accent/20" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-ink-base">Analyzing your venue{generatingDots}</p>
                <p className="text-xs text-ink-soft mt-1">Detecting location, context, and relevant options</p>
              </div>
            </div>
          )}

          {/* ── Step 2: Project type ── */}
          {step === 'project-type' && (
            <div className="space-y-5">
              {analysisError && (
                <p className="text-xs text-amber-400">{analysisError}</p>
              )}
              <div>
                <h2 className="text-xl font-semibold text-ink-base">What type of venue is this?</h2>
                {analysis?.venueSummary && (
                  <p className="text-xs text-ink-faded mt-1 italic">{analysis.venueSummary}</p>
                )}
                <p className="text-sm text-ink-soft mt-1">Select one or more, or describe it yourself.</p>
              </div>
              <DynamicChipsInput
                options={currentAnalysis.typeOptions}
                selected={projectType}
                onToggle={(key) => setProjectType(toggleMulti(projectType, key))}
                freeText={projectTypeFree}
                onFreeTextChange={setProjectTypeFree}
                placeholder="Or describe it in your own words…"
                speechLang={speechLang}
              />
            </div>
          )}

          {/* ── Step 3: Audience ── */}
          {step === 'audience' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">Who are your visitors?</h2>
                <p className="text-sm text-ink-soft mt-1">Select all that apply — influences language selection and tone.</p>
              </div>
              <DynamicChipsInput
                options={currentAnalysis.audienceOptions}
                selected={audience}
                onToggle={(key) => setAudience(toggleMulti(audience, key))}
                freeText={audienceFree}
                onFreeTextChange={setAudienceFree}
                placeholder="Other audience…"
                speechLang={speechLang}
              />
            </div>
          )}

          {/* ── Step 4: Spaces ── */}
          {step === 'spaces' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">Which areas will you include?</h2>
                <p className="text-sm text-ink-soft mt-1">These become your tour categories. Add custom areas in the text field.</p>
              </div>
              <DynamicChipsInput
                options={currentAnalysis.spaceOptions}
                selected={spaces}
                onToggle={(key) => setSpaces(toggleMulti(spaces, key))}
                freeText={spacesFree}
                onFreeTextChange={setSpacesFree}
                placeholder="Other area (e.g. rooftop bar, wine cellar…)"
                speechLang={speechLang}
              />
              {spaces.length > 0 && (
                <p className="text-xs text-ink-faded">{spaces.length} area{spaces.length > 1 ? 's' : ''} selected</p>
              )}
            </div>
          )}

          {/* ── Step 5: Tone ── */}
          {step === 'tone' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">What's the editorial tone?</h2>
                <p className="text-sm text-ink-soft mt-1">Shapes all AI-generated text. Examples below are tailored to your venue.</p>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {currentAnalysis.toneOptions.map((t) => {
                  const sel = toneKey === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setToneKey(t.key)}
                      className={clsx(
                        'text-left px-4 py-3 rounded-lg border transition-all',
                        sel ? 'border-accent bg-accent/10' : 'border-line bg-paper-strong hover:border-ink-soft',
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {t.icon && <span>{t.icon}</span>}
                        <span className={clsx('text-sm font-semibold', sel ? 'text-accent' : 'text-ink-base')}>
                          {t.label}
                        </span>
                        {sel && <Check size={12} className="ml-auto text-accent" />}
                      </div>
                      {t.example && (
                        <p className="text-xs text-ink-faded line-clamp-2">"{t.example}"</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Step 6: Extras ── */}
          {step === 'extras' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">Anything else to add?</h2>
                <p className="text-sm text-ink-soft mt-1">
                  Optional — special selling points, accessibility features, seasonal info, brand guidelines, etc.
                </p>
              </div>
              <div className="flex gap-2 items-start">
                <textarea
                  autoFocus
                  value={extras}
                  onChange={(e) => setExtras(e.target.value)}
                  placeholder="e.g. Eco-certified hotel with organic restaurant · Pet-friendly · Runs June–September only · Multilingual staff · Award-winning architecture by Renzo Piano…"
                  rows={4}
                  className="flex-1 bg-paper-strong border border-line-soft rounded-lg px-3 py-2.5 text-sm text-ink-base placeholder-ink-faded focus:outline-none focus:border-accent resize-none"
                />
                <MicButton
                  onTranscript={(text) => setExtras((v) => (v ? v + ' ' : '') + text)}
                  lang={speechLang}
                />
              </div>
              <p className="text-xs text-ink-faded">Leave empty to skip — AI will use the venue context alone.</p>

              {/* Accent color */}
              <div className="space-y-1.5">
                <label className="text-xs text-ink-faded uppercase tracking-wide font-medium">Accent color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-10 h-10 rounded-lg border border-line cursor-pointer bg-transparent"
                  />
                  <div>
                    <div className="text-xs font-mono text-ink-soft">{color.toUpperCase()}</div>
                    {analysis?.accentColorSuggestion && color !== analysis.accentColorSuggestion && (
                      <button
                        onClick={() => setColor(analysis.accentColorSuggestion)}
                        className="text-xs text-ink-faded hover:text-accent transition-colors mt-0.5"
                      >
                        ← restore AI suggestion ({analysis.accentColorSuggestion.toUpperCase()})
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
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
                <p className="text-xs text-ink-soft mt-1">Deducing languages, generating AI context, setting up categories</p>
              </div>
            </div>
          )}

          {/* ── QR waiting ── */}
          {step === 'qr-waiting' && (
            <div className="flex flex-col items-center gap-5 py-4">
              <div>
                <h2 className="text-xl font-semibold text-ink-base text-center">Scan to answer on your phone</h2>
                <p className="text-sm text-ink-soft mt-1 text-center">
                  Same Wi-Fi network required. Voice dictation available on mobile.
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
                <p className="text-xs font-mono text-ink-faded bg-paper-strong px-3 py-1.5 rounded">{lanUrl}</p>
              )}
              <div className="flex items-center gap-2 text-xs text-ink-faded">
                <Loader2 size={12} className="animate-spin" />
                Waiting for response from phone…
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
                  <label className="text-xs text-ink-faded uppercase tracking-wide font-semibold">Tour categories</label>
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

          {/* Quick mode */}
          {step === 'quick-name' && (
            <div className="flex gap-2">
              <button onClick={() => setStep('mode-select')} className="px-4 py-2 text-sm text-ink-soft hover:text-ink-base transition-colors">
                <ArrowLeft size={14} className="inline mr-1" />Back
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

          {/* API key */}
          {step === 'api-key' && (
            <div className="flex gap-2">
              <button onClick={goBack} className="px-4 py-2 text-sm text-ink-soft hover:text-ink-base transition-colors">
                <ArrowLeft size={14} className="inline mr-1" />Back
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
              <ArrowLeft size={14} className="inline mr-1" />Back
            </button>
          )}

          {/* Steps with Next */}
          {showNext && (
            <div className="flex gap-2">
              <button onClick={goBack} className="px-4 py-2 text-sm text-ink-soft hover:text-ink-base transition-colors">
                <ArrowLeft size={14} className="inline mr-1" />Back
              </button>
              <button
                onClick={advance}
                disabled={!canAdvance()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                {step === 'extras' ? 'Generate' : 'Next'} <ArrowRight size={14} />
              </button>
            </div>
          )}

          {/* QR cancel */}
          {step === 'qr-waiting' && (
            <button onClick={goBack} className="w-full py-2 text-sm text-ink-soft hover:text-ink-base transition-colors">
              <ArrowLeft size={14} className="inline mr-1" />Back to routing
            </button>
          )}

          {/* Summary apply */}
          {step === 'summary' && summary && (
            <button
              onClick={applySummary}
              disabled={applying || !summary.projectName.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              {applying ? (
                <><Loader2 size={14} className="animate-spin" />Creating project…</>
              ) : (
                <><Check size={14} />Apply configuration</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
