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
import { CompileScreen } from '@/screens/CompileScreen';

export function ScreenRouter() {
  const { activeScreen } = useProject();
  switch (activeScreen) {
    case 'import':     return <ImportScreen />;
    case 'scenes':     return <ScenesScreen />;
    case 'map':        return <MapScreen />;
    case 'categories': return <CategoriesScreen />;
    case 'project':    return <ProjectScreen />;
    case 'seo':        return <SeoScreen />;
    case 'languages':  return <LanguagesScreen />;
    case 'pages':      return <PagesScreen />;
    case 'branding':   return <BrandingScreen />;
    case 'share':      return <ShareScreen />;
    case 'modules':    return <ModulesScreen />;
    case 'compile':    return <CompileScreen />;
  }
}
