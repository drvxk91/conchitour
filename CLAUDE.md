# CLAUDE.md — Conchitect-app

Read this file before any modification. It is the project's source of truth.

## What this project is

Conchitect is a **desktop application** (Electron + React + TypeScript) for **professional 360° virtual tour authoring**, sold as a one-shot license (no SaaS, no subscription). The user drags photos in, edits scenes, places hotspots, then clicks **Compile** — and gets a **static folder** to upload anywhere (OVH, Netlify, GitHub Pages, S3).

Output viewer: **krpano 1.23+** (the user provides their own license). Quality target: **dubai360.com**.

Tagline: *Architect your virtual tours.*

## Tech stack (do not change without good reason)

- **Electron** main process for filesystem, dialogs, native APIs
- **Vite + React 18 + TypeScript** for the renderer
- **Tailwind CSS** for styling, **lucide-react** for icons
- **Zustand** for state (`src/store/project.ts`)
- **Leaflet + react-leaflet** for the map (OpenStreetMap, no API key)
- **sharp** for tile generation
- **exifr** for EXIF parsing
- **xlsx** (SheetJS) for Excel import/export
- **krpano** as the runtime viewer in the **exported** site

## Folder structure

```
Conchitect-app/
├── electron/           main + preload (Node)
├── src/
│   ├── components/     reusable UI components
│   │   └── shell/      app shell: titlebar, sidebar, router
│   ├── screens/        one file per app screen (11 screens)
│   ├── store/          Zustand stores
│   ├── lib/            pure logic (slug, factory, exif, ...)
│   ├── styles/         global.css
│   └── types/          domain types (Project, Scene, Hotspot, ...)
├── assets/
│   └── krpano/         user drops their licensed krpano files here (gitignored)
├── public/             static assets shipped with the app
└── ...config files
```

## The domain model — `src/types/index.ts`

Read it before touching anything. Every field has a reason. Key invariants:

- A `Scene.slug` is **url-safe** (`/^[a-z0-9][a-z0-9_-]*$/`), **unique within a project**, between 2 and 50 chars.
- A `Category.slug` follows the same rules.
- Localized fields are `Record<string, string>`. The key is a language code (`en`, `fr`, `es`, etc).
- `Hotspot.ath` and `atv` are in degrees, krpano convention. `ath` in `[-180, 180]`, `atv` in `[-90, 90]`.
- `Project.schemaVersion` is for future migrations. Bump it carefully.

## The 11 screens

| # | Screen | File | What it does |
|---|---|---|---|
| 1 | Import | `ImportScreen.tsx` | Drag-and-drop photos, EXIF GPS read |
| 2 | Scenes | `ScenesScreen.tsx` | The core editor: viewer + hotspots + inspector |
| 3 | Map | `MapScreen.tsx` | Leaflet pins to set GPS, auto-recompute hotspots |
| 4 | Categories | `CategoriesScreen.tsx` | Create, edit, delete categories |
| 5 | Project | `ProjectScreen.tsx` | Project metadata + copyright |
| 6 | SEO | `SeoScreen.tsx` | Meta tags + per-scene alt text + image sitemap |
| 7 | Languages | `LanguagesScreen.tsx` | Add languages + DeepL auto-translation |
| 8 | Branding | `BrandingScreen.tsx` | Logo, loader, opening scene, colors |
| 9 | Share | `ShareScreen.tsx` | Social buttons + live view screenshot |
| 10 | Modules | `ModulesScreen.tsx` | VR, gyroscope, feedback, DeepL key |
| 11 | Compile | `CompileScreen.tsx` | Static site generator |

**Screen 2 (Scenes) is where users spend 80% of their time.** It deserves the most polish. See `conchitect-scene-editor-v2.html` mockup for the target layout.

## Implementation roadmap (suggested sprint order)

1. **Import + EXIF + tile generation** (sharp pipeline)
2. **Scenes editor** (krpano viewer embed + hotspot CRUD + inspector tabs)
3. **Map** (Leaflet + GPS triangulation for auto-hotspots)
4. **Categories + Excel import/export** (xlsx)
5. **SEO + Branding + Share + Modules**
6. **Compile pipeline** (output folder generation)

## Critical feature — Setting the North

Every `Scene.heading` (0–360°) records where the camera was pointing relative to true North at capture time. **This is the axis pin for GPS-based auto-hotspot generation** on the Map screen: without a correct heading, the computed ath/atv for neighboring scenes will be wrong by the rotation delta.

### How to set it
1. Click the **Compass / N button** in the SceneToolbar (keyboard `N`).
2. Drag the viewer **horizontally** — N/E/S/W markers rotate with the image.
3. Position N (red badge) over the feature that is actually pointing North.
4. Click **Confirm North**. The heading is saved to `scene.heading`.

### Auto-detection
`electron/main.ts` reads `GPSImgDirection`, `Heading` (Insta360 XMP), and `Yaw` from EXIF on import. If found, `newScene()` in `src/lib/scene-factory.ts` seeds `heading` automatically — no manual step needed for well-tagged cameras.

### Helper
`src/lib/heading.ts` → `normalizeHeading(deg)` → normalizes any degree value to `[0, 360)`.

## Commands

```
npm install         # install deps
npm run dev         # vite + electron in dev
npm run build       # production build + electron-builder
npm run typecheck   # type-check without emit
npm run test        # vitest unit tests
npm run test:e2e    # playwright e2e tests (builds first)
```

## Non-negotiable rules

1. **English everywhere in the code** (var names, comments, UI labels). Localized content lives in `Record<string, string>` fields.
2. **Never commit the krpano license** files (`assets/krpano/krpanolicense.xml` is gitignored).
3. **Single-user app** — no auth, no multi-collaboration in v1.
4. **Static output only** — the compiled tour never depends on a server.
5. **Slug validation** must always go through `src/lib/slug.ts` (`isValidSlug`, `toSlug`, `uniqueSlug`).

## Backlog (post-MVP)

- SaaS hosting option (drop-in compile-and-publish)
- Multi-user collaboration via cloud sync
- Pannellum as alternative viewer
- Built-in DeepL with shared API key
- Mobile app for capture
