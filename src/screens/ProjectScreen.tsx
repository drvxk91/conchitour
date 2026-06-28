import { Lock } from 'lucide-react';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { useTrialState } from '@/lib/trial';
import { TRIAL_LIMITS } from '@/types/license';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-ink-faded uppercase tracking-wide">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-ink-faded/70">{hint}</p>}
    </div>
  );
}

const inputCls =
  'w-full bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink placeholder-ink-faded focus:outline-none focus:border-accent';

export function ProjectScreen() {
  const { project, updateMeta } = useProject();
  const m = project.meta;
  const trial = useTrialState();
  const copyrightLocked = trial !== null;

  return (
    <ScreenShell title="Project" subtitle="Global metadata: name, creator, copyright, publication URL.">
      <div className="max-w-2xl mx-auto space-y-5">
        <Field label="Tour name">
          <input
            className={inputCls}
            defaultValue={m.name}
            placeholder="My virtual tour"
            onBlur={(e) => updateMeta({ name: e.target.value })}
          />
        </Field>

        <Field label="Creator / studio">
          <input
            className={inputCls}
            defaultValue={m.creator}
            placeholder="Acme Photography"
            onBlur={(e) => updateMeta({ creator: e.target.value })}
          />
        </Field>

        <Field label="Contact email">
          <input
            type="email"
            className={inputCls}
            defaultValue={m.contactEmail}
            placeholder="hello@example.com"
            onBlur={(e) => updateMeta({ contactEmail: e.target.value })}
          />
        </Field>

        <Field label="Copyright" hint={copyrightLocked ? undefined : 'Shown in the viewer footer.'}>
          {copyrightLocked ? (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
              <Lock size={13} className="text-amber-500 flex-shrink-0" />
              <span className="text-sm text-amber-800">{TRIAL_LIMITS.forcedCopyright}</span>
              <span className="ml-auto text-[11px] text-amber-600">Trial copyright is fixed — upgrade to set your own</span>
            </div>
          ) : (
            <input
              className={inputCls}
              defaultValue={m.copyright}
              placeholder="© 2025 Acme Photography"
              onBlur={(e) => updateMeta({ copyright: e.target.value })}
            />
          )}
        </Field>

        <Field label="Publication URL" hint="Where the compiled tour will be hosted (used in SEO and share cards).">
          <input
            className={inputCls}
            defaultValue={m.publicationUrl}
            placeholder="https://tours.example.com/my-tour"
            onBlur={(e) => updateMeta({ publicationUrl: e.target.value })}
          />
        </Field>

        <Field label="Short description" hint="Used in Open Graph meta and the sitemap.">
          <textarea
            rows={3}
            className={inputCls + ' resize-none'}
            defaultValue={m.shortDescription}
            placeholder="Explore our hotel in 360°…"
            onBlur={(e) => updateMeta({ shortDescription: e.target.value })}
          />
        </Field>

        <p className="text-[11px] text-ink-faded pt-2">Changes are saved automatically when you leave each field.</p>
      </div>
    </ScreenShell>
  );
}
