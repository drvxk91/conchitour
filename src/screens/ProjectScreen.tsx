import { ScreenShell } from '@/components/shell/ScreenShell';

export function ProjectScreen() {
  return (
    <ScreenShell title="Project" subtitle="Project metadata: name, creator, copyright, publication URL.">
      <div className="text-sm text-ink-soft border border-dashed border-line-strong rounded-lg p-8 text-center">
        Screen "Project" — to be implemented.
        <div className="text-xs text-ink-faded mt-2">See CLAUDE.md for the spec.</div>
      </div>
    </ScreenShell>
  );
}
