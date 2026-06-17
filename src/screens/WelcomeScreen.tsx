import { useCallback, useRef, useState } from 'react';
import { ArrowRight, FolderOpen, Plus, X } from 'lucide-react';
import { useProject } from '@/store/project';
import type { Project } from '@/types';

export function WelcomeScreen() {
  const { loadProjectData, setProjectDir, clearDirty, setActiveScreen } = useProject();
  const [naming, setNaming] = useState(false);
  const [nameValue, setNameValue] = useState('My Tour');
  const inputRef = useRef<HTMLInputElement>(null);

  const openNaming = useCallback(() => {
    setNaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  const confirmNew = useCallback(async () => {
    const name = nameValue.trim();
    if (!name) return;
    const folder = await window.conchitect.showFolderDialog();
    if (!folder) return;
    setNaming(false);
    const result = await window.conchitect.newProject(folder, name);
    setProjectDir(result.projectDir);
    clearDirty();
    setActiveScreen('import');
  }, [nameValue, setProjectDir, clearDirty, setActiveScreen]);

  const handleOpen = useCallback(async () => {
    const result = await window.conchitect.openProject();
    if (!result) return;
    if ('error' in result) { alert(result.error); return; }
    loadProjectData(result.project as Project, result.projectDir);
  }, [loadProjectData]);

  return (
    <div className="h-full flex flex-col items-center justify-center bg-paper-soft select-none">
      <div className="mb-12 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-ink-base">Conchitect</h1>
        <p className="text-sm text-ink-soft mt-1">Architect your virtual tours.</p>
      </div>

      {naming ? (
        <div className="flex flex-col items-center gap-3 w-80">
          <p className="text-sm text-ink-soft">Project name</p>
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
          <div className="flex gap-2 w-full">
            <button
              onClick={() => setNaming(false)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-line text-xs text-ink-soft hover:bg-paper transition-colors"
            >
              <X size={13} /> Cancel
            </button>
            <button
              onClick={confirmNew}
              disabled={!nameValue.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-ink-base text-paper text-xs font-medium hover:bg-ink-soft disabled:opacity-40 transition-colors"
            >
              Choose folder <ArrowRight size={13} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-4">
          <button
            onClick={openNaming}
            className="group flex flex-col items-center gap-3 w-44 py-8 px-6 rounded-xl border border-line bg-paper hover:border-ink-soft hover:shadow-sm transition-all"
          >
            <Plus size={28} className="text-ink-soft group-hover:text-ink-base transition-colors" />
            <div className="text-center">
              <div className="text-sm font-medium text-ink-base">New project</div>
              <div className="text-xs text-ink-faded mt-0.5">Start from scratch</div>
            </div>
          </button>

          <button
            onClick={handleOpen}
            className="group flex flex-col items-center gap-3 w-44 py-8 px-6 rounded-xl border border-line bg-paper hover:border-ink-soft hover:shadow-sm transition-all"
          >
            <FolderOpen size={28} className="text-ink-soft group-hover:text-ink-base transition-colors" />
            <div className="text-center">
              <div className="text-sm font-medium text-ink-base">Open project</div>
              <div className="text-xs text-ink-faded mt-0.5">Load a .conchitect file</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
