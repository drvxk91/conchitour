# Session Report — Sprints D, E, F, G

## Summary

| Subtask | Status | Notes | Commit |
|---------|--------|-------|--------|
| D1 — Hotspot dragging restored | DONE | Also includes D3 (link preview) | 93e1c65 |
| D2 — Set North preserves view | DONE | Also includes D4 (map auto-fit) | 872b68f |
| D3 — Link hotspot hover preview | DONE | 120×70 thumbnail + scene name | 93e1c65 |
| D4 — Map auto-zoom + reliability | DONE | Auto-fit button added | 872b68f |
| E1 — Categories screen CRUD | DONE | Grid, modal, multilingual, icons, validation | 019c437 |
| E2 — Excel import/export | DONE | SheetJS, IPC handlers, store apply logic | 26a11e3 |
| F — All 6 metadata screens | DONE | Project, SEO, Languages, Branding, Share, Modules | 058f12e |
| R1 — Hotspot drag TRULY fixed | DONE | Replaced mouseEventToCoords with cursor % math | fd50292 |
| R2 — Set North view reset FIXED | DONE | PanoViewer always mounted; equirect is CSS overlay | fd50292 |
| S1 — Map data sync | OK | Store-driven lines effect already works; no change needed |
| M1 — Map pin click selects scene | DONE | Already implemented via marker.on('click') in prior sprint |
| M2 — Animated pulse on active pin | DONE | CSS keyframes injected once; class on active divIcon | 71181f4 |
| M3 — Auto-refit on GPS change | DONE | Debounced 300ms effect on geoKey | 71181f4 |
| M4 — Tile layer selector | DONE | OSM / Esri Satellite toggle button | 71181f4 |
| M5 — Style coherence | DONE | Zoom ctrl to bottom-left; white/blue button palette | 71181f4 |
| Section 4 — Set North v2 (2-slider) | DONE | Compass rose + yaw pan + facing-direction slider | fd50292 |
| Section 5 — Default view persistence | DONE | initialView prop in PanoViewer; scene-switch effect | fd50292 |
| Section 6 — Preview renders hotspots | DONE | Pannellum native hotSpots; link nav; scene dots | a598989 |
| Section 7 — Categories screen | DONE | Already in Sprint E (019c437) |

## Test Results (Sprint G)

- **Type errors:** 0
- **Unit tests:** 98 / 98 passed (6 test files)

## All Commits This Session

| Hash | Message |
|------|---------|
| 93e1c65 | fix: restore hotspot dragging with pannellum |
| 872b68f | fix: set north preserves current view + map auto-fit |
| 019c437 | feat: categories screen with full CRUD |
| 26a11e3 | feat: excel import and export of scenes, categories, project |
| 058f12e | feat: all 6 metadata screens |
| fd50292 | fix: hotspot drag (cursor math) + north mode never resets view |
| 71181f4 | feat: map polish — pulse on active pin, auto-refit, satellite tiles, style |
| a598989 | feat: preview window renders hotspots + scene navigation |

## Sprint G — Technical Decisions

### R1 — Hotspot drag in navigate mode
Root cause: `pannellumGetMouseCoordsRef.current?.(e.nativeEvent)` was being called with
an event from the transparent capture overlay div, NOT from Pannellum's canvas. Pannellum's
`mouseEventToCoords` internally checks the event target and returns `[0, 0]` for non-canvas
events.

Fix: replaced with direct math on the capture overlay:
```
const xPct = (e.clientX - rect.left) / rect.width;
const fovH = pannellumGetFov.current();
const ath = pannellumGetYaw.current() + (xPct - 0.5) * fovH;
```

### R2 — Set North resets camera to yaw=0
Root cause: `isFlat = mode === 'hotspot'` caused PanoViewer to be conditionally mounted.
When user was in hotspot mode (PanoViewer unmounted) and pressed N, PanoViewer remounted
fresh at yaw=0 instead of continuing from the existing orientation.

Fix: PanoViewer is now ALWAYS mounted. In hotspot mode, a `pointer-events-none absolute inset-0 z-10`
div overlays the equirectangular image on top. Events pass through the overlay to the container.

### Set North v2 — correct heading formula
Previous implementation saved `pannellumGetYaw()` as heading — which is WRONG because
if North appears at yaw=-90 in the image, heading should be 90 (East-facing camera),
not -90.

Correct formula (now used in SceneViewer): 
`finalHeading = ((northDir - navView.yaw + 360) % 360 + 360) % 360`

Where `northDir` is the compass direction the user declares they're looking at (0=North, 90=East…).

The UI shows a direction slider (0–360°) + a real compass rose that rotates based on `finalHeading`.

### Section 5 — defaultView persistence
- `PanoViewer` gained `initialView?: { yaw, pitch, hfov }` prop, passed at Pannellum init time
- `PanoViewer` gained `setPitch` and `setFov` refs (in addition to existing `setYaw`)
- `ScenesScreen` applies `defaultView` to Pannellum via an effect on `activeSceneId` change
- This covers both: scene switch starts at saved view, AND immediate apply when user edits

