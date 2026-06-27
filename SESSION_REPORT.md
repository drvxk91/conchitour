> **Note:** This project was renamed from "Conchitect" to "Conchitour" on 2026-06-27. Sprint names below predate the rename and use the old name for historical accuracy. All current code uses "Conchitour".

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

## Sprint J — Full krpano integration (a5d2bce)

| Subtask | Status | Notes |
|---------|--------|-------|
| Settings persist | DONE | conchitect-settings.json in userData |
| krpano:validate IPC | DONE | checks 4 required files |
| compile:run IPC | DONE | copies from installation, tile gen via krpanotools, vtour skin |
| generateKrpanoXml | DONE | vtour skin, sphere/cube, link/text/external/video hotspots |
| .htaccess, _redirects, vercel.json, web.config | DONE | |
| 404.html, per-scene deep-link pages | DONE | |
| CompileScreen | DONE | krpano path, validation, pre-flight, progress log, result |

## Sprint K — Project format + tile cache + bugs + Excel + progress UI (2026-06-17)

| Part | Subtask | Status | Notes | Commit |
|------|---------|--------|-------|--------|
| 6.1 | Preview hotspot CSS | DONE | Selectors changed from `.preview-hs span.pnlm-hotspot-base` (wrong) to `.pnlm-hotspot-base.preview-hs` (compound class on div) | 37ba0f6 |
| 6.2 | Navigate mode link hotspot navigation | DONE | Click now calls `setActiveScene(targetSceneId)`; added `setActiveScene` to SceneViewer destructure | 37ba0f6 |
| 6.3 | Set View (bookmark) | DONE | Already fixed in Sprint I | — |
| 6.4 | Map pin opacity | DONE | Non-active pins dimmed to 60% opacity, thinner border | 37ba0f6 |
| 4 | Compile robustness | DONE | `backgroundThrottling:false`; CompileRunState in main; compile:get-state + compile:cancel IPC; CompileScreen restores on mount; Cancel button; isCompiling badge in Sidebar | f86dc4d |
| 1 | .conchitect project format | DONE | `sourceFile?` in SceneMedia; project:new/open/save/save-as IPC; Electron File menu; isDirty + projectDir in store; TitleBar dirty indicator; App.tsx menu handlers | 7db2912 |
| 2 | Tile cache | DONE | fileHash (MD5), hasValidCache, copyCacheTo, buildCacheFor; compile:run uses .conchitect/cache/tiles/; Force regenerate checkbox | 96ecc1e |
| 5 | Stepped progress UI | DONE | 9 named steps (COMPILE_STEPS), CheckCircle/Loader/Circle per step, raw log in collapsible details | 34a3a13 |
| 3 | Excel multi-sheet | DONE | Added Hotspots, SEO, Branding, Modules sheets to export | 9f6fe85 |

### Sprint K — Test results

- **Type errors:** 0
- **Unit tests:** 98 / 98 passed
- **check:no-js:** (inherited from Sprint I, still valid)

### Sprint K — Technical decisions

**Part 1 (project format)**: `saveProject` IPC signature changed from `(path, data)` to `(data)` — currentProjectDir is now server-side state. The old `loadProject(path)` binding is kept for backward compat but project:open now does the dialog + resolution internally. `withHistory` returns `isDirty: true` — one place to mark mutations instead of touching every action individually.

**Part 2 (tile cache)**: Cache keyed by MD5 of source file. `__forceRegenTiles` passed as a side-channel key on the project object to avoid adding a new IPC argument. Cache stored at `<projectDir>/cache/tiles/<slug>/`.

**Part 4 (compile cancel)**: `compileCancelToken` is a plain object ref that the tile generation loop checks between scenes. Canceling mid-tile-generation waits for the current scene to finish before stopping (krpanotools process is not killed).

**Part 5 (stepped UI)**: `msgToStep()` maps substring matches from progress messages to step IDs. This is fragile if progress messages change but avoids coupling main.ts and renderer with an explicit step enum. Steps show as done when their `ok` message is received; the `completedStepsRef` is not reactive (avoiding re-renders on every log line).

## Sprint L — Live preview server + persistent bugs (2026-06-17)

