import { ScreenShell } from '@/components/shell/ScreenShell';

export function MapScreen() {
  return (
    <ScreenShell title="Map" subtitle="Drag pins on the map. Link hotspots are computed by GPS triangulation.">
      <div className="text-sm text-ink-soft border border-dashed border-line-strong rounded-lg p-8 text-center">
        Screen "Map" — to be implemented.
        <div className="text-xs text-ink-faded mt-2">See CLAUDE.md for the spec.</div>
      </div>
    </ScreenShell>
  );
}
