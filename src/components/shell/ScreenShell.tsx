import { ReactNode } from 'react';

export function ScreenShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-full flex flex-col">
      <div className="sticky top-0 z-10 px-8 py-5 bg-paper/95 backdrop-blur border-b border-line">
        <h1 className="text-base font-semibold text-ink tracking-tight">{title}</h1>
        {subtitle && <p className="text-xs text-ink-faded mt-0.5 leading-relaxed">{subtitle}</p>}
      </div>
      <div className="px-8 py-7 flex-1">
        {children}
      </div>
    </div>
  );
}
