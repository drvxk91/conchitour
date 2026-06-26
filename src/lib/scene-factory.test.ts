import { describe, it, expect } from 'vitest';
import { newScene, type PhotoMeta } from './scene-factory';

const baseMeta: PhotoMeta = {
  width: 8000,
  height: 4000,
  fileSize: 5_000_000,
};

describe('newScene', () => {
  it('returns a non-empty uuid id', () => {
    const scene = newScene('/photos/lobby.jpg', baseMeta, new Set());
    expect(scene.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('derives slug from filename without extension', () => {
    const scene = newScene('/photos/hotel_lobby.jpg', baseMeta, new Set());
    expect(scene.slug).toBe('hotel_lobby');
  });

  it('handles Windows-style backslash paths', () => {
    const scene = newScene('C:\\photos\\rooftop view.jpg', baseMeta, new Set());
    expect(scene.slug).toBe('rooftop_view');
  });

  it('makes slug unique against existing set', () => {
    const taken = new Set(['hotel_lobby']);
    const scene = newScene('/photos/hotel_lobby.jpg', baseMeta, taken);
    expect(scene.slug).toBe('hotel_lobby_2');
  });

  it('makes slug unique when both base and _2 are taken', () => {
    const taken = new Set(['hotel_lobby', 'hotel_lobby_2']);
    const scene = newScene('/photos/hotel_lobby.jpg', baseMeta, taken);
    expect(scene.slug).toBe('hotel_lobby_3');
  });

  it('sets geo to {0, 0} when no GPS in meta', () => {
    const scene = newScene('/photos/lobby.jpg', baseMeta, new Set());
    expect(scene.geo).toEqual({ lat: 0, lng: 0 });
  });

  it('sets geo from GPS when present in meta', () => {
    const meta: PhotoMeta = {
      ...baseMeta,
      exif: { gps: { lat: 48.8566, lng: 2.3522 } },
    };
    const scene = newScene('/photos/paris.jpg', meta, new Set());
    expect(scene.geo).toEqual({ lat: 48.8566, lng: 2.3522 });
  });

  it('preserves GPS altitude when present', () => {
    const meta: PhotoMeta = {
      ...baseMeta,
      exif: { gps: { lat: 48.8566, lng: 2.3522, altitude: 50 } },
    };
    const scene = newScene('/photos/paris_high.jpg', meta, new Set());
    expect(scene.geo.altitude).toBe(50);
  });

  it('sets heading to 0 when no GPSImgDirection in meta', () => {
    const scene = newScene('/photos/lobby.jpg', baseMeta, new Set());
    expect(scene.heading).toBe(0);
  });

  it('sets heading from GPSImgDirection when present', () => {
    const meta: PhotoMeta = { ...baseMeta, exif: { direction: 135 } };
    const scene = newScene('/photos/lobby.jpg', meta, new Set());
    expect(scene.heading).toBe(135);
  });

  it('normalizes EXIF heading 360 to 0 (not left as 360)', () => {
    // Some cameras output 360.0 instead of 0.0 — must be normalized before storage
    const meta: PhotoMeta = { ...baseMeta, exif: { direction: 360 } };
    const scene = newScene('/photos/lobby.jpg', meta, new Set());
    expect(scene.heading).toBe(0);
  });

  it('normalizes negative EXIF heading to [0, 360)', () => {
    // Insta360 Yaw can be negative
    const meta: PhotoMeta = { ...baseMeta, exif: { direction: -45 } };
    const scene = newScene('/photos/lobby.jpg', meta, new Set());
    expect(scene.heading).toBe(315);
  });

  it('defaults captureHeightMeters to 1.6', () => {
    const scene = newScene('/photos/lobby.jpg', baseMeta, new Set());
    expect(scene.captureHeightMeters).toBe(1.6);
  });

  it('starts with empty hotspots array', () => {
    const scene = newScene('/photos/lobby.jpg', baseMeta, new Set());
    expect(scene.hotspots).toEqual([]);
  });

  it('sets title.en to filename without extension', () => {
    const scene = newScene('/photos/hotel_lobby.jpg', baseMeta, new Set());
    expect(scene.title.en).toBe('hotel_lobby');
  });

  it('sets empty description and altText in en', () => {
    const scene = newScene('/photos/lobby.jpg', baseMeta, new Set());
    expect(scene.description.en).toBe('');
    expect(scene.altText.en).toBe('');
  });

  it('starts with empty categoryIds', () => {
    const scene = newScene('/photos/lobby.jpg', baseMeta, new Set());
    expect(scene.categoryIds).toEqual([]);
  });

  it('populates media.sourcePath with original path', () => {
    const scene = newScene('/photos/lobby.jpg', baseMeta, new Set());
    expect(scene.media.sourcePath).toBe('/photos/lobby.jpg');
  });

  it('populates media dimensions from meta', () => {
    const scene = newScene('/photos/lobby.jpg', baseMeta, new Set());
    expect(scene.media.width).toBe(8000);
    expect(scene.media.height).toBe(4000);
    expect(scene.media.fileSizeBytes).toBe(5_000_000);
  });

  it('sets tilesGenerated to false', () => {
    const scene = newScene('/photos/lobby.jpg', baseMeta, new Set());
    expect(scene.media.tilesGenerated).toBe(false);
  });

  it('stores exif data in media', () => {
    const exif = { dateTime: '2024-01-01T12:00:00.000Z', camera: 'GoPro MAX' };
    const meta: PhotoMeta = { ...baseMeta, exif };
    const scene = newScene('/photos/lobby.jpg', meta, new Set());
    expect(scene.media.exif?.dateTime).toBe('2024-01-01T12:00:00.000Z');
    expect(scene.media.exif?.camera).toBe('GoPro MAX');
  });

  it('sets media.exif to undefined when no exif in meta', () => {
    const scene = newScene('/photos/lobby.jpg', baseMeta, new Set());
    expect(scene.media.exif).toBeUndefined();
  });

  it('generates unique ids for different calls with same path', () => {
    const a = newScene('/photos/lobby.jpg', baseMeta, new Set());
    const b = newScene('/photos/lobby.jpg', baseMeta, new Set(['lobby']));
    expect(a.id).not.toBe(b.id);
  });
});
