import { ReactNode } from 'react';

export function ScreenShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-xl font-medium mb-1">{title}</h1>
      {subtitle && <p className="text-sm text-ink-soft mb-6">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}
