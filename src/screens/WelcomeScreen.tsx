import { useCallback } from 'react';
import { FolderOpen, Plus } from 'lucide-react';
import { useProject } from '@/store/project';
import type { Project } from '@/types';

export function WelcomeScreen() {
  const { loadProjectData, setProjectDir, clearDirty, setActiveScreen } = useProject();

  const handleNew = useCallback(async () => {
    const name = window.prompt('Project name:', 'My Tour');
    if (!name) return;
    const folder = await window.conchitect.showFolderDialog();
    if (!folder) return;
    const result = await window.conchitect.newProject(folder, name);
    setProjectDir(result.projectDir);
    clearDirty();
    setActiveScreen('import');
  }, [setProjectDir, clearDirty, setActiveScreen]);

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

      <div className="flex gap-4">
        <button
          onClick={handleNew}
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
    </div>
  );
}
