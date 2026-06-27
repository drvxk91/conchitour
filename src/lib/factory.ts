import { v4 as uuid } from 'uuid';
import type { Project, Category, AnalyticsConfig, TrackableEvent } from '@/types';
import { DEFAULT_BUILTIN_PAGES } from './builtin-pages';

const ALL_EVENTS: TrackableEvent[] = [
  'scene_view', 'scene_change', 'tour_started', 'tour_completed',
  'hotspot_click', 'link_hotspot_click', 'external_link_click',
  'info_hotspot_open', 'video_play', 'form_open', 'form_submit',
  'map_open', 'map_marker_click',
  'share_click', 'language_change', 'cookie_accepted',
  'info_panel_open', 'fullscreen_enter',
];

const DEFAULT_EVENTS_OFF: TrackableEvent[] = ['tour_completed', 'info_panel_open', 'fullscreen_enter'];

export const DEFAULT_ANALYTICS: AnalyticsConfig = {
  enabled: false,
  measurementId: '',
  anonymizeIp: true,
  respectCookieConsent: true,
  events: Object.fromEntries(
    ALL_EVENTS.map((e) => [e, !DEFAULT_EVENTS_OFF.includes(e)])
  ) as Record<TrackableEvent, boolean>,
};

export function newProject(): Project {
  return {
    schemaVersion: 1,
    meta: {
      name: 'Untitled tour',
      creator: '',
      contactEmail: '',
      copyright: '',
      publicationUrl: '',
      shortDescription: '',
    },
    languages: { available: ['en'], default: 'en' },
    categories: defaultCategories(),
    scenes: [],
    seo: {
      metaTitle: '',
      metaDescription: '',
      keywords: [],
      schemaType: 'TouristAttraction',
      imageSitemap: true,
    },
    branding: {
      primaryColor: '#185FA5',
      accentColor: '#1D9E75',
      introText: { en: '' },
    },
    share: {
      facebook: true,
      twitter: true,
      whatsapp: true,
      linkedin: true,
      email: true,
      captureView: true,
    },
    modules: {
      vr: true,
      gyroscope: true,
      fullscreen: true,
      formsEnabled: false,
    },
    pages: DEFAULT_BUILTIN_PAGES.map((p) => ({ ...p })),
    analytics: { ...DEFAULT_ANALYTICS, events: { ...DEFAULT_ANALYTICS.events } },
    aiContext: {
      tone: 'marketing' as const,
      audience: 'general' as const,
      theme: 'Tourism',
      length: 'medium' as const,
    },
  };
}

/** Built-in categories — always present, cannot be deleted, slugs reserved with _ prefix. */
export const BUILTIN_CATEGORIES: Category[] = [
  { id: 'builtin-link',     slug: '_link',     name: { en: 'Link' },     color: '#185FA5', iconSvg: 'builtin:mappin',  builtIn: true },
  { id: 'builtin-video',    slug: '_video',    name: { en: 'Video' },    color: '#8B5CF6', iconSvg: 'builtin:camera',  builtIn: true },
  { id: 'builtin-text',     slug: '_text',     name: { en: 'Text' },     color: '#1D9E75', iconSvg: 'builtin:info',    builtIn: true },
  { id: 'builtin-external', slug: '_external', name: { en: 'External' }, color: '#BA7517', iconSvg: 'builtin:eye',     builtIn: true },
  { id: 'builtin-form',     slug: '_form',     name: { en: 'Form' },     color: '#E11D48', iconSvg: 'builtin:mail',    builtIn: true },
];

function defaultCategories(): Category[] {
  return [
    ...BUILTIN_CATEGORIES,
    { id: uuid(), slug: 'hotel',   name: { en: 'Hotel' },   color: '#185FA5' },
    { id: uuid(), slug: 'rooftop', name: { en: 'Rooftop' }, color: '#BA7517' },
    { id: uuid(), slug: 'aerial',  name: { en: 'Aerial' },  color: '#534AB7' },
    { id: uuid(), slug: 'culture', name: { en: 'Culture' }, color: '#1D9E75' },
  ];
}