### Section 6 — Preview with hotspots
- `openPreview` now accepts a third arg `sceneData = { scenes, activeSceneId }`
- `main.ts` stores it in `pendingPreviewData`, served via `preview:getData` IPC
- `App.tsx` `PreviewMode` fetches data, builds Pannellum `hotSpots` config with:
  - Link hotspots: `clickHandlerFunc` sets `currentSceneId` → reinitializes viewer
  - All hotspots: tooltip text from title/label/subject
  - Scene dot navigation bar at the bottom
  - Scene name overlay at the top

### M3 — Refit map: geoKey trick
To avoid unnecessary refits, the dependency is a string key:
```
const geoKey = scenes.filter(hasGeo).map(s => `${s.id}:${s.geo.lat},${s.geo.lng}`).join('|');
```
Only changes when lat/lng actually change, not on unrelated scene updates.

### M4 — Tile layers
Esri World Imagery used for satellite (public CDN, no API key). The tile layer ref is
stored to allow removal before adding the new one. Overlay layers are brought to front
after the tile switch to keep lines/circles visible.

## Sprint I — Bugs + Deep Links (2026-06-17)

| Section | Subtask | Status | Notes | Commit |
|---------|---------|--------|-------|--------|
| 1 | MapScreen crash on mount | DONE | `bringToFront()` doesn't exist on `L.LayerGroup`; removed both calls — Leaflet panes handle z-order automatically | 43a4cd8 |
| 2 | Remove .js shadow files | DONE | Deleted all src/**/*.js; added gitignore rule; added `check:no-js` script | 33b2a44 |
| 3 | Set as default view | DONE | Bookmark button in toolbar captures yaw/pitch/fov → scene.defaultView; toast overlay; preview window now opens at defaultView | e8a615a |
| 4 | Deep links /scene/slug | DONE | `generateScenePageHtml()` produces depth-2 HTML using `onready` to load specific scene; sitemap lists all /scene/<slug>/ URLs | bf63521 |
| 5.1 | DeepL wiring | SKIPPED | Out of scope for this sprint |  |
| 5.2 | Tile generation (sharp) | SKIPPED | Out of scope for this sprint |  |
| 5.3 | E2E smoke tests | SKIPPED | Out of scope for this sprint |  |

### Sprint I — Technical details

**Section 1 root cause**: `linesLayerRef` and `circlesLayerRef` are `L.LayerGroup` instances. `bringToFront()` is defined only on `L.Path` and `L.FeatureGroup`. Leaflet's internal pane system (`overlayPane`, z-index 400 > `tilePane`, z-index 200) already ensures vector layers stay above tile layers regardless of insertion order.

**Section 2**: ~45 stale `.js` files existed in `src/` as untracked files. Vite's module resolution picks `.js` before `.tsx` when both exist at the same path, causing compiled placeholder screens to shadow real implementations. The `.gitignore` rule `src/**/*.js` + `check:no-js` script prevents recurrence.

**Section 3**: `handleSetDefaultView` in `ScenesScreen` reads `pannellumGetYaw/Pitch/Fov` refs and calls `updateScene({ defaultView: {hlookat, vlookat, fov} })`. Apply-on-scene-switch was already implemented in a prior sprint. `PreviewMode` in `App.tsx` now spreads `{ yaw: dv.hlookat, pitch: dv.vlookat, hfov: dv.fov }` into the Pannellum config.

**Section 4**: Per-scene HTML uses `onready: function(krp){ krp.call("loadscene(scene_NAME,null,MERGE,BLEND(0.5));") }` — this overrides the default `onstart` scene from `tour.xml` without requiring any change to the XML format. No query params needed. Asset paths use `../../` prefix (depth 2 from output root).

### Test results — Sprint I

- **Type errors:** 0
- **Unit tests:** 98 / 98 passed
- **check:no-js:** PASS

## Sprint H — Compile Pipeline (d7be581)

| Subtask | Status | Notes |
|---------|--------|-------|
| compile:run IPC | DONE | copies krpano, images, generates xml+html+sitemap, streams progress |
| tour.xml generation | DONE | scenes, views, hotspots (link/text/external/video), northoffset, styles |
| index.html generation | DONE | OG meta, share bar, copyright, embedpano call |
| sitemap.xml | DONE | generated when seo.imageSitemap is true + publicationUrl set |
| dialog:openFolder IPC | DONE | native folder picker dialog |
| shell:openFolder IPC | DONE | opens output folder in Explorer/Finder |
| CompileScreen.tsx | DONE | folder picker, pre-flight checklist, progress log, result banner |

### Technical decisions
- `generateKrpanoXml`: slugs become `scene_{slug_with_underscores}`, hotspot IDs become `hs_{uuid_no_dashes}`
- `northoffset` on `<sphere>` uses `scene.heading` directly (our `heading` = krpano `northoffset`)
- Form hotspots omitted from XML export (require server-side handling)
- `onCompileProgress` in preload returns an unsub function so CompileScreen can clean up on unmount
- `process.resourcesPath` used for krpano path in production builds

## Suggested Next Sprint

All 11 screens now have functional implementations. Suggested work:
- End-to-end manual test of the full compile → upload → view flow
- Tile generation integration (sharp pipeline, currently returns placeholder)
- Deep-link support: `?scene=slug` query param parsed by the compiled tour's HTML
- DeepL auto-translation wiring in Languages screen
- Playwright E2E tests for the compile flow
