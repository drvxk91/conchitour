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
  /** url-safe slug (a-z0-9_-) */
  slug: string;
  /** localized display names */
  name: Record<string, string>;
  color: string;
  iconSvg?: string;
  pinSvg?: string;
  /** whether to show scenes of this category as map pins (default true) */
  useAsPin?: boolean;
}

export interface SceneMedia {
  /** Absolute path to the source image (resolved at runtime). */
  sourcePath: string;
  /** Relative path inside the .conchitect/sources/ folder. Set when project is saved. */
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
}

export interface ProjectSeo {
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  schemaType: 'TouristAttraction' | 'Hotel' | 'Museum' | 'Place';
  imageSitemap: boolean;
}

export interface ProjectBranding {
  logoPath?: string;
  faviconPath?: string;
  loaderPath?: string;
  startSceneId?: UUID;
  primaryColor: string;
  accentColor: string;
  introText: Record<string, string>;
}

export interface ProjectShare {
  facebook: boolean;
  twitter: boolean;
  whatsapp: boolean;
  linkedin: boolean;
  email: boolean;
  captureView: boolean;
}

export interface ProjectModules {
  vr: boolean;
  gyroscope: boolean;
  fullscreen: boolean;
  feedbackMailto?: string;
  formsEnabled: boolean;
  deeplApiKey?: string;
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
}
