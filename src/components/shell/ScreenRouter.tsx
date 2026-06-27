import { Component, type ReactNode } from 'react';
import { useProject } from '@/store/project';
import { ImportScreen } from '@/screens/ImportScreen';
import { ScenesScreen } from '@/screens/ScenesScreen';
import { MapScreen } from '@/screens/MapScreen';
import { CategoriesScreen } from '@/screens/CategoriesScreen';
import { ProjectScreen } from '@/screens/ProjectScreen';
import { SeoScreen } from '@/screens/SeoScreen';
import { LanguagesScreen } from '@/screens/LanguagesScreen';
import { PagesScreen } from '@/screens/PagesScreen';
import { BrandingScreen } from '@/screens/BrandingScreen';
import { ShareScreen } from '@/screens/ShareScreen';
import { ModulesScreen } from '@/screens/ModulesScreen';
import { AnalyticsScreen } from '@/screens/AnalyticsScreen';
import { AuditScreen } from '@/screens/AuditScreen';
import { CompileScreen } from '@/screens/CompileScreen';
import { ContentScreen } from '@/screens/ContentScreen';

class ScreenErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
          <p className="text-sm font-medium text-red-600">This screen encountered an error.</p>
          <pre className="text-xs text-ink-faded bg-paper-strong rounded p-3 max-w-lg overflow-auto whitespace-pre-wrap">
            {(this.state.error as Error).message}
          </pre>
          <button
            className="btn"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ActiveScreen() {
  const { activeScreen } = useProject();
  switch (activeScreen) {
    case 'import':     return <ImportScreen />;
    case 'scenes':     return <ScenesScreen />;
    case 'map':        return <MapScreen />;
    case 'categories': return <CategoriesScreen />;
    case 'content':    return <ContentScreen />;
    case 'project':    return <ProjectScreen />;
    case 'seo':        return <SeoScreen />;
    case 'languages':  return <LanguagesScreen />;
    case 'pages':      return <PagesScreen />;
    case 'branding':   return <BrandingScreen />;
    case 'share':      return <ShareScreen />;
    case 'modules':    return <ModulesScreen />;
    case 'analytics':  return <AnalyticsScreen />;
    case 'audit':      return <AuditScreen />;
    case 'compile':    return <CompileScreen />;
  }
}

export function ScreenRouter() {
  return (
    <ScreenErrorBoundary>
      <ActiveScreen />
    </ScreenErrorBoundary>
  );
}
