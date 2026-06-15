import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import {
  MousePointer2, Plus, AlignCenter, Compass,
  Undo2, Redo2, Copy, Trash2, Eye, ChevronDown,
  Link, Video, Type, ExternalLink, ClipboardList,
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
}

const HOTSPOT_TYPES: { type: Hotspot['type']; label: string; Icon: typeof Link }[] = [
  { type: 'link',     label: 'Link',     Icon: Link },
  { type: 'video',    label: 'Video',    Icon: Video },
  { type: 'text',     label: 'Text',     Icon: Type },
  { type: 'external', label: 'External', Icon: ExternalLink },
  { type: 'form',     label: 'Form',     Icon: ClipboardList },
];

export function SceneToolbar({ mode, onModeChange, onUndo, onRedo, onDuplicate, onDelete, onAddHotspotType, onNorthConfirm, onNorthCancel, northDraftHeading }: Props) {
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

  function stub(label: string) {
    alert(`${label} — not yet implemented`);
  }

  return (
    <div className="h-10 flex items-center gap-1 px-3 border-b border-line bg-paper flex-shrink-0">
      {/* Navigate */}
      <button
        title="Navigate (V)"
        onClick={() => onModeChange('navigate')}
        className={clsx(
          'btn text-xs gap-1',
          mode === 'navigate' && 'btn-primary'
        )}
      >
        <MousePointer2 size={13} />
        <span>Navigate</span>
        <kbd className="ml-1 text-[10px] opacity-50">V</kbd>
      </button>

      {/* Add hotspot dropdown */}
      <div ref={dropRef} className="relative">
        <button
          title="Add hotspot"
          onClick={() => setDropdownOpen((o) => !o)}
          className={clsx('btn text-xs gap-1', mode === 'hotspot' && 'btn-primary')}
        >
          <Plus size={13} />
          <span>Hotspot</span>
          <ChevronDown size={11} />
        </button>
        {dropdownOpen && (
          <div className="absolute top-full left-0 mt-1 bg-paper border border-line-strong rounded-lg shadow-lg z-50 w-36 py-1">
            {HOTSPOT_TYPES.map(({ type, label, Icon }) => (
              <button
                key={type}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ink hover:bg-paper-tinted"
                onClick={() => {
                  onAddHotspotType(type);
                  setDropdownOpen(false);
                }}
              >
                <Icon size={12} className="text-ink-soft" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-line mx-1" />

      <button title="Align horizon" onClick={() => stub('Align horizon')} className="btn text-xs gap-1">
        <AlignCenter size={13} />
      </button>
      <button
        data-testid="toolbar-set-north"
        title="Set North (N)"
        onClick={() => onModeChange(mode === 'north' ? 'navigate' : 'north')}
        className={clsx('btn text-xs gap-1', mode === 'north' && 'btn-primary')}
      >
        <Compass size={13} />
        <span>N</span>
        <kbd className="ml-1 text-[10px] opacity-50">N</kbd>
      </button>

      {mode === 'north' && northDraftHeading !== undefined && (
        <>
          <div className="w-px h-5 bg-line mx-1" />
          <span className="text-xs text-ink-soft" data-testid="north-heading-display">
            {northDraftHeading.toFixed(1)}°
          </span>
          <button
            data-testid="north-cancel"
            onClick={onNorthCancel}
            className="btn text-xs"
          >
            Cancel
          </button>
          <button
            data-testid="north-confirm"
            onClick={() => onNorthConfirm(northDraftHeading)}
            className="btn btn-primary text-xs"
          >
            Confirm North
          </button>
        </>
      )}

      <div className="w-px h-5 bg-line mx-1" />

      <button title="Undo (Ctrl+Z)" onClick={onUndo} className="btn text-xs">
        <Undo2 size={13} />
        <kbd className="ml-1 text-[10px] opacity-50">⌃Z</kbd>
      </button>
      <button title="Redo (Ctrl+Y)" onClick={onRedo} className="btn text-xs">
        <Redo2 size={13} />
        <kbd className="ml-1 text-[10px] opacity-50">⌃Y</kbd>
      </button>

      <div className="w-px h-5 bg-line mx-1" />

      <button title="Duplicate scene (Ctrl+D)" onClick={onDuplicate} className="btn text-xs gap-1">
        <Copy size={13} />
      </button>
      <button title="Delete scene" onClick={onDelete} className="btn btn-danger text-xs gap-1">
        <Trash2 size={13} />
      </button>

      <div className="w-px h-5 bg-line mx-1" />

      <button title="Preview (P)" onClick={() => stub('Preview')} className="btn text-xs gap-1">
        <Eye size={13} />
        <span>Preview</span>
        <kbd className="ml-1 text-[10px] opacity-50">P</kbd>
      </button>
    </div>
  );
}
