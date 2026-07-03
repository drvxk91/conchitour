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
import type { Project, Category, AiContext } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep =
  | 'mode-select' | 'quick-name' | 'api-key' | 'routing'
  | 'venue' | 'analyzing'
  | 'project-type' | 'client-type' | 'client-info' | 'goal' | 'audience' | 'spaces' | 'capture' | 'tone' | 'extras'
  | 'generating' | 'summary' | 'qr-waiting';

interface DynamicOption {
  key: string;
  label: string;
  icon?: string;
  color?: string;
  example?: string;
}

interface VenueAnalysis {
  location: string;
  detectedLang: string;
  venueSummary: string;
  typeOptions: DynamicOption[];
  audienceOptions: DynamicOption[];
  spaceOptions: DynamicOption[];
  accentColorSuggestion: string;
}

interface SummaryCat {
  slug: string;
  name: string;
  color: string;
  icon?: string;
}

interface WizardSummary {
  projectName: string;
  defaultLang: string;
  extraLanguages: string[];
  categories: SummaryCat[];
  accentColor: string;
  contextPrompt: string;
  aiTone: 'marketing' | 'factual' | 'storytelling' | 'poetic' | 'educational';
  // Client info
  clientName?: string;
  logoNativePath?: string;
  // AiContext derivation helpers
  audienceKeys: string[];
  projectTypeKeys: string[];
  clientTypeKeys: string[];
  projectTypeFreeText: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLOR_PALETTE = ['#185FA5', '#8B5CF6', '#1D9E75', '#BA7517', '#0EA5E9', '#F59E0B', '#EF4444', '#EC4899'];
function pickColor(i: number) { return COLOR_PALETTE[i % COLOR_PALETTE.length]; }

/** Wrap an emoji in a minimal SVG for Category.iconSvg */
function emojiToIconSvg(emoji: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="26" font-size="26">${emoji}</text></svg>`;
}

/** 27 fallback venue types — AI generates contextual ones; these are the safety net */
const FALLBACK_TYPE_OPTIONS: DynamicOption[] = [
  { key: 'hotel',       label: 'Hotel / Resort',        icon: '🏨', example: 'Rooms, restaurant, spa, pool…' },
  { key: 'bnb',         label: 'B&B / Guesthouse',      icon: '🛏️', example: 'Cozy rooms, shared spaces…' },
  { key: 'villa',       label: 'Villa / Holiday home',   icon: '🏖️', example: 'Private rental, luxury stay…' },
  { key: 'apartment',   label: 'Apartment / Flat',       icon: '🏢', example: 'For sale or rent listing…' },
  { key: 'house',       label: 'House / Property',       icon: '🏡', example: 'Single-family home for sale…' },
  { key: 'real-estate', label: 'Real estate agency',     icon: '🔑', example: 'Multiple properties showcase…' },
  { key: 'restaurant',  label: 'Restaurant',             icon: '🍽️', example: 'Dining room, bar, terrace…' },
  { key: 'bar',         label: 'Bar / Nightclub',        icon: '🍸', example: 'Ambiance, dance floor, VIP…' },
  { key: 'cafe',        label: 'Café / Bakery',          icon: '☕', example: 'Counter, seating, kitchen…' },
  { key: 'shop',        label: 'Shop / Boutique',        icon: '🛍️', example: 'Clothing, accessories…' },
  { key: 'mall',        label: 'Shopping center',        icon: '🏬', example: 'Galleries, food court, parking…' },
  { key: 'showroom',    label: 'Showroom',               icon: '✨', example: 'Furniture, design, luxury goods…' },
  { key: 'car-dealer',  label: 'Car dealership',         icon: '🚗', example: 'Exhibition floor, models display…' },
  { key: 'office',      label: 'Office / Coworking',     icon: '💼', example: 'Open space, meeting rooms…' },
  { key: 'corporate',   label: 'Corporate HQ',           icon: '🏛️', example: 'Reception, floors, facilities…' },
  { key: 'industrial',  label: 'Factory / Industrial',   icon: '🏭', example: 'Production lines, warehouses…' },
  { key: 'museum',      label: 'Museum / Gallery',       icon: '🖼️', example: 'Exhibitions, collections, garden…' },
  { key: 'school',      label: 'School / University',    icon: '🎓', example: 'Classrooms, campus, labs…' },
  { key: 'library',     label: 'Library',                icon: '📚', example: 'Reading rooms, archives…' },
  { key: 'heritage',    label: 'Heritage site',          icon: '🏰', example: 'Château, castle, monument…' },
  { key: 'attraction',  label: 'Tourist attraction',     icon: '🗺️', example: 'Park, landmark, theme…' },
  { key: 'spa',         label: 'Spa / Wellness',         icon: '💆', example: 'Treatment rooms, pool, sauna…' },
  { key: 'gym',         label: 'Gym / Sports',           icon: '🏋️', example: 'Equipment, studios, pool…' },
  { key: 'clinic',      label: 'Clinic / Hospital',      icon: '🏥', example: 'Consultation rooms, ward…' },
  { key: 'venue',       label: 'Event venue',            icon: '🎪', example: 'Main hall, garden, catering…' },
  { key: 'government',  label: 'Public / Government',    icon: '🏛️', example: 'City hall, public spaces…' },
  { key: 'sports',      label: 'Stadium / Arena',        icon: '🏟️', example: 'Stands, field, facilities…' },
];

const FALLBACK_ANALYSIS: VenueAnalysis = {
  location: '', detectedLang: 'en', venueSummary: '',
  typeOptions: FALLBACK_TYPE_OPTIONS.slice(0, 8),
  audienceOptions: [
    { key: 'tourists',  label: 'International tourists', icon: '✈️' },
    { key: 'locals',    label: 'Local visitors',         icon: '📍' },
    { key: 'business',  label: 'Business professionals', icon: '💼' },
    { key: 'families',  label: 'Families',               icon: '👨‍👩‍👧' },
    { key: 'luxury',    label: 'Luxury clientele',       icon: '💎' },
    { key: 'students',  label: 'Students / youth',       icon: '🎓' },
    { key: 'buyers',    label: 'Potential buyers',       icon: '🔑' },
    { key: 'partners',  label: 'Business partners',      icon: '🤝' },
  ],
  spaceOptions: [
    { key: 'main-area', label: 'Main Area',        icon: '🏠', color: '#185FA5' },
    { key: 'entrance',  label: 'Entrance',         icon: '🚪', color: '#BA7517' },
    { key: 'garden',    label: 'Garden / Outdoor', icon: '🌿', color: '#1D9E75' },
    { key: 'lounge',    label: 'Lounge',           icon: '🛋️', color: '#8B5CF6' },
    { key: 'terrace',   label: 'Terrace',          icon: '☀️', color: '#F59E0B' },
  ],
  accentColorSuggestion: '#1D9E75',
};

/** Who commissioned the tour */
const CLIENT_TYPES: DynamicOption[] = [
  { key: 'individual',  label: 'Private individual',      icon: '👤', example: 'Homeowner, private seller, collector' },
  { key: 'sme',         label: 'Small business',          icon: '🏪', example: 'Restaurant, boutique, artisan, studio' },
  { key: 'hotel',       label: 'Hotel / Hospitality',     icon: '🏨', example: 'Hotel chain, resort, B&B group' },
  { key: 'real-estate', label: 'Real estate agency',      icon: '🔑', example: 'Agency, developer, property promoter' },
  { key: 'tourism',     label: 'Tourism & culture',       icon: '🗺️', example: 'Museum, tourism board, heritage org' },
  { key: 'corporate',   label: 'Corporate enterprise',    icon: '🏢', example: 'Headquarters, campus, multi-site group' },
  { key: 'public',      label: 'Public institution',      icon: '🏛️', example: 'Government, school, hospital' },
  { key: 'events',      label: 'Events & venues',         icon: '🎪', example: 'Wedding venue, conference center' },
];

/** What the virtual tour should achieve */
const TOUR_GOALS: DynamicOption[] = [
  { key: 'drive-traffic',  label: 'Drive tourism & visits',       icon: '📍', example: 'Attract visitors, boost footfall' },
  { key: 'convert',        label: 'Generate bookings & sales',    icon: '💰', example: 'Reservations, purchases, leads' },
  { key: 'showcase-b2b',   label: 'Attract events & partners',    icon: '🤝', example: 'B2B showcase, venue hire enquiries' },
  { key: 'remote-preview', label: 'Remote preview',               icon: '🌍', example: 'Real estate, relocation, pre-arrival' },
  { key: 'storytelling',   label: 'Brand & heritage storytelling',icon: '✨', example: 'Prestige, emotional connection, values' },
  { key: 'education',      label: 'Education & training',         icon: '🎓', example: 'Staff onboarding, visitor education' },
  { key: 'documentation',  label: 'Documentation & compliance',   icon: '📋', example: 'As-built record, insurance, audit' },
  { key: 'press-pr',       label: 'Press & media kit',            icon: '📰', example: 'Journalist preview, editorial use' },
];

/** Capture equipment */
const CAPTURE_EQUIP: DynamicOption[] = [
  { key: 'smartphone',   label: 'Smartphone',        icon: '📱', example: 'iOS / Android' },
  { key: 'action-cam',   label: 'Action cam',        icon: '🎬', example: 'GoPro, DJI Action…' },
  { key: 'dslr',         label: 'DSLR / Mirrorless', icon: '📷', example: 'With fisheye or standard lens' },
  { key: '360-consumer', label: '360° Camera',       icon: '🔵', example: 'Ricoh Theta, Insta360, GoPro Max' },
  { key: '360-pro',      label: 'Pro 360° rig',      icon: '⚡', example: 'Matterport, custom multi-cam' },
  { key: 'drone',        label: 'Drone',             icon: '🚁', example: 'Aerial / exterior footage' },
  { key: 'video',        label: 'Video camera',      icon: '🎥', example: 'Cinema, broadcast…' },
];

const CAPTURE_SETTING: DynamicOption[] = [
  { key: 'indoor',  label: 'Indoor only',          icon: '🏠', example: 'Inside a building' },
  { key: 'outdoor', label: 'Outdoor only',          icon: '🌿', example: 'Exterior, garden, landscape' },
  { key: 'mixed',   label: 'Both indoor & outdoor', icon: '🔄' },
];

/** Tone inspiration starters */
const TONE_STARTERS = [
  'Warm and welcoming, like a knowledgeable local guide sharing their favourite spots.',
  'Prestigious and sophisticated, highlighting exceptional craftsmanship and exclusivity.',
  'Informative and precise — facts, dates, dimensions — let the place speak for itself.',
  'Inspiring and immersive, making visitors feel as if they\'re already there.',
  'Commercial and persuasive, focusing on benefits and inviting visitors to book or buy.',
  'Educational and clear, accessible to all ages and backgrounds.',
];

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
  if (match) { try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { /* fall through */ } }
  return {};
}

function buildAnalysisPrompt(venue: string): string {
  return `You are configuring a virtual-tour app. Analyze this venue description and return contextual options.

VENUE: "${venue}"

Return ONLY valid JSON (no markdown fences):
{
  "location": "<city/place name extracted>",
  "detectedLang": "<BCP47: Dubai/Abu Dhabi→ar, Paris→fr, Tokyo→ja, Madrid→es, Berlin→de, Rome→it, London/NY→en>",
  "venueSummary": "<1-2 sentence description>",
  "typeOptions": [
    {"key": "slug", "label": "Name", "icon": "emoji", "example": "Short description"}
  ],
  "audienceOptions": [
    {"key": "slug", "label": "Name", "icon": "emoji"}
  ],
  "spaceOptions": [
    {"key": "slug", "label": "Area name", "icon": "emoji", "color": "#hexcolor", "example": "What visitors see here"}
  ],
  "accentColorSuggestion": "#hexcolor"
}

Rules:
- typeOptions: 4-6 options SPECIFIC to this location (Dubai hotel→luxury suites/rooftop bar/infinity pool/spa/ballroom; Dubai mall→flagship store/food court/entertainment zone/luxury brand; Paris museum→permanent collection/temporary exhibition/sculpture garden; Tokyo restaurant→sushi counter/private dining/sake bar)
- audienceOptions: 4-6 realistic visitor profiles for THIS venue
- spaceOptions: 5-8 actual physical areas at this specific venue — match the real place. Each space MUST have an emoji icon that fits it (pool→🏊, lobby→🛋️, restaurant→🍽️, terrace→☀️, gym→🏋️, spa→💆, suite→🛏️, garden→🌿)
- accentColorSuggestion: match the venue identity (ocean/pool→#0EA5E9, desert/gold→#BA7517, forest/eco→#1D9E75, luxury/purple→#8B5CF6)

IMPORTANT: Respond in English only, regardless of the venue location or language.`;
}

function buildFinalPrompt(
  venue: string, analysis: VenueAnalysis | null,
  projectType: string[], projectTypeFree: string,
  clientType: string[], clientTypeFree: string,
  clientName: string,
  goal: string[], goalFree: string,
  audience: string[], audienceFree: string,
  spaces: string[], spacesFree: string,
  captureEquip: string[], captureSetting: string[],
  toneText: string,
  extras: string,
): string {
  const resolve = (keys: string[], opts: DynamicOption[]) =>
    keys.map((k) => opts.find((o) => o.key === k)?.label ?? k).join(', ');

  return `Configure a virtual tour project based on these answers:

VENUE: "${venue}"
${analysis ? `VENUE CONTEXT: "${analysis.venueSummary}"\n` : ''}VENUE TYPE: ${resolve(projectType, analysis?.typeOptions ?? []) + (projectTypeFree ? ` + "${projectTypeFree}"` : '') || 'General'}
CLIENT: ${(clientName ? `${clientName} — ` : '') + resolve(clientType, CLIENT_TYPES) + (clientTypeFree ? ` + "${clientTypeFree}"` : '') || 'Not specified'}
TOUR OBJECTIVE: ${resolve(goal, TOUR_GOALS) + (goalFree ? ` + "${goalFree}"` : '') || 'Not specified'}
AUDIENCE: ${resolve(audience, analysis?.audienceOptions ?? []) + (audienceFree ? ` + "${audienceFree}"` : '') || 'General public'}
SPACES: ${resolve(spaces, analysis?.spaceOptions ?? []) + (spacesFree ? ` + "${spacesFree}"` : '') || 'To be defined'}
EQUIPMENT: ${resolve(captureEquip, CAPTURE_EQUIP) || 'Not specified'}
SETTING: ${resolve(captureSetting, CAPTURE_SETTING) || 'Not specified'}
EDITORIAL VOICE: "${toneText || 'Professional and welcoming'}"
EXTRA NOTES: ${extras || 'None'}

Return ONLY valid JSON (no markdown fences):
{
  "projectName": "<short descriptive name, max 35 chars>",
  "defaultLang": "<BCP47 of venue's primary language>",
  "extraLanguages": ["<code>"],
  "aiTone": "<one of: marketing | factual | storytelling | poetic | educational>",
  "contextPrompt": "<3-4 sentences starting 'You are writing for...' — specific AI instruction incorporating the client type, tour objective, and editorial voice described above>"
}

Rules:
- projectName: concise, reflects the actual venue (not generic)
- defaultLang: match venue country (Dubai→ar, Paris→fr, Tokyo→ja)
- extraLanguages: include 'en' unless defaultLang; consider audience (Chinese tourists→zh, German market→de, luxury/international→fr); max 4 extra
- aiTone: best fit for the described editorial voice (marketing=persuasive, factual=informative/precise, storytelling=immersive, poetic=lyrical/luxury, educational=pedagogic)
- contextPrompt: weave in the actual objectives and tone — make it genuinely useful for AI content generation

IMPORTANT: Respond in English only, regardless of the venue location or language.`;
}

// ─── AiContext mapping tables ─────────────────────────────────────────────────

const AUDIENCE_TO_AI: Record<string, AiContext['audience']> = {
  luxury: 'luxury', business: 'professional', partners: 'professional',
  buyers: 'professional', students: 'youth', families: 'family',
  tourists: 'general', locals: 'general',
};

const TYPE_TO_THEME: Record<string, string> = {
  hotel: 'Hotel & Hospitality', bnb: 'Hotel & Hospitality',
  villa: 'Vacation Rental', apartment: 'Real Estate', house: 'Real Estate',
  'real-estate': 'Real Estate', restaurant: 'Food & Beverage',
  bar: 'Food & Beverage', cafe: 'Food & Beverage', shop: 'Retail',
  mall: 'Retail', showroom: 'Showroom', 'car-dealer': 'Automotive',
  office: 'Office & Workspace', corporate: 'Corporate', industrial: 'Industrial',
  museum: 'Museum & Culture', school: 'Education', library: 'Education',
  heritage: 'Heritage & Tourism', attraction: 'Tourism', spa: 'Wellness',
  gym: 'Sports & Wellness', clinic: 'Healthcare', venue: 'Events & Venues',
  government: 'Public Institution', sports: 'Sports & Entertainment',
};

const CLIENT_TO_THEME: Record<string, string> = {
  hotel: 'Hotel & Hospitality', 'real-estate': 'Real Estate',
  tourism: 'Tourism & Culture', corporate: 'Corporate',
  public: 'Public Institution', events: 'Events & Venues',
  sme: 'Small Business', individual: 'Private',
};

// ─── Color extraction from image (renderer Canvas API) ────────────────────────

function extractColorsFromImageBlob(objectUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 120; canvas.height = 120;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve([]); return; }
      ctx.drawImage(img, 0, 0, 120, 120);
      const { data } = ctx.getImageData(0, 0, 120, 120);
      const colorMap = new Map<string, number>();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 128) continue;
        const lum = (r * 299 + g * 587 + b * 114) / 1000;
        if (lum > 230 || lum < 15) continue;
        if (Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b)) < 25) continue;
        const rq = Math.round(r / 16) * 16, gq = Math.round(g / 16) * 16, bq = Math.round(b / 16) * 16;
        const hex = '#' + [rq, gq, bq].map((v) => v.toString(16).padStart(2, '0')).join('');
        colorMap.set(hex, (colorMap.get(hex) ?? 0) + 1);
      }
      const top = [...colorMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h]) => h.toUpperCase());
      resolve(top);
    };
    img.onerror = () => resolve([]);
    img.src = objectUrl;
  });
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
    <button type="button" onClick={toggle} title={listening ? 'Stop dictation' : 'Dictate answer'}
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

// ─── DynamicChipsInput ────────────────────────────────────────────────────────

interface ChipsInputProps {
  options: DynamicOption[];
  selected: string[];
  onToggle: (key: string) => void;
  freeText: string;
  onFreeTextChange: (v: string) => void;
  placeholder: string;
  speechLang?: string;
}

function DynamicChipsInput({ options, selected, onToggle, freeText, onFreeTextChange, placeholder, speechLang = 'en-US' }: ChipsInputProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const sel = selected.includes(opt.key);
          return (
            <button key={opt.key} type="button" onClick={() => onToggle(opt.key)} title={opt.example}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all',
                sel ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-paper-strong text-ink-soft hover:border-ink-soft hover:text-ink-base',
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
        <input type="text" value={freeText} onChange={(e) => onFreeTextChange(e.target.value)} placeholder={placeholder}
          className="flex-1 bg-paper-strong border border-line-soft rounded-lg px-3 py-2 text-sm text-ink-base placeholder-ink-faded focus:outline-none focus:border-accent"
        />
        <MicButton onTranscript={(text) => onFreeTextChange((freeText ? freeText + ' ' : '') + text)} lang={speechLang} />
      </div>
    </div>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

const PROGRESS_STEPS: WizardStep[] = [
  'venue', 'project-type', 'client-type', 'client-info', 'goal', 'audience', 'spaces', 'capture', 'tone', 'extras',
];

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

  // Step 1 — venue
  const [venue, setVenue] = useState('');

  // AI analysis
  const [analysis, setAnalysis] = useState<VenueAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState('');

  // Step 2 — project type
  const [projectType, setProjectType] = useState<string[]>([]);
  const [projectTypeFree, setProjectTypeFree] = useState('');

  // Step 3 — client type
  const [clientType, setClientType] = useState<string[]>([]);
  const [clientTypeFree, setClientTypeFree] = useState('');

  // Step 3b — client info
  const [clientName, setClientName] = useState('');
  const [clientWebsite, setClientWebsite] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoObjectUrl, setLogoObjectUrl] = useState<string | null>(null);
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const [fetchingBrandColors, setFetchingBrandColors] = useState(false);

  // Step 4 — goal
  const [goal, setGoal] = useState<string[]>([]);
  const [goalFree, setGoalFree] = useState('');

  // Step 5 — audience
  const [audience, setAudience] = useState<string[]>([]);
  const [audienceFree, setAudienceFree] = useState('');

  // Step 6 — spaces
  const [spaces, setSpaces] = useState<string[]>([]);
  const [spacesFree, setSpacesFree] = useState('');

  // Step 7 — capture
  const [captureEquip, setCaptureEquip] = useState<string[]>([]);
  const [captureSetting, setCaptureSetting] = useState<string[]>([]);

  // Step 8 — tone
  const [toneText, setToneText] = useState('');

  // Step 9 — extras
  const [extras, setExtras] = useState('');

  // Color
  const [color, setColor] = useState('#1D9E75');

  // Generation
  const [generatingDots, setGeneratingDots] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // Summary
  const [summary, setSummary] = useState<WizardSummary | null>(null);
  const [applying, setApplying] = useState(false);

  // QR
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [lanUrl, setLanUrl] = useState<string | null>(null);

  // Error
  const [error, setError] = useState('');

  const speechLang = analysis ? analysis.detectedLang + '-' + analysis.detectedLang.toUpperCase() : 'en-US';
  const currentAnalysis = analysis ?? FALLBACK_ANALYSIS;

  // ─── Effects ─────────────────────────────────────────────────────────────────

  // Animated dots
  useEffect(() => {
    if (step !== 'analyzing' && step !== 'generating') return;
    const interval = setInterval(() => setGeneratingDots((d) => (d.length >= 3 ? '' : d + '.')), 400);
    return () => clearInterval(interval);
  }, [step]);

  // AI venue analysis
  useEffect(() => {
    if (step !== 'analyzing') return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAnalysisError('');

    callAiStreaming(apiProvider, apiKey, buildAnalysisPrompt(venue), null, ctrl.signal, () => {})
      .then(({ text }) => {
        const parsed = parseJsonFromText(text);
        const result: VenueAnalysis = {
          location:              (parsed['location'] as string)              ?? venue.split(',')[0].trim(),
          detectedLang:          (parsed['detectedLang'] as string)          ?? 'en',
          venueSummary:          (parsed['venueSummary'] as string)          ?? '',
          typeOptions:           (parsed['typeOptions'] as DynamicOption[])  ?? FALLBACK_ANALYSIS.typeOptions,
          audienceOptions:       (parsed['audienceOptions'] as DynamicOption[]) ?? FALLBACK_ANALYSIS.audienceOptions,
          spaceOptions:          (parsed['spaceOptions'] as DynamicOption[]) ?? FALLBACK_ANALYSIS.spaceOptions,
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

  // QR code
  useEffect(() => {
    if (step !== 'qr-waiting') return;
    let cleanup: (() => void) | null = null;

    window.conchitour.wizardStartServer().then(({ port, lanUrl: url }) => {
      const displayUrl = url ?? `http://localhost:${port}`;
      setLanUrl(displayUrl);
      if (url) QRCode.toDataURL(url, { width: 200, margin: 1 }).then(setQrDataUrl).catch(() => {});
      cleanup = window.conchitour.onWizardMobileAnswers((rawAnswers) => {
        const a = rawAnswers as { loc?: string; aud?: string[]; tone?: string; cats?: string[]; color?: string };
        if (a.loc)   setVenue(a.loc);
        if (a.aud)   setAudience(a.aud);
        if (a.tone)  setToneText(a.tone);
        if (a.cats)  setSpaces(a.cats);
        if (a.color) setColor(a.color);
        window.conchitour.wizardStopServer();
        setStep('generating');
      });
    });

