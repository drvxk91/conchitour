import { describe, it, expect } from 'vitest';

/**
 * Regression tests for language-switch URL building in the compiled tour.
 *
 * The inline JS in generateTourHtml (electron/main.ts) builds the target URL
 * when the user selects a new language:
 *   var p=window.location.pathname,
 *       m=p.match(/\/scene\/([^/]+)\//),
 *       s=_curScene||(m?m[1]:'');
 *   location.href = s ? '/scene/'+s+'/'+newLang+'/' : '/'+newLang+'/';
 *
 * This function mirrors that logic exactly so we can test edge-cases.
 */
function buildLangSwitchUrl(
  newLang: string,
  curScene: string,
  pathname: string,
): string {
  const m = pathname.match(/\/scene\/([^/]+)\//);
  const s = curScene || (m ? m[1] : '');
  return s ? `/scene/${s}/${newLang}/` : `/${newLang}/`;
}

describe('buildLangSwitchUrl (compiled-tour language select)', () => {
  it('uses _curScene when it is set', () => {
    expect(buildLangSwitchUrl('fr', 'lobby', '/scene/lobby/en/')).toBe('/scene/lobby/fr/');
  });

  it('extracts scene from pathname when _curScene is empty', () => {
    expect(buildLangSwitchUrl('fr', '', '/scene/lobby/en/')).toBe('/scene/lobby/fr/');
  });

  it('goes to tour root when neither _curScene nor scene in pathname', () => {
    expect(buildLangSwitchUrl('fr', '', '/en/')).toBe('/fr/');
  });

  it('goes to tour root when on the root page', () => {
    expect(buildLangSwitchUrl('de', '', '/')).toBe('/de/');
  });

  it('_curScene takes precedence over pathname slug', () => {
    // User navigated manually — _curScene is ahead of URL
    expect(buildLangSwitchUrl('fr', 'garden', '/scene/lobby/en/')).toBe('/scene/garden/fr/');
  });

  it('handles scene slugs with hyphens', () => {
    expect(buildLangSwitchUrl('es', 'main-entrance', '/scene/main-entrance/en/')).toBe(
      '/scene/main-entrance/es/',
    );
  });

  it('URL produced by _onScene (/scene/slug/lang/) is correctly parsed', () => {
    // _onScene pushes "/scene/lobby/en/" — change to French
    expect(buildLangSwitchUrl('fr', '', '/scene/lobby/en/')).toBe('/scene/lobby/fr/');
  });
});
