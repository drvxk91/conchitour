import { v4 as uuid } from 'uuid';
import type { Scene } from '@/types';
import { uniqueSlug } from './slug';

export interface PhotoMeta {
  width: number;
  height: number;
  fileSize: number;
  exif?: {
    dateTime?: string;
    camera?: string;
    direction?: number;
    gps?: { lat: number; lng: number; altitude?: number };
  };
}

export function newScene(sourcePath: string, meta: PhotoMeta, existingSlugs: Set<string>): Scene {
  const normalized = sourcePath.replace(/\\/g, '/');
  const basename = normalized.split('/').pop() ?? 'scene';
  const nameWithoutExt = basename.replace(/\.[^.]+$/, '') || 'scene';
  const slug = uniqueSlug(nameWithoutExt, existingSlugs);

  return {
    id: uuid(),
    slug,
    title: { en: nameWithoutExt },
    description: { en: '' },
    altText: { en: '' },
    categoryIds: [],
    geo: meta.exif?.gps ?? { lat: 0, lng: 0 },
    heading: meta.exif?.direction ?? 0,
    captureHeightMeters: 1.6,
    visibilityRadius: 150,
    hotspots: [],
    media: {
      sourcePath,
      width: meta.width,
      height: meta.height,
      fileSizeBytes: meta.fileSize,
      exif: meta.exif,
      tilesGenerated: false,
    },
  };
}
