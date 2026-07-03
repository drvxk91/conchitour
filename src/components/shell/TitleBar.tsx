import { useState } from 'react';
import clsx from 'clsx';
import { Save, Clock, AlertTriangle, ExternalLink } from 'lucide-react';
import { useProject } from '@/store/project';
import { useTrialState } from '@/lib/trial';
import { UpgradeModal } from '@/components/UpgradeModal';

// On macOS with titleBarStyle:'hiddenInset', the real traffic lights appear at
// top-left inside the window — we need left padding to avoid overlapping them.
// macOS also keeps its native top-of-screen app menu, so File/Edit/... are not
// duplicated in-window there — only Windows/Linux render the menu buttons below.
const isMac = navigator.userAgent.includes('Mac');

// Must match the top-level `label`s in setupAppMenu() (electron/main.ts) exactly —
// each button pops that same Menu's submenu via IPC instead of duplicating it.
const MENUS = ['File', 'Edit', 'View', 'Build', 'Window', 'Help'];

export function TitleBar() {
  const { project, isDirty, projectDir, clearDirty } = useProject();
  const trial = useTrialState();
  const [showModal, setShowModal] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const projectName = project.meta.name || 'Untitled';
  const folderName = projectDir ? projectDir.split(/[\\/]/).pop()?.replace('.conchitour', '') : null;
  const displayName = folderName || projectName;

  async function handleSave() {
    try {
      await window.conchitour.saveProject(project);
      clearDirty();
    } catch { /* handled in App.tsx menu listener */ }
  }

  async function openMenuAt(label: string, e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setOpenMenu(label);
    try {
      await window.conchitour.popupMenu(label, rect.left, rect.bottom);
    } finally {
      setOpenMenu(null);
    }
  }

  const timeLeft = trial && !trial.isExpired
    ? (trial.daysRemaining > 0
      ? `${trial.daysRemaining}d`
      : `${trial.hoursRemaining}h`)
    : null;

  return (
    <>
      <header
        className="titlebar-drag h-10 bg-paper border-b border-line flex items-center gap-3 select-none flex-shrink-0"
        style={isMac
          ? { paddingLeft: 80, paddingRight: 12 }
          // Windows/Linux: constrain to the area left of the native overlay
          // buttons (env vars come from titleBarOverlay; 100%/0px if absent).
          : { width: 'env(titlebar-area-width, 100%)', marginLeft: 'env(titlebar-area-x, 0px)', paddingLeft: 10, paddingRight: 12 }}
      >
        {/* ── Logo ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <svg width="15" height="15" viewBox="0 0 512 512" fill="none" aria-hidden="true" className="flex-shrink-0">
            <path d="M256 256 Q256 112 368 112 Q480 112 480 256 Q480 420 312 440 Q112 460 72 280 Q32 96 240 32 Q424 -24 464 128" stroke="#4B9FE1" strokeWidth="18" fill="none" strokeLinecap="round"/>
            <path d="M256 256 Q256 176 320 176 Q392 176 392 256 Q392 344 296 352 Q184 360 172 272 Q160 176 248 148" stroke="#D4A574" strokeWidth="12" fill="none" strokeLinecap="round"/>
            <circle cx="256" cy="256" r="16" fill="#4B9FE1"/>
          </svg>
          {isMac && <span className="text-xs font-semibold text-ink tracking-tight">Conchitour</span>}
        </div>

        {/* ── Menu bar (Win/Linux only — macOS keeps the native top-of-screen menu) ── */}
        {!isMac && (
          <nav className="titlebar-no-drag flex items-center gap-0.5 flex-shrink-0 -ml-1">
            {MENUS.map((label) => (
              <button
                key={label}
                onClick={(e) => openMenuAt(label, e)}
                className={clsx(
                  'px-2 py-1 text-[13px] rounded transition-colors',
                  openMenu === label ? 'bg-paper-tinted text-ink' : 'text-ink-soft hover:bg-paper-tinted hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </nav>
        )}

        {/* ── Project identity ─────────────────────────────────────────── */}
        {isMac && displayName && (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-line-strong text-sm font-light">·</span>
            <span className="text-xs text-ink-soft truncate max-w-[180px]">{displayName}</span>
          </div>
        )}

        {/* ── Spacer ───────────────────────────────────────────────────── */}
        <div className="flex-1" />

        {!isMac && displayName && (
          <span className="text-xs text-ink-soft truncate max-w-[240px]">{displayName}</span>
        )}

        <div className="titlebar-no-drag flex items-center gap-2 flex-shrink-0">
          {/* ── Trial info (compact, inline) ──────────────────────────────── */}
          {trial?.isExpired && (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-[11px] text-red-600 font-medium">
                <AlertTriangle size={11} />
                Trial expired
              </span>
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1 text-[11px] font-semibold text-white bg-red-500 hover:bg-red-600 px-2.5 py-0.5 rounded-full transition-colors whitespace-nowrap"
              >
                Upgrade for $149 <ExternalLink size={9} />
              </button>
            </div>
          )}

          {trial && !trial.isExpired && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 text-[11px] text-amber-700 hover:text-amber-900 transition-colors"
                title="Trial details"
              >
                <Clock size={11} className="text-amber-500 flex-shrink-0" />
                <span className="font-medium">{timeLeft}</span>
                <span className="text-amber-600/50">·</span>
                <span>{trial.scenesUsed}/{trial.limits.maxScenes} scenes</span>
                <span className="text-amber-600/50">·</span>
                <span>{trial.aiCallsRemaining}/{trial.limits.maxAiCalls} AI</span>
              </button>
              <button
                onClick={() => window.conchitour.openUrl('https://conchitour.com/pricing/')}
                className="flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300/60 px-2.5 py-0.5 rounded-full transition-colors whitespace-nowrap"
              >
                Upgrade <ExternalLink size={9} />
              </button>
            </div>
          )}

          {/* ── Separator ────────────────────────────────────────────────── */}
          {trial && <div className="w-px h-4 bg-line mx-0.5" />}

          {/* ── Save state ───────────────────────────────────────────────── */}
          {isDirty ? (
            <button
              onClick={handleSave}
              title="Save project (Ctrl+S)"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-accent text-white hover:opacity-90 transition-opacity"
            >
              <Save size={11} />
              Save
            </button>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-ink-faded">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500/70 inline-block" />
              Saved
            </span>
          )}
        </div>
      </header>

      {showModal && <UpgradeModal feature="generic" onClose={() => setShowModal(false)} />}
    </>
  );
}
