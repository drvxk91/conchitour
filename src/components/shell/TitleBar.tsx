import { useProject } from '@/store/project';
import { Check } from 'lucide-react';

export function TitleBar() {
  const { project } = useProject();
  return (
    <header className="h-9 bg-paper-soft border-b border-line flex items-center px-4 gap-3 select-none">
      <div className="flex gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
        <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
        <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
      </div>
      <div className="text-xs text-ink-soft ml-2">
        <strong className="text-ink font-medium">Conchitect</strong>
        <span className="text-ink-faded"> — {project.meta.name}</span>
      </div>
      <div className="ml-auto text-xs text-green-700 flex items-center gap-1">
        <Check size={12} /> saved
      </div>
    </header>
  );
}