    return () => { cleanup?.(); window.conchitour.wizardStopServer(); };
  }, [step]);

  // Final AI generation
  useEffect(() => {
    if (step !== 'generating') return;
    const eff = analysis;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError('');

    const prompt = buildFinalPrompt(
      venue, eff,
      projectType, projectTypeFree,
      clientType, clientTypeFree,
      clientName,
      goal, goalFree,
      audience, audienceFree,
      spaces, spacesFree,
      captureEquip, captureSetting,
      toneText, extras,
    );
    const logoNativePath = logoFile ? window.conchitour.getPathForFile(logoFile) : undefined;

    callAiStreaming(apiProvider, apiKey, prompt, null, ctrl.signal, () => {})
      .then(({ text }) => {
        const parsed = parseJsonFromText(text);
        const defaultLang = (parsed['defaultLang'] as string) ?? (eff?.detectedLang ?? 'en');

        // Build categories from selected spaces, carrying over emoji icons
        const cats: SummaryCat[] = spaces.length > 0
          ? spaces.map((k, i) => {
              const opt = eff?.spaceOptions.find((o) => o.key === k);
              return { slug: k, name: opt?.label ?? k, color: opt?.color ?? pickColor(i), icon: opt?.icon };
            })
          : (eff?.spaceOptions.slice(0, 3) ?? []).map((o, i) => ({
              slug: o.key, name: o.label, color: o.color ?? pickColor(i), icon: o.icon,
            }));

        if (spacesFree.trim()) {
          cats.push({ slug: uuid().slice(0, 8), name: spacesFree.trim(), color: pickColor(cats.length) });
        }

        const rawAiTone = parsed['aiTone'] as string;
        const validTones = ['marketing', 'factual', 'storytelling', 'poetic', 'educational'] as const;
        const aiTone: WizardSummary['aiTone'] = validTones.includes(rawAiTone as typeof validTones[number])
          ? (rawAiTone as WizardSummary['aiTone'])
          : 'marketing';

        setSummary({
          projectName:    (parsed['projectName'] as string)     ?? (venue.split(',')[0].trim() || 'My Tour'),
          defaultLang,
          extraLanguages: ((parsed['extraLanguages'] as string[]) ?? []).filter((l) => l !== defaultLang).slice(0, 4),
          categories:     cats,
          accentColor:    color,
          contextPrompt:  (parsed['contextPrompt'] as string)   ?? '',
          aiTone,
          clientName:     clientName.trim() || undefined,
          logoNativePath,
          audienceKeys:   audience,
          projectTypeKeys: projectType,
          clientTypeKeys:  clientType,
          projectTypeFreeText: projectTypeFree,
        });
        setStep('summary');
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setError('AI generation failed — using defaults.');
          const defaultLang = eff?.detectedLang ?? 'en';
          setSummary({
            projectName:    (venue.split(',')[0].trim() || 'My Tour'),
            defaultLang,
            extraLanguages: defaultLang === 'en' ? ['fr'] : ['en'],
            categories:     (eff?.spaceOptions.slice(0, 3) ?? []).map((o, i) => ({
              slug: o.key, name: o.label, color: o.color ?? pickColor(i), icon: o.icon,
            })),
            accentColor:    color,
            contextPrompt:  '',
            aiTone:         'marketing',
            clientName:     clientName.trim() || undefined,
            logoNativePath,
            audienceKeys:   audience,
            projectTypeKeys: projectType,
            clientTypeKeys:  clientType,
            projectTypeFreeText: projectTypeFree,
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
      const result = apiProvider === 'claude' ? await testAiConnection(apiKey) : await testOpenAIConnection(apiKey);
      setKeyTestState(result.ok ? 'ok' : 'error');
      if (!result.ok) setKeyTestError(result.error ?? 'Connection failed');
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
      proj.meta.name            = summary.projectName;
      proj.languages.default    = summary.defaultLang;
      proj.languages.available  = [summary.defaultLang, ...summary.extraLanguages];
      proj.branding.accentColor = summary.accentColor;
      proj.branding.introText   = Object.fromEntries(proj.languages.available.map((l) => [l, '']));

      // Copy logo to project if provided
      if (summary.logoNativePath) {
        const newLogoPath = await window.conchitour.copySourceToProject(summary.logoNativePath);
        if (newLogoPath) proj.branding.logoPath = newLogoPath;
      }

      const customCats: Category[] = summary.categories.map((c) => ({
        id: uuid(),
        slug: c.slug,
        name: { [summary.defaultLang]: c.name },
        color: c.color,
        ...(c.icon ? { iconSvg: emojiToIconSvg(c.icon) } : {}),
      }));
      proj.categories = [...BUILTIN_CATEGORIES, ...customCats];

      // Derive AiContext audience from wizard selections
      const derivedAudience: AiContext['audience'] =
        summary.audienceKeys.map((k) => AUDIENCE_TO_AI[k]).find(Boolean) ?? 'general';

      // Derive AiContext theme from project type → client type → free text fallback
      const derivedTheme: string =
        (summary.projectTypeKeys[0] && TYPE_TO_THEME[summary.projectTypeKeys[0]]) ??
        (summary.clientTypeKeys[0] && CLIENT_TO_THEME[summary.clientTypeKeys[0]]) ??
        (summary.projectTypeFreeText.trim() || 'Virtual Tour');

      proj.aiContext = {
        tone: summary.aiTone,
        audience: derivedAudience,
        theme: derivedTheme,
        length: 'medium',
        projectContext: summary.contextPrompt,
        tokensUsed: { claude: { in: 0, out: 0 }, gpt: { in: 0, out: 0 } },
      };

      if (apiKey) {
        if (apiProvider === 'claude') { proj.modules.anthropicApiKey = apiKey; proj.modules.aiProvider = 'claude'; }
        else { proj.modules.openaiApiKey = apiKey; proj.modules.aiProvider = 'gpt'; }
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
      'client-type':  'project-type',
      'client-info':  'client-type',
      goal:           'client-info',
      audience:       'goal',
      spaces:         'audience',
      capture:        'spaces',
      tone:           'capture',
      extras:         'tone',
      summary:        'extras',
      'qr-waiting':   'routing',
    };
    const target = prev[step];
    if (target) setStep(target);
  }, [step, initialStep, onClose]);

  const canAdvance = useCallback(() => {
    if (step === 'venue')        return venue.trim().length > 3;
    if (step === 'project-type') return projectType.length > 0 || projectTypeFree.trim().length > 2;
    if (step === 'api-key')      return apiKey.trim().length > 10;
    // client-type, goal, audience, spaces, capture, tone, extras — all optional, always can advance
    return true;
  }, [step, venue, projectType, projectTypeFree, apiKey]);

  const advance = useCallback(() => {
    const next: Partial<Record<WizardStep, WizardStep>> = {
      venue:          'analyzing',
      'project-type': 'client-type',
      'client-type':  'client-info',
      'client-info':  'goal',
      goal:           'audience',
      audience:       'spaces',
      spaces:         'capture',
      capture:        'tone',
      tone:           'extras',
      extras:         'generating',
    };
    const target = next[step];
    if (target) setStep(target);
  }, [step]);

  const toggleMulti = useCallback((arr: string[], key: string): string[] =>
    arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key], []);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const showNext = [
    'venue', 'project-type', 'client-type', 'client-info', 'goal', 'audience', 'spaces', 'capture', 'tone', 'extras',
  ].includes(step);

  const stepNum: Partial<Record<WizardStep, string>> = {
    venue: 'Step 1 of 10', 'project-type': 'Step 2 of 10', 'client-type': 'Step 3 of 10',
    'client-info': 'Step 4 of 10', goal: 'Step 5 of 10', audience: 'Step 6 of 10',
    spaces: 'Step 7 of 10', capture: 'Step 8 of 10', tone: 'Step 9 of 10', extras: 'Step 10 of 10',
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg bg-paper rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0">
          <div className="flex items-center gap-2">
            {!['mode-select', 'quick-name'].includes(step) && <Sparkles size={16} className="text-accent" />}
            <span className="text-sm font-semibold text-ink-base">
              {step === 'mode-select' ? 'New project' : 'AI project setup'}
            </span>
            {stepNum[step] && <span className="text-xs text-ink-faded ml-1">{stepNum[step]}</span>}
          </div>
          <button onClick={onClose} className="text-ink-faded hover:text-ink-base transition-colors"><X size={16} /></button>
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
                <button onClick={() => setStep('api-key')}
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
              <input ref={quickNameRef} autoFocus value={quickName}
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
                <p className="text-sm text-ink-soft mt-1">Your key is stored in this project only, never sent to our servers.</p>
              </div>
              <div className="flex gap-2">
                {(['claude', 'gpt'] as const).map((p) => (
                  <button key={p} onClick={() => { setApiProvider(p); setKeyTestState('idle'); }}
                    className={clsx('flex-1 py-2 rounded-lg border text-sm font-medium transition-all',
                      apiProvider === p ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-paper-strong text-ink-soft hover:text-ink-base'
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
                  <input type="password" value={apiKey}
                    onChange={(e) => { setApiKey(e.target.value); setKeyTestState('idle'); }}
                    placeholder={apiProvider === 'claude' ? 'sk-ant-…' : 'sk-…'}
                    className="flex-1 bg-paper-strong border border-line-soft rounded-lg px-3 py-2 text-sm font-mono text-ink-base placeholder-ink-faded focus:outline-none focus:border-accent"
                  />
                  <button onClick={testKey} disabled={apiKey.length < 10 || keyTestState === 'testing'}
                    className={clsx('px-3 py-2 rounded-lg border text-xs font-medium shrink-0 transition-all disabled:opacity-40',
                      keyTestState === 'ok'      && 'border-emerald-500 bg-emerald-500/10 text-emerald-400',
                      keyTestState === 'error'   && 'border-red-500 bg-red-500/10 text-red-400',
                      keyTestState === 'idle'    && 'border-line bg-paper-strong text-ink-soft hover:text-ink-base',
                      keyTestState === 'testing' && 'border-line bg-paper-strong text-ink-faded',
                    )}
                  >
                    {keyTestState === 'testing' ? <Loader2 size={12} className="animate-spin" /> :
                     keyTestState === 'ok' ? <Check size={12} /> : 'Test'}
                  </button>
                </div>
                {keyTestState === 'error' && <p className="text-xs text-red-400">{keyTestError || 'Connection failed — check your key'}</p>}
                {keyTestState === 'ok'    && <p className="text-xs text-emerald-400">Connected ✓</p>}
                <button
                  onClick={() => window.conchitour.openUrl(
                    apiProvider === 'claude' ? 'https://console.anthropic.com/settings/keys' : 'https://platform.openai.com/api-keys'
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
                <p className="text-sm text-ink-soft mt-1">9 short questions to configure your tour automatically.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setStep('venue')}
                  className="group flex flex-col items-start gap-3 p-5 rounded-xl border border-line bg-paper-strong hover:border-ink-soft transition-all text-left"
                >
                  <Monitor size={22} className="text-ink-soft group-hover:text-ink-base transition-colors" />
                  <div>
                    <div className="text-sm font-semibold text-ink-base">Here on desktop</div>
                    <div className="text-xs text-ink-faded mt-0.5">Answer inline, fast and simple</div>
                  </div>
                </button>
                <button onClick={() => setStep('qr-waiting')}
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
                <p className="text-sm text-ink-soft mt-1">City, type, ambiance — the more detail, the more precise the AI configuration.</p>
              </div>
              <div className="flex gap-2 items-start">
                <textarea autoFocus value={venue} onChange={(e) => setVenue(e.target.value)}
                  placeholder="e.g. A rooftop hotel in Dubai Marina with a pool and panoramic views · Grand Palais cultural center, Paris · Luxury car showroom in Zurich specialising in electric vehicles · Historic château in the Loire Valley open for events"
                  rows={4}
                  className="flex-1 bg-paper-strong border border-line-soft rounded-lg px-3 py-2.5 text-sm text-ink-base placeholder-ink-faded focus:outline-none focus:border-accent resize-none"
                />
                <MicButton onTranscript={(text) => setVenue((v) => (v ? v + ' ' : '') + text)} lang="en-US" />
              </div>
              <p className="text-xs text-ink-faded">AI analyzes the location to generate relevant types, audiences, spaces, and tone options.</p>
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
              {analysisError && <p className="text-xs text-amber-400">{analysisError}</p>}
              <div>
                <h2 className="text-xl font-semibold text-ink-base">What type of venue is this?</h2>
                {analysis?.venueSummary && <p className="text-xs text-ink-faded mt-1 italic">{analysis.venueSummary}</p>}
                <p className="text-sm text-ink-soft mt-1">Select one or more, or describe it yourself.</p>
              </div>
              <DynamicChipsInput
                options={currentAnalysis.typeOptions}
                selected={projectType}
                onToggle={(key) => setProjectType(toggleMulti(projectType, key))}
                freeText={projectTypeFree} onFreeTextChange={setProjectTypeFree}
                placeholder="Or describe it in your own words…"
                speechLang={speechLang}
              />
            </div>
          )}

          {/* ── Step 3: Client type ── */}
          {step === 'client-type' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">Who is the end client?</h2>
                <p className="text-sm text-ink-soft mt-1">The person or company who commissioned this virtual tour.</p>
              </div>
              <DynamicChipsInput
                options={CLIENT_TYPES}
                selected={clientType}
                onToggle={(key) => setClientType(toggleMulti(clientType, key))}
                freeText={clientTypeFree} onFreeTextChange={setClientTypeFree}
                placeholder="Other client type…"
                speechLang={speechLang}
              />
            </div>
          )}

          {/* ── Step 3b: Client info ── */}
          {step === 'client-info' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">Client details</h2>
                <p className="text-sm text-ink-soft mt-1">Optional — used to personalise the project name and import brand colors.</p>
              </div>

              {/* Client name */}
              <div className="space-y-1.5">
                <label className="text-xs text-ink-faded uppercase tracking-wide font-medium">Client name</label>
                <input
                  type="text" value={clientName} onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. Burj Al Arab, Musée d'Orsay, Tesla Zurich…"
                  className="w-full bg-paper-strong border border-line-soft rounded-lg px-3 py-2 text-sm text-ink-base placeholder-ink-faded focus:outline-none focus:border-accent"
                />
              </div>

              {/* Client website + brand color extraction */}
              <div className="space-y-1.5">
                <label className="text-xs text-ink-faded uppercase tracking-wide font-medium">Client website (optional)</label>
                <div className="flex gap-2">
                  <input
                    type="url" value={clientWebsite} onChange={(e) => setClientWebsite(e.target.value)}
                    placeholder="https://example.com"
                    className="flex-1 bg-paper-strong border border-line-soft rounded-lg px-3 py-2 text-sm text-ink-base placeholder-ink-faded focus:outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    disabled={!clientWebsite.trim() || fetchingBrandColors}
                    onClick={async () => {
                      if (!clientWebsite.trim()) return;
                      setFetchingBrandColors(true);
                      try {
                        const result = await window.conchitour.brandExtract(clientWebsite.trim());
                        if (result.ok && result.colors.length > 0) {
                          setBrandColors((prev) => {
                            const merged = [...new Set([...result.colors, ...prev])].slice(0, 8);
                            return merged;
                          });
                          setColor(result.colors[0]);
                        }
                      } catch { /* ignore */ }
                      setFetchingBrandColors(false);
                    }}
                    className="shrink-0 px-3 py-2 rounded-lg border border-line bg-paper-strong text-xs text-ink-soft hover:text-ink-base hover:border-ink-soft disabled:opacity-40 transition-all"
                  >
                    {fetchingBrandColors ? <Loader2 size={12} className="animate-spin" /> : '🎨 Fetch colors'}
                  </button>
                </div>
              </div>

              {/* Logo upload */}
              <div className="space-y-1.5">
                <label className="text-xs text-ink-faded uppercase tracking-wide font-medium">Client logo (optional)</label>
                <div className="flex gap-3 items-start">
                  <label className={clsx(
                    'flex flex-col items-center justify-center gap-1.5 w-24 h-24 rounded-xl border-2 border-dashed cursor-pointer transition-all shrink-0',
                    logoObjectUrl ? 'border-accent/40' : 'border-line hover:border-ink-soft',
                  )}>
                    {logoObjectUrl
                      ? <img src={logoObjectUrl} alt="Logo" className="w-full h-full object-contain rounded-xl p-1" />
                      : <>
                          <span className="text-2xl">🖼️</span>
                          <span className="text-xs text-ink-faded text-center leading-tight">Upload logo</span>
                        </>
                    }
                    <input type="file" accept="image/*" className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0] ?? null;
                        if (logoObjectUrl) URL.revokeObjectURL(logoObjectUrl);
                        if (!file) { setLogoFile(null); setLogoObjectUrl(null); return; }
                        setLogoFile(file);
                        const objUrl = URL.createObjectURL(file);
                        setLogoObjectUrl(objUrl);
                        const extracted = await extractColorsFromImageBlob(objUrl);
                        if (extracted.length > 0) {
                          setBrandColors((prev) => {
                            const merged = [...new Set([...extracted, ...prev])].slice(0, 8);
                            return merged;
                          });
                          setColor(extracted[0]);
                        }
                      }}
                    />
                  </label>
                  <div className="flex-1 space-y-1.5">
                    <p className="text-xs text-ink-faded">
                      Logo used in the virtual tour and to extract brand colors automatically.
                    </p>
                    {logoFile && (
                      <button type="button" onClick={() => {
                        if (logoObjectUrl) URL.revokeObjectURL(logoObjectUrl);
                        setLogoFile(null); setLogoObjectUrl(null);
                      }} className="text-xs text-ink-faded hover:text-red-400 transition-colors">
                        Remove logo ×
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Brand color swatches */}
              {brandColors.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs text-ink-faded uppercase tracking-wide font-medium">Brand colors — pick accent</label>
                  <div className="flex flex-wrap gap-2">
                    {brandColors.map((hex) => (
                      <button key={hex} type="button" onClick={() => setColor(hex)}
                        className={clsx(
                          'w-8 h-8 rounded-lg border-2 transition-all',
                          color.toUpperCase() === hex.toUpperCase() ? 'border-ink-base scale-110' : 'border-transparent hover:scale-105',
                        )}
                        style={{ backgroundColor: hex }}
                        title={hex}
                      />
                    ))}
                    <div className="flex items-center gap-1.5 ml-1">
                      <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                        className="w-8 h-8 rounded-lg border border-line cursor-pointer bg-transparent"
                      />
                      <span className="text-xs font-mono text-ink-faded">{color.toUpperCase()}</span>
                    </div>
                  </div>
                </div>
              )}

              {brandColors.length === 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs text-ink-faded uppercase tracking-wide font-medium">Accent color</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                      className="w-10 h-10 rounded-lg border border-line cursor-pointer bg-transparent"
                    />
                    <span className="text-xs font-mono text-ink-soft">{color.toUpperCase()}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 4: Goal ── */}
          {step === 'goal' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">What is the tour's main objective?</h2>
                <p className="text-sm text-ink-soft mt-1">Select all that apply — shapes the AI content strategy.</p>
              </div>
              <DynamicChipsInput
                options={TOUR_GOALS}
                selected={goal}
                onToggle={(key) => setGoal(toggleMulti(goal, key))}
                freeText={goalFree} onFreeTextChange={setGoalFree}
                placeholder="Other objective…"
                speechLang={speechLang}
              />
            </div>
          )}

          {/* ── Step 5: Audience ── */}
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
                freeText={audienceFree} onFreeTextChange={setAudienceFree}
                placeholder="Other audience type…"
                speechLang={speechLang}
              />
            </div>
          )}

          {/* ── Step 6: Spaces ── */}
          {step === 'spaces' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">Which areas will you include?</h2>
                <p className="text-sm text-ink-soft mt-1">These become your tour categories, each with a dedicated icon and color.</p>
              </div>
              <DynamicChipsInput
                options={currentAnalysis.spaceOptions}
                selected={spaces}
                onToggle={(key) => setSpaces(toggleMulti(spaces, key))}
                freeText={spacesFree} onFreeTextChange={setSpacesFree}
                placeholder="Add a custom area (rooftop bar, wine cellar, workshop…)"
                speechLang={speechLang}
              />
              {spaces.length > 0 && (
                <p className="text-xs text-ink-faded">{spaces.length} area{spaces.length > 1 ? 's' : ''} selected — each will get its own icon and color</p>
              )}
            </div>
          )}

          {/* ── Step 7: Capture ── */}
          {step === 'capture' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">How do you capture your shots?</h2>
                <p className="text-sm text-ink-soft mt-1">Optional — helps contextualise the project and space structure.</p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-ink-soft uppercase tracking-wide">Equipment</p>
                <div className="flex flex-wrap gap-2">
                  {CAPTURE_EQUIP.map((opt) => {
                    const sel = captureEquip.includes(opt.key);
                    return (
                      <button key={opt.key} type="button" onClick={() => setCaptureEquip(toggleMulti(captureEquip, opt.key))}
                        title={opt.example}
                        className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all',
                          sel ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-paper-strong text-ink-soft hover:border-ink-soft hover:text-ink-base',
                        )}
                      >
                        {opt.icon && <span>{opt.icon}</span>}
                        {opt.label}
                        {sel && <Check size={10} />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-ink-soft uppercase tracking-wide">Shooting location</p>
                <div className="flex flex-wrap gap-2">
                  {CAPTURE_SETTING.map((opt) => {
                    const sel = captureSetting.includes(opt.key);
                    return (
                      <button key={opt.key} type="button" onClick={() => setCaptureSetting(toggleMulti(captureSetting, opt.key))}
                        className={clsx('flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                          sel ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-paper-strong text-ink-soft hover:border-ink-soft hover:text-ink-base',
                        )}
                      >
                        {opt.icon && <span>{opt.icon}</span>}
                        {opt.label}
                        {sel && <Check size={10} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 8: Tone (free text) ── */}
          {step === 'tone' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">What's the editorial voice?</h2>
                <p className="text-sm text-ink-soft mt-1">Describe how you want visitors to feel when reading the tour content.</p>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs text-ink-faded">Click to use as a starting point, then edit:</p>
                <div className="space-y-1.5">
                  {TONE_STARTERS.map((s, i) => (
                    <button key={i} type="button" onClick={() => setToneText(s)}
                      className={clsx('w-full text-left px-3 py-2 rounded-lg border text-xs text-ink-soft transition-all',
                        toneText === s ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-paper-strong hover:border-ink-soft hover:text-ink-base',
                      )}
                    >
                      "{s}"
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs text-ink-faded">Or write your own:</p>
                <div className="flex gap-2 items-start">
                  <textarea value={toneText} onChange={(e) => setToneText(e.target.value)}
                    placeholder="e.g. Adventurous and energetic, speaking directly to travellers seeking authentic experiences in the heart of the city…"
                    rows={3}
                    className="flex-1 bg-paper-strong border border-line-soft rounded-lg px-3 py-2.5 text-sm text-ink-base placeholder-ink-faded focus:outline-none focus:border-accent resize-none"
                  />
                  <MicButton onTranscript={(text) => setToneText((v) => (v ? v + ' ' : '') + text)} lang={speechLang} />
                </div>
              </div>
            </div>
          )}

          {/* ── Step 9: Extras ── */}
          {step === 'extras' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-ink-base">Anything else to add?</h2>
                <p className="text-sm text-ink-soft mt-1">Optional — certifications, brand guidelines, opening seasons, accessibility features…</p>
              </div>
              <div className="flex gap-2 items-start">
                <textarea autoFocus value={extras} onChange={(e) => setExtras(e.target.value)}
                  placeholder="e.g. Eco-certified, organic restaurant on site · Pet-friendly · Open April–October only · Award-winning architecture · Multilingual staff (EN/FR/DE/JA/ZH)…"
                  rows={4}
                  className="flex-1 bg-paper-strong border border-line-soft rounded-lg px-3 py-2.5 text-sm text-ink-base placeholder-ink-faded focus:outline-none focus:border-accent resize-none"
                />
                <MicButton onTranscript={(text) => setExtras((v) => (v ? v + ' ' : '') + text)} lang={speechLang} />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-ink-faded uppercase tracking-wide font-medium">Accent color</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                    className="w-10 h-10 rounded-lg border border-line cursor-pointer bg-transparent"
                  />
                  <div>
                    <div className="text-xs font-mono text-ink-soft">{color.toUpperCase()}</div>
                    {analysis?.accentColorSuggestion && color !== analysis.accentColorSuggestion && (
                      <button onClick={() => setColor(analysis.accentColorSuggestion)}
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
                <p className="text-sm text-ink-soft mt-1 text-center">Same Wi-Fi network required. Voice dictation available on mobile.</p>
                <p className="text-xs text-amber-400 mt-1 text-center">Your browser will show a security warning — tap <strong>Advanced → Proceed</strong> to open the page, then allow microphone access.</p>
              </div>
              {qrDataUrl ? (
                <div className="p-3 bg-white rounded-xl"><img src={qrDataUrl} alt="QR code" className="w-44 h-44" /></div>
              ) : (
                <div className="w-44 h-44 bg-paper-strong rounded-xl flex items-center justify-center">
                  <Loader2 size={24} className="animate-spin text-ink-faded" />
                </div>
              )}
              {lanUrl && <p className="text-xs font-mono text-ink-faded bg-paper-strong px-3 py-1.5 rounded">{lanUrl}</p>}
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

              {error && <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-3 py-2">{error}</p>}

              <div className="space-y-1.5">
                <label className="text-xs text-ink-faded uppercase tracking-wide font-semibold">Project name</label>
                <input value={summary.projectName} onChange={(e) => setSummary({ ...summary, projectName: e.target.value })}
                  className="w-full bg-paper-strong border border-line-soft rounded-lg px-3 py-2 text-sm text-ink-base focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-ink-faded uppercase tracking-wide font-semibold">Languages</label>
                <div className="flex flex-wrap gap-1.5">
                  <span className="flex items-center gap-1 px-2.5 py-1 bg-accent/10 border border-accent/30 rounded-full text-xs text-accent font-medium">
                    {flagFor[summary.defaultLang] ?? '🌐'} {langLabel(summary.defaultLang)} (default)
                  </span>
                  {summary.extraLanguages.map((l) => (
                    <span key={l} className="flex items-center gap-1 px-2.5 py-1 bg-paper-strong border border-line rounded-full text-xs text-ink-soft">
                      {flagFor[l] ?? '🌐'} {langLabel(l)}
                      <button onClick={() => setSummary({ ...summary, extraLanguages: summary.extraLanguages.filter((x) => x !== l) })}
                        className="ml-0.5 text-ink-faded hover:text-ink-base"
                      ><X size={10} /></button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-ink-faded uppercase tracking-wide font-semibold">Accent color</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={summary.accentColor} onChange={(e) => setSummary({ ...summary, accentColor: e.target.value })}
                    className="w-8 h-8 rounded cursor-pointer border border-line bg-transparent"
                  />
                  <span className="text-xs font-mono text-ink-soft">{summary.accentColor.toUpperCase()}</span>
                </div>
              </div>

              {summary.categories.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs text-ink-faded uppercase tracking-wide font-semibold">Tour categories</label>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.categories.map((c) => (
                      <span key={c.slug} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                        style={{ backgroundColor: c.color + '22', color: c.color, border: `1px solid ${c.color}44` }}
                      >
                        {c.icon && <span>{c.icon}</span>}
                        {c.name}
                        <button onClick={() => setSummary({ ...summary, categories: summary.categories.filter((x) => x.slug !== c.slug) })}
                          className="ml-0.5 opacity-60 hover:opacity-100"
                        ><X size={10} /></button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs text-ink-faded uppercase tracking-wide font-semibold">AI context prompt</label>
                <textarea value={summary.contextPrompt} onChange={(e) => setSummary({ ...summary, contextPrompt: e.target.value })}
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

          {step === 'quick-name' && (
            <div className="flex gap-2">
              <button onClick={() => setStep('mode-select')} className="px-4 py-2 text-sm text-ink-soft hover:text-ink-base transition-colors">
                <ArrowLeft size={14} className="inline mr-1" />Back
              </button>
              <button onClick={applyQuick} disabled={!quickName.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-ink-base text-paper text-sm font-semibold hover:bg-ink-strong disabled:opacity-40 transition-colors"
              >
                Choose folder <ArrowRight size={14} />
              </button>
            </div>
          )}

          {step === 'api-key' && (
            <div className="flex gap-2">
              <button onClick={goBack} className="px-4 py-2 text-sm text-ink-soft hover:text-ink-base transition-colors">
                <ArrowLeft size={14} className="inline mr-1" />Back
              </button>
              <button onClick={() => setStep('routing')} disabled={apiKey.trim().length < 10}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                Continue <ArrowRight size={14} />
              </button>
            </div>
          )}

          {step === 'routing' && (
            <button onClick={goBack} className="px-4 py-2 text-sm text-ink-soft hover:text-ink-base transition-colors">
              <ArrowLeft size={14} className="inline mr-1" />Back
            </button>
          )}

          {showNext && !['api-key', 'routing', 'quick-name'].includes(step) && (
            <div className="flex gap-2">
              <button onClick={goBack} className="px-4 py-2 text-sm text-ink-soft hover:text-ink-base transition-colors">
                <ArrowLeft size={14} className="inline mr-1" />Back
              </button>
              <button onClick={advance} disabled={!canAdvance()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                {step === 'extras' ? 'Generate' : 'Next'} <ArrowRight size={14} />
              </button>
            </div>
          )}

          {step === 'qr-waiting' && (
            <button onClick={goBack} className="w-full py-2 text-sm text-ink-soft hover:text-ink-base transition-colors">
              <ArrowLeft size={14} className="inline mr-1" />Back to routing
            </button>
          )}

          {step === 'summary' && summary && (
            <button onClick={applySummary} disabled={applying || !summary.projectName.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              {applying
                ? <><Loader2 size={14} className="animate-spin" />Creating project…</>
                : <><Check size={14} />Apply configuration</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
