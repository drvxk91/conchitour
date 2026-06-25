# Conchitect — krpano Compile Pipeline

## Overview

The compile pipeline runs entirely in the Electron **main process** (`electron/main.ts`, `compile:run` IPC handler). It generates a self-contained static folder that can be uploaded to any web host without a server.

## Prerequisites

The user provides their own licensed copy of krpano 1.23+. Conchitect needs:

| File | Role |
|------|------|
| `krpanotools.exe` | Equirectangular → cube tile conversion |
| `krpano.js` / `krpano.swf` | Viewer runtime |
| `skin/vtourskin.xml` + `skin/` | Default vtour skin assets |
| `krpanolicense.xml` *(optional)* | Removes the "Not licensed" watermark |

The krpano installation path is stored in `conchitect-settings.json` (Electron `userData`). The `krpano:validate` IPC checks for the four required files.

## Pipeline steps

The `compile:run` IPC streams progress events (`compile:progress`) to the renderer after each step. Steps map to the named stages in `CompileScreen.tsx → COMPILE_STEPS`.

```
1. init        Prepare output folder (mkdir -p, clean previous run)
2. runtime     Copy krpano viewer JS + optional license file
3. skin        Copy vtour skin folder (skin/)
4. media       Copy equirectangular scene images → output/images/
5. tiles       Generate cube tiles via krpanotools makepano (per-scene)
6. xml         Generate tour.xml (scenes, hotspots, northoffset, skin include)
7. html        Generate index.html + 404.html + per-scene deep-link pages (/scene/<slug>/)
8. seo         Generate sitemap.xml, robots.txt, .htaccess, _redirects, vercel.json
9. done        Count files + compute size, emit final result
```

## Tile generation (`makepano`)

When `settings.useKrpanoTiles = true`, Conchitect calls:

```
krpanotools.exe makepano <scene.jpg>
```

run from the output directory so krpano writes `panos/<name>.tiles/` there.

### Cache

Tiles are expensive (~1–3 min per scene). Conchitect caches them under the project folder:

```
<name>.conchitect/
  cache/
    tiles/
      <scene-slug>/
        cache.json   { srcHash: "<MD5 of source image>" }
        *.tiles/     (full krpano output, copied to output/panos/ on cache hit)
```

On each compile:
1. Compute MD5 of the source image (`fileHash`).
2. If `cache/<slug>/cache.json` contains the same hash → copy from cache (skip krpanotools).
3. Otherwise → run krpanotools, copy output to `output/panos/`, store in cache.
4. `__forceRegenTiles` side-channel flag (set by "Force regenerate tiles" checkbox) bypasses cache.

## `tour.xml` structure

```xml
<krpano>
  <include url="skin/vtourskin.xml"/>
  <scene name="scene_<slug>" title="<title.en>" thumburl="images/<slug>.jpg" onstart="">
    <view hlookat="<defaultView.hlookat>" vlookat="<defaultView.vlookat>"
          fovtype="HFOV" fov="<defaultView.fov>" fovmin="30" fovmax="150"/>
    <image>
      <!-- if tiled: -->
      <cube url="panos/<slug>.tiles/pano_%s.jpg"/>
      <!-- if not tiled: -->
      <sphere url="images/<slug>.jpg" northoffset="<heading>"/>
    </image>
    <hotspot name="hs_<uuid>" .../>
  </scene>
</krpano>
```

### Hotspot types in XML

| Conchitect type | krpano representation |
|---|---|
| `link` | `<hotspot>` with `onclick="loadscene(scene_<targetSlug>,...)"` |
| `text` | `<hotspot>` with tooltip skin and `title`/`body` attributes |
| `external` | `<hotspot>` with `onclick="js(window.open('<url>'))"` |
| `video` | `<hotspot>` with `onclick="js(window.open('<url>'))"` |
| `form` | **Not exported** — requires server-side handling |

### `northoffset`

The `northoffset` attribute on `<sphere>` maps directly to `scene.heading` (degrees, 0–360). It tells krpano how many degrees the image's zero-yaw point is offset from true North. Set via the **Set North** toolbar tool or the Heading field in the MetaTab.

## Scene heading — canonical definition

**`scene.heading`** = the compass bearing (0–360, clockwise from north) that the **camera was facing at capture time**, i.e. the real-world direction that corresponds to `ath = 0` (the panorama's centre column).

This single definition drives three systems that must stay consistent:

| System | Formula | Example: heading=90 (camera faces east) |
|--------|---------|------------------------------------------|
| `tour.xml` `<sphere northoffset>` | `northoffset = heading` | 90 |
| Hotspot ath (auto-computed from GPS) | `ath = (bearing − heading + 360) % 360`, clamped to [−180, 180] | target due north (bearing=0) → ath = −90 (left of centre) |
| Map radar rotation | `rotate((heading + krpano.view.hlookat) % 360)` | yaw=0 (viewer at centre = east) → rotate(90°) fan points east ✓ |

### Diagnosing "north appears as south" on one scene

A 180° heading error means the stored heading differs from the true capture direction by 180°. Common causes:

1. **Camera records "from" direction instead of "to"** — some panorama heads record the direction the back of the camera faces. Fix: add 180° to the value, or use the **Set North** toolbar button.
2. **User set heading manually with the wrong end of the scene** — Fix: click **N** in the toolbar and drag until the N badge sits over the actual north direction.

After correcting heading, re-run the **Map → Auto-compute** to regenerate hotspot ath/atv values, then recompile.

## Output folder layout

```
output/
  index.html              Main entry point
  404.html                SPA fallback (copy of index.html)
  tour.xml                krpano tour definition
  krpano.js               Viewer runtime
  skin/                   vtour skin assets
  images/                 Equirectangular images (all scenes)
  panos/                  Cube tile folders (when useKrpanoTiles = true)
    <scene-slug>.tiles/
  scene/
    <slug>/
      index.html          Deep-link page (loads specific scene via onready)
  sitemap.xml             Image sitemap (when seo.imageSitemap = true)
  robots.txt
  .htaccess               Apache rewrite rules (SPA routing)
  _redirects              Netlify rewrite rules
  vercel.json             Vercel rewrite rules
  web.config              IIS rewrite rules
```

## IPC surface

| Channel | Direction | Description |
|---|---|---|
| `compile:run` | renderer → main | Start compile; returns `CompileResult` |
| `compile:progress` | main → renderer | Per-step log entry `{ msg, status }` |
| `compile:tile-progress` | main → renderer | Per-tile % progress `{ sceneSlug, sceneIndex, totalScenes, percent }` |
| `compile:done` | main → renderer | Final result broadcast (also returned by `compile:run`) |
| `compile:get-state` | renderer → main | Snapshot of current `CompileRunState` (for navigation recovery) |
| `compile:cancel` | renderer → main | Sets cancel token; compile stops between steps |

## Cancellation

`compileCancelToken` is a plain object `{ canceled: boolean }`. The compile loop calls `checkCancel()` between major steps (not mid-tile). Canceling waits for the current `krpanotools` process to finish before stopping — the process is not killed.

## State persistence across navigation

`CompileRunState` is stored in the main process and survives renderer navigation. When `CompileScreen` mounts, it calls `compile:get-state` to restore `log`, `running`, and `result`. It replays the log through `msgToStep` to restore the step progress indicators. The `compile:done` event clears the running state on any CompileScreen instance, including ones that remounted mid-compile.
