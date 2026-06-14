import { ScreenShell } from '@/components/shell/ScreenShell';

export function BrandingScreen() {
  return (
    <ScreenShell title="Branding" subtitle="Logo, loader, opening scene, primary colors.">
      <div className="text-sm text-ink-soft border border-dashed border-line-strong rounded-lg p-8 text-center">
        Screen "Branding" — to be implemented.
        <div className="text-xs text-ink-faded mt-2">See CLAUDE.md for the spec.</div>
      </div>
    </ScreenShell>
  );
}
