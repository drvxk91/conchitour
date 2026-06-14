import { ScreenShell } from '@/components/shell/ScreenShell';

export function ModulesScreen() {
  return (
    <ScreenShell title="Modules" subtitle="VR, gyroscope, fullscreen, feedback, DeepL API key.">
      <div className="text-sm text-ink-soft border border-dashed border-line-strong rounded-lg p-8 text-center">
        Screen "Modules" — to be implemented.
        <div className="text-xs text-ink-faded mt-2">See CLAUDE.md for the spec.</div>
      </div>
    </ScreenShell>
  );
}
