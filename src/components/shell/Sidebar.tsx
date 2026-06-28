import { useProject, type ScreenId } from '@/store/project';
import {
  Upload, Image, Map, Tags, Settings, Search, Languages,
  Palette, Share2, Puzzle, Package, FileText, BarChart3, ClipboardCheck, Type, Brain, KeyRound,
} from 'lucide-react';
import clsx from 'clsx';
import { GA_ID_RE } from '@/screens/AnalyticsScreen';

interface NavEntry { id: ScreenId; label: string; Icon: typeof Upload; badge?: () => string | number | null; }

export function Sidebar() {
  const { activeScreen, setActiveScreen, project, isCompiling } = useProject();

  const sections: { title: string; entries: NavEntry[] }[] = [
    {
      title: 'Content',
      entries: [
        { id: 'import',     label: 'Import',     Icon: Upload, badge: () => project.scenes.length || null },
        { id: 'scenes',     label: 'Scenes',     Icon: Image,  badge: () => project.scenes.length || null },
        { id: 'map',        label: 'Map',        Icon: Map },
        { id: 'categories', label: 'Categories', Icon: Tags,   badge: () => project.categories.length || null },
        { id: 'content',    label: 'Content',    Icon: Type },
      ],
    },
    {
      title: 'Presentation',
      entries: [
        { id: 'branding',  label: 'Branding',  Icon: Palette },
        { id: 'languages', label: 'Languages', Icon: Languages, badge: () => project.languages.available.length || null },
        { id: 'pages',     label: 'Pages',     Icon: FileText,  badge: () => (project.pages ?? []).filter((p) => p.enabled).length || null },
        { id: 'share',     label: 'Share',     Icon: Share2 },
      ],
    },
    {
      title: 'Configuration',
      entries: [
        { id: 'project',   label: 'Project',   Icon: Settings },
        { id: 'seo',       label: 'SEO',       Icon: Search },
        { id: 'modules',   label: 'Modules',   Icon: Puzzle },
        {
          id: 'analytics', label: 'Analytics', Icon: BarChart3,
          badge: () => {
            const a = project.analytics;
            if (a?.enabled && !GA_ID_RE.test(a.measurementId ?? '')) return '!';
            return null;
          },
        },
        { id: 'ai',        label: 'AI',         Icon: Brain },
      ],
    },
    {
      title: 'Publish',
      entries: [
        { id: 'audit',   label: 'Audit',   Icon: ClipboardCheck },
        { id: 'compile', label: 'Compile',  Icon: Package, badge: () => isCompiling ? '…' : null },
        { id: 'license', label: 'License',  Icon: KeyRound },
      ],
    },
  ];

  return (
    <nav className="w-48 bg-paper border-r border-line flex-shrink-0 overflow-y-auto flex flex-col">
      <div className="p-2.5 flex-1">
        {sections.map((sec, si) => (
          <div key={sec.title} className={si > 0 ? 'mt-4' : ''}>
            <div className="text-[9px] font-semibold text-ink-faded uppercase tracking-widest px-2.5 mb-1">
              {sec.title}
            </div>
            {sec.entries.map(({ id, label, Icon, badge }) => {
              const active = activeScreen === id;
              const b = badge ? badge() : null;
              return (
                <button
                  key={id}
                  onClick={() => setActiveScreen(id)}
                  data-testid={`nav-${id}`}
                  className={clsx(
                    'w-full flex items-center gap-2.5 pl-2.5 pr-2 py-1.5 rounded-md text-sm mb-px text-left transition-all border-l-2',
                    active
                      ? 'border-accent bg-accent/8 text-accent font-medium'
                      : 'border-transparent text-ink-soft hover:bg-paper-tinted hover:text-ink'
                  )}
                >
                  <Icon size={14} className={active ? 'text-accent' : 'text-ink-faded'} />
                  <span className="flex-1 text-xs">{label}</span>
                  {b != null && (
                    <span className={clsx(
                      'text-[10px] px-1.5 py-0.5 rounded-full font-semibold min-w-[18px] text-center',
                      active ? 'bg-accent/15 text-accent' : 'bg-paper-strong text-ink-faded'
                    )}>{b}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
