import { v4 as uuid } from 'uuid';
import type { Project, Category } from '@/types';

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
  };
}

function defaultCategories(): Category[] {
  return [
    { id: uuid(), slug: 'hotel',   name: { en: 'Hotel' },   color: '#185FA5' },
    { id: uuid(), slug: 'rooftop', name: { en: 'Rooftop' }, color: '#BA7517' },
    { id: uuid(), slug: 'aerial',  name: { en: 'Aerial' },  color: '#534AB7' },
    { id: uuid(), slug: 'culture', name: { en: 'Culture' }, color: '#1D9E75' },
  ];
}
