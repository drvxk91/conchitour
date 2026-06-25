import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import {
  MousePointer2, Plus, Compass,
  Undo2, Redo2, Copy, Trash2, Eye, ChevronDown,
  Link, Video, Type, ExternalLink, ClipboardList, Bookmark, Camera,
} from 'lucide-react';
import type { EditorMode } from './ScenesScreen';
import type { Hotspot } from '@/types';

interface Props {
  mode: EditorMode;
  onModeChange: (m: EditorMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddHotspotType: (type: Hotspot['type']) => void;
  onNorthConfirm: (heading: number) => void;
  onNorthCancel: () => void;
  northDraftHeading?: number;
  onPreview: () => void;
  onSetDefaultView?: () => void;
  onCaptureThumbnail?: () => void;
}

const HOTSPOT_TYPES: { type: Hotspot['type']; label: string; Icon: typeof Link }[] = [
  { type: 'link',     label: 'Navigation link', Icon: Link },
  { type: 'video',    label: 'Video',           Icon: Video },
  { type: 'text',     label: 'Text info',       Icon: Type },
  { type: 'external', label: 'External URL',    Icon: ExternalLink },
  { type: 'form',     label: 'Contact form',    Icon: ClipboardList },
];

function Sep() {
  return <div className="w-px h-5 bg-line mx-0.5 flex-shrink-0" />;
}

export function SceneToolbar({ mode, onModeChange, onUndo, onRedo, onDuplicate, onDelete, onAddHotspotType, onNorthConfirm, onNorthCancel, northDraftHeading, onPreview, onSetDefaultView, onCaptureThumbnail }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);

  return (
    <div className="h-10 flex items-center gap-1 px-3 border-b border-line bg-paper flex-shrink-0">
      <button
        title="Navigate — drag to look around (V)"
        onClick={() => onModeChange('navigate')}
        className={clsx('btn gap-1.5', mode === 'navigate' && 'btn-primary')}
      >
        <MousePointer2 size={13} />
        Navigate
        <kbd className="opacity-40 text-[10px] ml-0.5">V</kbd>
      </button>

      <div ref={dropRef} className="relative">
        <button
          title="Add a hotspot at scene center (then drag to reposition)"
          onClick={() => setDropdownOpen((o) => !o)}
          className={clsx('btn gap-1.5', mode === 'hotspot' && 'btn-primary')}
        >
          <Plus size={13} />
          Add hotspot
          <ChevronDown size={11} className="opacity-60" />
        </button>
        {dropdownOpen && (
          <div className="absolute top-full left-0 mt-1 bg-paper border border-line-strong rounded-lg shadow-xl z-50 w-44 py-1 overflow-hidden">
            {HOTSPOT_TYPES.map(({ type, label, Icon }) => (
              <button
                key={type}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-ink hover:bg-paper-tinted transition-colors"
                onClick={() => { onAddHotspotType(type); setDropdownOpen(false); }}
              >
                <Icon size={13} className="text-ink-soft flex-shrink-0" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        data-testid="toolbar-set-north"
        title="Set the North direction for GPS-based hotspot generation (N)"
        onClick={() => onModeChange(mode === 'north' ? 'navigate' : 'north')}
        className={clsx('btn gap-1.5', mode === 'north' && 'btn-primary')}
      >
        <Compass size={13} />
        North
        <kbd className="opacity-40 text-[10px] ml-0.5">N</kbd>
      </button>

      {mode === 'north' && northDraftHeading !== undefined && (
        <>
          <Sep />
          <span className="text-xs font-mono text-ink-soft tabular-nums" data-testid="north-heading-display">
            {northDraftHeading.toFixed(1)}°
          </span>
          <button data-testid="north-cancel" onClick={onNorthCancel} className="btn">
            Cancel
          </button>
          <button data-testid="north-confirm" onClick={() => onNorthConfirm(northDraftHeading ?? 0)} className="btn btn-accent">
            Confirm North
          </button>
        </>
      )}

      <Sep />

      <button title="Undo (Ctrl+Z)" onClick={onUndo} className="btn px-2">
        <Undo2 size={13} />
        <kbd className="opacity-40 text-[10px]">⌃Z</kbd>
      </button>
      <button title="Redo (Ctrl+Y)" onClick={onRedo} className="btn px-2">
        <Redo2 size={13} />
        <kbd className="opacity-40 text-[10px]">⌃Y</kbd>
      </button>

      <Sep />

      <button
        title="Save current camera angle as the default view for this scene"
        onClick={onSetDefaultView}
        className="btn gap-1.5"
        disabled={!onSetDefaultView}
      >
        <Bookmark size={13} />
        Set view
      </button>
      {onCaptureThumbnail && (
        <button
          title="Capture current view as strip thumbnail"
          onClick={onCaptureThumbnail}
          className="btn gap-1.5"
        >
          <Camera size={13} />
          Thumbnail
        </button>
      )}
      <button title="Duplicate scene (Ctrl+D)" onClick={onDuplicate} className="btn px-2">
        <Copy size={13} />
      </button>
      <button title="Delete this scene" onClick={onDelete} className="btn btn-danger px-2">
        <Trash2 size={13} />
      </button>

      <div className="flex-1" />

      <button title="Open full-screen preview with hotspot navigation" onClick={onPreview} className="btn btn-accent gap-1.5">
        <Eye size={13} />
        Preview
      </button>
    </div>
  );
}