| Part | Subtask | Status | Notes | Commit |
|------|---------|--------|-------|--------|
| 7 | KRPANO_PIPELINE.md | DONE | Full pipeline reference docs (9 steps, tile cache, IPC surface, output layout) | b2c318d |
| 1 | Compile state persists across navigation | DONE | ROOT CAUSE A: steps not restored from log on remount. ROOT CAUSE B: setRunning(false) no-op on old instance. FIX: replay log through msgToStep + compile:done event | 2444d0a |
| 2 | Localized fields in scene MetaTab | DONE | Language selector (Globe icon) for title/description; saveTitle/saveDesc use dynamic [lang] key; sync effect depends on [scene.id, lang] | e9d2a3b |
| 3 | Feedback button toggle fix | DONE | ROOT CAUSE: enabled={!!m.feedbackMailto} — empty string is falsy so toggle self-reverted. FIX: enabled={m.feedbackMailto !== undefined} | ace6ec9 |
| 4 | Real-time tile progress bar | DONE | krpanotools stdout /(\d+)%/ → compile:tile-progress IPC; CompileScreen shows scene N/M + animated progress bar | a0c8b56 |
| 5 | Live preview server + hot-reload | PENDING | Requires npm install ws @types/ws; WebSocket hot-reload; new UI section |  |
| 6 | Semver project versioning + HistoryScreen | PENDING | project:save-checkpoint, project:restore-version IPC; File menu entry |  |

### Sprint L — Test results

- **Type errors:** 0
- **Unit tests:** 98 / 98 passed
- **check:no-js:** inherited from Sprint I, still valid

### Sprint L — Technical decisions

**Part 1 (compile:done event)**: Both the success and error paths in `compile:run` now call `event.sender.send('compile:done', result)` after setting `compileRunState.running = false`. CompileScreen subscribes in a dedicated `useEffect` (separate from the `compile:progress` subscription) so the running state clears correctly even when the component remounted mid-compile. The `setIsCompiling(false)` Zustand call was already surviving unmount via the old `finally{}` block; Part 1 only fixed the renderer-local `running` state.

**Part 2 (MetaTab language selector)**: Same pattern as `HotspotsTab` — `langs` + `lang` state, `Globe` icon, `<select>`. The sync `useEffect` depends on `[scene.id, lang]` so switching scenes or languages both re-derive the displayed value. Only the selected language's key is written on save; other language keys are preserved via spread.

**Part 4 (tile progress)**: `tileableScenes` is computed before the loop with `scenes.filter(s => s.media?.sourcePath)`. The per-scene index (`tileSceneIdx`) increments only on scenes with a source path. Progress bar clears to `null` when the `tiles` step completes (received via `onCompileProgress` with `status: 'ok'`).

## Sprint M — Compile hang fix + Excel rework + code health check (2026-06-17)

| Part | Status | Notes | Commit |
|------|--------|-------|--------|
| M1 — krpanotools hang fix | DONE | 3-part fix: -xml=false/-html=false, tmp cleanup, 30s hang timeout | 6608112 |
| M2 — Excel export fix + template | DONE | Fixed field names, error handling, added downloadExcelTemplate IPC + button | e9aca07 |
| M3 — Code health audit | DONE | All 6 items verified in code — no regressions found | (no commit needed) |

### Sprint M Part 1 — Technical details

**Which flags fixed it**: `-xml=false -html=false` passed to `makepano` with `-config=<kPath>/templates/multires.config` and `-outputpath=<panosDir>`. The xml suppression eliminates the "WARNING: overwrite xml file" prompt. The `stdio: ['ignore', 'pipe', 'pipe']` ensures stdin is closed so no blocking read is possible.

**Second bug fixed**: The default `vtour-multires.config` puts tiles at `%INPUTPATH%/vtour/panos/<slug>.tiles` (relative to the tmp image), not `outputDir/panos/<slug>.tiles`. The code expected them in `outputDir`. Fix: use `multires.config` with explicit `-outputpath=<panosDir>` so tiles land exactly where the code reads them.

### Sprint M Part 2 — Technical details

**Export bugs fixed**:
- `modules.gyro` → `modules.gyroscope`
- `modules.deeplKey` → `modules.deeplApiKey`
- Missing: `fullscreen`, `feedbackMailto`, `formsEnabled` — now all included
- Branding sheet: added `intro_text_<lang>` columns per language
- `XLSX.writeFile` wrapped in try/catch; returns `{ error }` on failure
- `handleExportExcel` in CategoriesScreen now catches IPC errors + shows failure toast

**Template**: `excel:download-template` IPC generates a 7-sheet blank workbook with one example row per sheet. Language-aware (uses `project.languages.available`, defaults to `['en']`). Saves to user-chosen path with save dialog.

### Sprint M Part 3 — Code health audit

| Item | Status | Code reference |
|------|--------|---------------|
| 3.1 Preview hotspots | ✓ verified | `App.tsx:86` cssClass `preview-hs preview-hs-${h.type}`; `App.tsx:142` CSS `.pnlm-hotspot-base.preview-hs { ... }` |
| 3.2 Parcours-dot navigation | ✓ verified | `ParcoursGraph.tsx:59` `onClick={() => setActiveScene(scene.id)}` |
| 3.3 Localized fields per scene | ✓ verified | `MetaTab.tsx:17` `scene.title[lang]`, `MetaTab.tsx:38` `{ ...scene.title, [lang]: title }` — fixed Sprint L |
| 3.4 Set View icon | ✓ verified | `SceneToolbar.tsx:6` `Bookmark` imported; `SceneToolbar.tsx:161` `<Bookmark size={13} />` |
| 3.5 Map active pin animation | ✓ verified | `MapScreen.tsx:87` class `map-pin-active` on active; `MapScreen.tsx:92` `opacity:${isActive ? '1' : '0.6'}` |
| 3.6 Compile state persists | ✓ verified | `CompileScreen.tsx:74` `compileGetState()` on mount; lines 80-91 step restoration from log; lines 95-103 `compile:done` subscription |

