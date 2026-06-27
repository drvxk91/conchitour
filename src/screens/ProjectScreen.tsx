import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';

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

        <Field label="Copyright" hint="Shown in the viewer footer.">
          <input
            className={inputCls}
            defaultValue={m.copyright}
            placeholder="© 2025 Acme Photography"
            onBlur={(e) => updateMeta({ copyright: e.target.value })}
          />
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
