import { useProject, type ScreenId } from '@/store/project';
import {
  Upload, Image, Map, Tags, Settings, Search, Languages,
  Palette, Share2, Puzzle, Package,
} from 'lucide-react';
import clsx from 'clsx';

interface NavEntry { id: ScreenId; label: string; Icon: typeof Upload; badge?: () => string | number | null; }

export function Sidebar() {
  const { activeScreen, setActiveScreen, project } = useProject();

  const sections: { title: string; entries: NavEntry[] }[] = [
    {
      title: 'Content',
      entries: [
        { id: 'import',     label: 'Import',     Icon: Upload, badge: () => project.scenes.length || null },
        { id: 'scenes',     label: 'Scenes',     Icon: Image,  badge: () => project.scenes.length || null },
        { id: 'map',        label: 'Map',        Icon: Map },
        { id: 'categories', label: 'Categories', Icon: Tags,   badge: () => project.categories.length },
      ],
    },
    {
      title: 'Settings',
      entries: [
        { id: 'project',   label: 'Project',   Icon: Settings },
        { id: 'seo',       label: 'SEO',       Icon: Search },
        { id: 'languages', label: 'Languages', Icon: Languages, badge: () => project.languages.available.length },
        { id: 'branding',  label: 'Branding',  Icon: Palette },
        { id: 'share',     label: 'Share',     Icon: Share2 },
        { id: 'modules',   label: 'Modules',   Icon: Puzzle },
      ],
    },
    {
      title: 'Publish',
      entries: [
        { id: 'compile', label: 'Compile', Icon: Package },
      ],
    },
  ];

  return (
    <nav className="w-56 bg-paper border-r border-line flex-shrink-0 overflow-y-auto">
      <div className="p-3 space-y-4">
        {sections.map((sec) => (
          <div key={sec.title}>
            <div className="text-[10px] font-medium text-ink-faded uppercase tracking-wider px-2 mb-1">
              {sec.title}
            </div>
            {sec.entries.map(({ id, label, Icon, badge }) => {
              const active = activeScreen === id;
              const b = badge ? badge() : null;
              return (
                <button
                  key={id}
                  onClick={() => setActiveScreen(id)}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm mb-px text-left transition-colors',
                    active ? 'bg-ink text-paper' : 'text-ink hover:bg-paper-tinted'
                  )}
                >
                  <Icon size={15} className={active ? 'text-paper' : 'text-ink-soft'} />
                  <span className="flex-1">{label}</span>
                  {b != null && (
                    <span className={clsx(
                      'text-[10px] px-1.5 py-0.5 rounded',
                      active ? 'bg-paper/20' : 'bg-paper-tinted text-ink-soft'
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
