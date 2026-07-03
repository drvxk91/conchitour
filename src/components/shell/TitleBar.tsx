import { useProject } from '@/store/project';
import { Save } from 'lucide-react';

// On macOS with titleBarStyle:'hiddenInset', the real traffic lights appear at
// top-left inside the window — we need left padding to avoid overlapping them.
// On Windows, the native title bar is fully visible and already shows the app
// name, so we hide the duplicate branding from our custom header.
const isMac = navigator.userAgent.includes('Mac');

export function TitleBar() {
  const { project, isDirty, projectDir, clearDirty } = useProject();
  const projectName = project.meta.name || 'Untitled';
  const folderName = projectDir ? projectDir.split(/[\\/]/).pop()?.replace('.conchitour', '') : null;
  const displayName = folderName || projectName;

  async function handleSave() {
    try {
      await window.conchitour.saveProject(project);
      clearDirty();
    } catch { /* handled in App.tsx menu listener */ }
  }

  return (
    <header
      className="h-10 bg-paper border-b border-line flex items-center gap-3 select-none flex-shrink-0 pr-4"
      style={{ paddingLeft: isMac ? 80 : 16 }}
    >
      {/* macOS: real traffic lights occupy the left 76px — just show project name */}
      {isMac && displayName && (
        <div className="flex items-center gap-1.5">
          <svg width="16" height="16" viewBox="0 0 512 512" fill="none" aria-hidden="true" className="flex-shrink-0">
            <path d="M256 256 Q256 112 368 112 Q480 112 480 256 Q480 420 312 440 Q112 460 72 280 Q32 96 240 32 Q424 -24 464 128" stroke="#4B9FE1" strokeWidth="18" fill="none" strokeLinecap="round"/>
            <path d="M256 256 Q256 176 320 176 Q392 176 392 256 Q392 344 296 352 Q184 360 172 272 Q160 176 248 148" stroke="#D4A574" strokeWidth="12" fill="none" strokeLinecap="round"/>
            <circle cx="256" cy="256" r="16" fill="#4B9FE1"/>
          </svg>
          <span className="text-xs font-semibold text-ink tracking-tight">Conchitour</span>
          <span className="text-line-strong text-sm font-light">·</span>
          <span className="text-xs text-ink-soft truncate max-w-[200px]">{displayName}</span>
        </div>
      )}

      {/* Windows: native title bar already shows "Conchitour" — only show project name */}
      {!isMac && displayName && (
        <span className="text-xs text-ink-soft truncate max-w-[280px]">{displayName}</span>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        {isDirty && (
          <button
            onClick={handleSave}
            title="Save project (Ctrl+S)"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-accent text-white hover:opacity-90 transition-opacity"
          >
            <Save size={11} />
            Save
          </button>
        )}
        {!isDirty && (
          <span className="flex items-center gap-1 text-[11px] text-ink-faded">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500/70 inline-block" />
            Saved
          </span>
        )}
      </div>
    </header>
  );
}
