import { HardDrive, Camera, Calendar, Compass, CheckCircle, Clock } from 'lucide-react';
import type { Scene } from '@/types';

function fmt(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-ink-faded mt-0.5">{icon}</span>
      <div>
        <p className="text-[10px] text-ink-faded">{label}</p>
        <p className="text-xs text-ink">{value || '—'}</p>
      </div>
    </div>
  );
}

export function MediaTab({ scene }: { scene: Scene }) {
  const { media } = scene;
  const name = media.sourcePath.replace(/\\/g, '/').split('/').pop() ?? '—';
  const dims = media.width && media.height ? `${media.width} × ${media.height}` : '—';
  // Equirectangular 360° images have a 2:1 aspect ratio (width ≈ 2 × height)
  const isEquirect = media.width > 0 && media.height > 0 &&
    Math.abs(media.width / media.height - 2) < 0.1;

  return (
    <div className="p-4 space-y-4 text-sm" data-testid="media-tab">
      <div className="space-y-3">
        <Row icon={<HardDrive size={13} />} label="Source file" value={name} />
        <Row icon={<HardDrive size={13} />} label="Dimensions" value={dims} />
        <Row icon={<HardDrive size={13} />} label="File size" value={fmt(media.fileSizeBytes)} />
      </div>
      {media.width > 0 && (
        <div className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
          isEquirect ? 'bg-green-50 text-green-700 border border-green-200'
                     : 'bg-amber-50 text-amber-700 border border-amber-200'
        }`}>
          {isEquirect ? '✓ Equirectangular 360°' : '⚠ Not equirectangular — viewer may distort'}
        </div>
      )}

      {media.exif && (
        <>
          <hr className="border-line" />
          <p className="text-[10px] text-ink-faded font-medium uppercase tracking-wide">EXIF</p>
          <div className="space-y-3">
            {media.exif.dateTime && (
              <Row icon={<Calendar size={13} />} label="Captured" value={new Date(media.exif.dateTime).toLocaleString()} />
            )}
            {media.exif.camera && (
              <Row icon={<Camera size={13} />} label="Camera" value={media.exif.camera} />
            )}
            {media.exif.direction != null && (
              <Row icon={<Compass size={13} />} label="GPS direction" value={`${media.exif.direction.toFixed(1)}°`} />
            )}
          </div>
        </>
      )}

      <hr className="border-line" />
      <div className="flex items-center gap-2">
        {media.tilesGenerated
          ? <CheckCircle size={14} className="text-green-600" />
          : <Clock size={14} className="text-amber-500" />
        }
        <span className="text-xs">
          {media.tilesGenerated ? 'Tiles generated' : 'Tiles pending'}
        </span>
      </div>
    </div>
  );
}
