// ============================================================
// Domain types — single source of truth for the whole app.
// Keep this file in sync with the SPEC in CLAUDE.md.
// ============================================================

export type UUID = string;

export interface GeoCoord {
  lat: number;
  lng: number;
  altitude?: number;
}

export interface ViewPoint {
  hlookat: number;
  vlookat: number;
  fov: number;
}

export type HotspotType = 'link' | 'video' | 'text' | 'external' | 'form';

export interface BaseHotspot {
  id: UUID;
  type: HotspotType;
  ath: number;
  atv: number;
  /** Optional visible label shown in the viewer overlay (localized) */
  title?: Record<string, string>;
  /** Optional override of category icon (otherwise uses target scene's category) */
  iconStyle?: string;
}

export interface LinkHotspot extends BaseHotspot {
  type: 'link';
  targetSceneId: UUID;
  enterView?: ViewPoint;
}

export interface VideoHotspot extends BaseHotspot {
  type: 'video';
  url: string;
  /** Localized video title shown in the viewer */
  title: Record<string, string>;
  autoplay?: boolean;
}

export interface TextHotspot extends BaseHotspot {
  type: 'text';
  /** Localized panel title */
  title: Record<string, string>;
  /** Localized body (HTML allowed) */
  body: Record<string, string>;
}

export interface ExternalHotspot extends BaseHotspot {
  type: 'external';
  url: string;
  /** Localized button label */
  label: Record<string, string>;
  openInNewTab?: boolean;
}

export interface FormHotspot extends BaseHotspot {
  type: 'form';
  mailto: string;
  /** Localized email subject line */
  subject: Record<string, string>;
  fields: Array<{ name: string; label: string; required: boolean }>;
}

export type Hotspot = LinkHotspot | VideoHotspot | TextHotspot | ExternalHotspot | FormHotspot;

export interface Category {
  id: UUID;
  /** url-safe slug (a-z0-9_-). Built-in categories use a _ prefix (e.g. _link). */
  slug: string;
  /** localized display names */
  name: Record<string, string>;
  color: string;
  iconSvg?: string;
  pinSvg?: string;
  /** whether to show scenes of this category as map pins (default true) */
  useAsPin?: boolean;
  /** true for the 5 built-in hotspot-type categories — cannot be deleted */
  builtIn?: boolean;
}

export interface SceneMedia {
  /** Absolute path to the source image (resolved at runtime). */
  sourcePath: string;
  /** Relative path inside the .conchitour/sources/ folder. Set when project is saved. */
  sourceFile?: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  exif?: {
    dateTime?: string;
    camera?: string;
    direction?: number;
    gps?: GeoCoord;
  };
  tilesGenerated: boolean;
  tilesPath?: string;
}

export interface Scene {
  id: UUID;
  /** url-safe unique slug entered by the user */
  slug: string;
  /** localized titles, indexed by language code */
  title: Record<string, string>;
  description: Record<string, string>;
  altText: Record<string, string>;

  categoryIds: UUID[];
  geo: GeoCoord;
  /** north heading in degrees */
  heading: number;
  /** camera height in meters at capture time */
  captureHeightMeters: number;
  /** visibility radius in metres for auto-compute link hotspots (default 150) */
  visibilityRadius?: number;
  defaultView?: ViewPoint;
  hotspots: Hotspot[];
  media: SceneMedia;
  ogImagePath?: string;
  ambientAudioPath?: string;
  /** 'custom' when the user captured a thumbnail from the editor viewport */
  thumbnailMode?: 'auto' | 'custom';
}

export interface ProjectSeo {
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  schemaType: 'TouristAttraction' | 'Hotel' | 'Museum' | 'Place';
  imageSitemap: boolean;
}

export interface TourTheme {
  fontFamily?: 'system' | 'serif' | 'mono';
  headerBg?: string;
  panelBg?: string;
  textColor?: string;
  radius?: 'sharp' | 'soft' | 'round';
  fontSize?: number;
  /** Entrance animation for the intro text on the loading/splash screen */
  introAnimation?: 'fade' | 'slide' | 'zoom';
  /** Font size (px) for the intro text on the splash screen */
  introFontSize?: number;
}

export interface ProjectBranding {
  logoPath?: string;
  faviconPath?: string;
  loaderPath?: string;
  startSceneId?: UUID;
  primaryColor: string;
  accentColor: string;
  introText: Record<string, string>;
  /** Style of the hover preview card shown on link hotspots in the compiled tour */
  hotspotPreviewStyle?: 'card' | 'compact' | 'overlay';
  /** Size of hotspot pins in pixels (default 32, range 16–80) */
  hotspotSizePx?: number;
  /** Tour viewer UI theming (fonts, colors, radius, font size) */
  tourTheme?: TourTheme;
  /** Default mobile layout: map band visible (map), scene strip visible (strip), or panorama only (pano) */
  mobileDefaultView?: 'map' | 'strip' | 'pano';
  /** Name shown in the mobile header pill (e.g. "Matthias Conche") */
  authorName?: string;
  /** Tour date shown after the author name in the pill (e.g. "Jan. 2022") */
  tourDate?: string;
  /** Author portrait shown in the mobile pill — stored as data URL (no compile-time copy needed) */
  authorAvatar?: string;
  /** Animation used when opening/closing the scene description panel on mobile */
  panelAnimation?: 'slide' | 'fade' | 'zoom' | 'flip' | 'none';
}

export interface ProjectShare {
  facebook: boolean;
  twitter: boolean;
  whatsapp: boolean;
  linkedin: boolean;
  email: boolean;
  captureView: boolean;
}

