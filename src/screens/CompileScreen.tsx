import { ScreenShell } from '@/components/shell/ScreenShell';

export function CompileScreen() {
  return (
    <ScreenShell title="Compile" subtitle="Generate the static site and produce a zip file ready to host.">
      <div className="text-sm text-ink-soft border border-dashed border-line-strong rounded-lg p-8 text-center">
        Screen "Compile" — to be implemented.
        <div className="text-xs text-ink-faded mt-2">See CLAUDE.md for the spec.</div>
      </div>
    </ScreenShell>
  );
}
