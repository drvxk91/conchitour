import { useCallback, useRef, useState } from 'react';
import { ArrowRight, FolderOpen, Plus, Sparkles } from 'lucide-react';
import { useProject } from '@/store/project';
import { NewProjectWizard } from '@/screens/NewProjectWizard';
import type { Project } from '@/types';

export function WelcomeScreen() {
  const { loadProjectData, setProjectDir, clearDirty, setActiveScreen } = useProject();
  const [naming, setNaming] = useState(false);
  const [nameValue, setNameValue] = useState('My Tour');
  const [showWizard, setShowWizard] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const openNaming = useCallback(() => {
    setNaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  const confirmNew = useCallback(async () => {
    const name = nameValue.trim();
    if (!name) return;
    const folder = await window.conchitour.showProjectFolderDialog();
    if (!folder) return;
    setNaming(false);
    const result = await window.conchitour.newProject(folder, name);
    setProjectDir(result.projectDir);
    clearDirty();
    setActiveScreen('import');
  }, [nameValue, setProjectDir, clearDirty, setActiveScreen]);

  const handleOpen = useCallback(async () => {
    const result = await window.conchitour.openProject();
    if (!result) return;
    if ('error' in result) { alert(result.error); return; }
    loadProjectData(result.project as Project, result.projectDir);
  }, [loadProjectData]);

  return (
    <div className="h-full flex flex-col items-center justify-center bg-paper-soft select-none">
      {showWizard && <NewProjectWizard onClose={() => setShowWizard(false)} initialStep="api-key" />}
      <div className="mb-12 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-ink-base">Conchitour</h1>
        <p className="text-sm text-ink-soft mt-1">Architect your virtual tours.</p>
      </div>

      {naming ? (
        <div className="flex flex-col items-center gap-4 w-72">
          <div className="w-full">
            <label className="block text-xs text-ink-soft mb-1.5">Project name</label>
            <input
              ref={inputRef}
              autoFocus
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmNew();
                if (e.key === 'Escape') setNaming(false);
              }}
              className="w-full px-3 py-2 rounded-lg border border-line bg-paper text-sm text-ink-base outline-none focus:border-ink-soft"
              placeholder="My Tour"
            />
          </div>
          <button
            onClick={confirmNew}
            disabled={!nameValue.trim()}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-ink-base text-sm font-semibold text-ink-base hover:bg-ink-base hover:text-paper disabled:opacity-40 transition-colors"
          >
            Choose folder <ArrowRight size={15} />
          </button>
          <button onClick={() => setNaming(false)} className="text-xs text-ink-faded hover:text-ink-soft transition-colors">
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex gap-4">
          {/* New project — two sub-options in one card */}
          <div className="w-44 rounded-xl border border-line bg-paper p-5 flex flex-col gap-3">
            <div className="text-xs text-ink-faded font-medium">New project</div>
            <button
              onClick={openNaming}
              className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-paper-strong hover:border-ink-soft text-sm font-medium text-ink-base transition-all"
            >
              <Plus size={14} className="text-ink-soft group-hover:text-ink-base transition-colors shrink-0" />
              Quick start
            </button>
            <button
              onClick={() => { setShowWizard(true); }}
              className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-accent/40 bg-accent/5 hover:bg-accent/10 hover:border-accent text-sm font-medium text-accent transition-all"
            >
              <Sparkles size={14} className="shrink-0" />
              AI setup
            </button>
          </div>

          {/* Open project */}
          <button
            onClick={handleOpen}
            className="group flex flex-col items-center gap-3 w-44 py-8 px-6 rounded-xl border border-line bg-paper hover:border-ink-soft hover:shadow-sm transition-all"
          >
            <FolderOpen size={28} className="text-ink-soft group-hover:text-ink-base transition-colors" />
            <div className="text-center">
              <div className="text-sm font-medium text-ink-base">Open project</div>
              <div className="text-xs text-ink-faded mt-0.5">Load a .conchitour file</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