### Sprint M — Test results

- **Type errors:** 0
- **Unit tests:** 98 / 98 passed

## Suggested Next Sprint

- Live preview server with hot-reload (ws package, Sprint L Part 5)
- Semver project versioning with HistoryScreen (Sprint L Part 6)
- DeepL auto-translation wiring in Languages screen
- ImportScreen: copy photos to `sources/` when projectDir is set (uses project:copy-source IPC)
- Playwright E2E tests for the full compile flow

## Sprint N follow-up — tour.xml multires format (2026-06-17)

| Part | Status | Notes | Commit |
|------|--------|-------|--------|
| Part 1 — Tile inventory | DONE | Confirmed actual layout via Node fs.readdir on test7 | (analysis) |
| Part 2 — tour.xml multires fix | DONE | `generateKrpanoXml` now emits correct `<image type="CUBE" multires="true">` block | 8d7f06c |
| Part 3 — thumburl fix | DONE | Changed `thumb.jpg` → `preview.jpg` (only file that exists at tiles root) | 8d7f06c |
| Part 4.1 — plugins copy | ALREADY FIXED | test7/krpano/plugins/ has all 37 files — fix was in c8e56b5 | — |
| Part 4.2 — license copy | ALREADY FIXED | code at main.ts:1372 copies when `settings.includeLicense` is true | — |
| Part 4.3 — audit script | DONE | Now detects old single-cube format + verifies a concrete sample tile | 9909395 |
| Part 5 — verification | DONE | Audit shows 15/15 ✅ on patched test7 output | — |

### Root cause of the showstopper

`generateKrpanoXml` wrote:
```xml
<image><cube url="panos/<slug>.tiles/pano_%s.jpg"/></image>
```
This asks krpano for 6 single files (`pano_l.jpg`, `pano_f.jpg`, …). krpanotools with `multires.config` generates a tiled directory structure instead:
```
panos/<slug>.tiles/<face>/l<N>/<row>/l<N>_<face>_<row>_<col>.jpg
```
None of the single-cube files exist → black panorama + 6 network 404s.

### Tile layout discovered from test7

```
panos/pano_terrasse.tiles/
├── preview.jpg           (only top-level file; NO thumb.jpg)
├── f/, b/, l/, r/, u/, d/  (six faces)
│   ├── l2/1/ → l2_f_1_1.jpg (512×512), l2_f_1_2.jpg (512×512), l2_f_1_3.jpg (256×512)
│   ├── l2/2/ → l2_f_2_1.jpg ... l2_f_2_3.jpg
│   └── l2/3/ → l2_f_3_1.jpg (512×256), ..., l2_f_3_3.jpg (256×256)  ← partial edge tiles
│   └── l1/   → 2×2 tiles, 512px full, 128px edge
```

Key insight: **edge tiles are smaller than tileSize** (256px vs 512px for l2, 128px vs 512px for l1).  
`tiledimagewidth` must be computed as `(numCols-1)*tileSize + lastColWidth`, not `numCols*tileSize`.

Correct dimensions: l2 face = **1280×1280**, l1 face = **640×640**.

### Fix: `detectTileInfo()` + updated `generateKrpanoXml`

`detectTileInfo(panosDir, slug)` walks `<slug>.tiles/f/` after krpanotools runs:
1. Detects `tileSize` by reading JPEG SOF header of the top-left tile (always full-size)
2. For each level: reads the last tile in row 1 (for width) and first tile of last row (for height)
3. Computes exact face dimensions from partial edge tiles
4. Returns `TileInfo { tileSize, levels: [{num, tiledimagewidth, tiledimageheight, url}] }`

`generateKrpanoXml` now emits:
```xml
<image type="CUBE" multires="true" tilesize="512" baseindex="1">
  <level tiledimagewidth="1280" tiledimageheight="1280">
    <cube url="panos/pano_terrasse.tiles/%s/l2/%v/l2_%s_%v_%h.jpg"/>
  </level>
  <level tiledimagewidth="640" tiledimageheight="640">
    <cube url="panos/pano_terrasse.tiles/%s/l1/%v/l1_%s_%v_%h.jpg"/>
  </level>
</image>
```

### Sprint N follow-up — Test results

- **Type errors:** 0
- **Unit tests:** 98 / 98 passed
- **Audit (test7 with patched tour.xml):** 15/15 ✅