export interface MapModeConfig {
  enabled: boolean;
  defaultView: '360' | 'map' | 'sidebyside';
  tileStyle: 'streets' | 'satellite' | 'light' | 'dark';
  showByDefault: boolean;
}

export interface ProjectModules {
  vr: boolean;
  gyroscope: boolean;
  fullscreen: boolean;
  feedbackMailto?: string;
  formsEnabled: boolean;
  cookieConsent?: boolean;
  cookieText?: Record<string, string>;
  mapMode?: MapModeConfig;
  /** When true, hovering a map marker highlights the matching link hotspot in the 360° view and vice-versa */
  mapTourSync?: boolean;
  /** Anthropic API key (stored in project, NOT exported to Excel) */
  anthropicApiKey?: string;
  /** OpenAI API key (stored in project, NOT exported to Excel) */
  openaiApiKey?: string;
  /** Which AI provider is active for content generation */
  aiProvider?: 'claude' | 'gpt';
  /** Selected Claude model ID (from ai-models catalog) */
  claudeModel?: string;
  /** Selected OpenAI model ID (from ai-models catalog) */
  openaiModel?: string;
}

export type BuiltInPageKind = 'privacy' | 'legal' | 'terms' | 'about' | 'contact';

export interface StaticPage {
  id: string;
  /** url-safe slug, e.g. 'privacy', 'legal'. Built-in slugs are reserved. */
  slug: string;
  /** When false the page is hidden from footer and not compiled. */
  enabled: boolean;
  /** Set for the 5 built-in pages — cannot be deleted, only toggled. */
  builtIn?: BuiltInPageKind;
  title: Record<string, string>;
  /** Markdown source, one entry per language code. */
  content: Record<string, string>;
  showInFooter: boolean;
  /** Sort order in the footer link list. */
  order: number;
}

export type AuditSeverity = 'error' | 'warning' | 'suggestion' | 'info';

export type AuditCategory =
  | 'content'
  | 'navigation'
  | 'seo'
  | 'i18n'
  | 'branding'
  | 'modules'
  | 'pages'
  | 'analytics'
  | 'media'
  | 'ai-content'
  | 'ai-narrative';

export interface AuditIssue {
  id: string;
  severity: AuditSeverity;
  category: AuditCategory;
  title: string;
  description: string;
  targetScreen?: string;
  targetEntityId?: string;
  targetEntityType?: 'scene' | 'category' | 'hotspot' | 'page' | 'project';
  suggestion?: string;
  /** Which scene field the suggestion applies to (for one-click Apply) */
  fixField?: 'title' | 'description' | 'altText';
  fixable?: boolean;
  aiGenerated?: boolean;
  dismissedAt?: number;
}

export interface AuditReport {
  generatedAt: number;
  issues: AuditIssue[];
  summary: Record<AuditSeverity, number>;
  aiUsed: boolean;
  aiTokensIn?: number;
  aiTokensOut?: number;
}

export type TrackableEvent =
  | 'scene_view'
  | 'scene_change'
  | 'tour_started'
  | 'tour_completed'
  | 'hotspot_click'
  | 'link_hotspot_click'
  | 'external_link_click'
  | 'info_hotspot_open'
  | 'video_play'
  | 'form_open'
  | 'form_submit'
  | 'map_open'
  | 'map_marker_click'
  | 'share_click'
  | 'language_change'
  | 'cookie_accepted'
  | 'info_panel_open'
  | 'fullscreen_enter';

export interface AnalyticsConfig {
  enabled: boolean;
  /** GA4 Measurement ID, format: G-XXXXXXXXXX */
  measurementId: string;
  /** Pass anonymize_ip: true to gtag (GDPR-safe default) */
  anonymizeIp: boolean;
  /** When true, no events fire until the user accepts the cookie consent banner */
  respectCookieConsent: boolean;
  events: Record<TrackableEvent, boolean>;
}

export interface AiTokenCount {
  in: number;
  out: number;
}

export interface AiUsageRecord {
  provider: 'anthropic' | 'openai';
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: number;
  operation: 'audit' | 'content-gen' | 'translation' | 'interview' | 'other';
}

export interface AiUsageTotals {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AiUsage {
  records: AiUsageRecord[];
  totals: {
    anthropic: AiUsageTotals;
    openai: AiUsageTotals;
  };
}

export interface AiContext {
  tone: 'marketing' | 'factual' | 'storytelling' | 'poetic' | 'educational';
  audience: 'general' | 'professional' | 'luxury' | 'youth' | 'family' | 'senior';
  /** One of AI_THEMES values or 'custom' */
  theme: string;
  length: 'short' | 'medium' | 'long';
  customInstructions?: string;
  /** Free-text project description sent with every AI request as editorial context */
  projectContext?: string;
  /** Cumulative token usage per provider */
  tokensUsed?: { claude: AiTokenCount; gpt: AiTokenCount };
}

export interface Project {
  /** schema version, useful for future migrations */
  schemaVersion: 1;
  meta: {
    name: string;
    creator: string;
    contactEmail: string;
    copyright: string;
    publicationUrl: string;
    shortDescription: string;
  };
  languages: {
    available: string[];
    default: string;
  };
  categories: Category[];
  scenes: Scene[];
  seo: ProjectSeo;
  branding: ProjectBranding;
  share: ProjectShare;
  modules: ProjectModules;
  pages: StaticPage[];
  analytics?: AnalyticsConfig;
  aiContext?: AiContext;
  aiUsage?: AiUsage;
  uiPreferences?: { currency: 'USD' | 'EUR' | 'GBP' | 'CHF' };
}
