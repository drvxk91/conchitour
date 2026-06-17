import { useProject } from '@/store/project';
import { Check, Circle } from 'lucide-react';

export function TitleBar() {
  const { project, isDirty, projectDir } = useProject();
  const projectName = project.meta.name || 'Untitled';
  const folderName = projectDir ? projectDir.split(/[\\/]/).pop()?.replace('.conchitect', '') : null;
  return (
    <header className="h-9 bg-paper-soft border-b border-line flex items-center px-4 gap-3 select-none">
      <div className="flex gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
        <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
        <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
      </div>
      <div className="text-xs text-ink-soft ml-2">
        <strong className="text-ink font-medium">Conchitect</strong>
        <span className="text-ink-faded"> — {folderName || projectName}</span>
        {isDirty && <span className="ml-1 text-amber-500" title="Unsaved changes">•</span>}
      </div>
      <div className={`ml-auto text-xs flex items-center gap-1 ${isDirty ? 'text-amber-500' : 'text-green-700'}`}>
        {isDirty
          ? <><Circle size={10} className="fill-amber-400 stroke-none" /> unsaved</>
          : <><Check size={12} /> saved</>}
      </div>
    </header>
  );
}
