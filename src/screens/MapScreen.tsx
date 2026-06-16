import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { v4 as uuid } from 'uuid';
import { Zap, Check, MapPin, Undo2, Link2, X, Maximize2 } from 'lucide-react';
import { useProject } from '@/store/project';
import { haversineDistance, bearingBetween, bearingToAth, elevationToAtv } from '@/lib/geo';
import type { GeoCoord, LinkHotspot, Scene, Category } from '@/types';

// Fix Leaflet's default icon path (broken by Vite's asset hashing)
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href,
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
  shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href,
});

const DEFAULT_RADIUS = 150; // metres — default visibility radius per scene

function hasGeo(scene: Scene): boolean {
  return scene.geo.lat !== 0 || scene.geo.lng !== 0;
}

// ── MapView — raw Leaflet map ─────────────────────────────────────────────────

interface MapViewProps {
  scenes: Scene[];
  categories: Category[];
  activeSceneId: string | null;
  showLines: boolean;
  showRadii: boolean;
  onDragEnd: (sceneId: string, lat: number, lng: number) => void;
  onSelect: (sceneId: string) => void;
  onMapClick: (lat: number, lng: number) => void;
  autoFitRef?: React.MutableRefObject<() => void>;
}

function MapView({ scenes, categories, activeSceneId, showLines, showRadii, onDragEnd, onSelect, onMapClick, autoFitRef }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const linesLayerRef = useRef<L.LayerGroup | null>(null);
  const circlesLayerRef = useRef<L.LayerGroup | null>(null);
  const didFitRef = useRef(false);
  const scenesRef = useRef<Scene[]>(scenes);
  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  // Keep callbacks fresh without re-creating the map click listener
  const onMapClickRef = useRef(onMapClick);
  const onSelectRef = useRef(onSelect);
  const onDragEndRef = useRef(onDragEnd);
  const markerClickingRef = useRef(false);

  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onDragEndRef.current = onDragEnd; }, [onDragEnd]);

  function colorFor(scene: Scene) {
    return categories.find((c) => c.id === scene.categoryIds[0])?.color ?? '#6b6b68';
  }

  function makeIcon(color: string, isActive: boolean) {
    return L.divIcon({
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      html: `<div style="
        width:28px;height:28px;border-radius:50%;
        background:${color};
        border:3px solid ${isActive ? 'white' : 'rgba(255,255,255,0.55)'};
        box-shadow:0 2px 6px rgba(0,0,0,0.45)${isActive ? ',0 0 0 2px ' + color : ''};
        cursor:grab;
      "></div>`,
    });
  }

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let map: L.Map;
    try {
      map = L.map(containerRef.current, { zoomControl: true, center: [20, 0], zoom: 2 });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      linesLayerRef.current = L.layerGroup().addTo(map);
      circlesLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;

      // Click on map → place / move active scene
      map.on('click', (e: L.LeafletMouseEvent) => {
        if (markerClickingRef.current) { markerClickingRef.current = false; return; }
        onMapClickRef.current(e.latlng.lat, e.latlng.lng);
      });

      setTimeout(() => { try { map.invalidateSize(); } catch { /* ignore */ } }, 100);

      // Expose auto-fit function for the button in MapScreen
      if (autoFitRef) {
        autoFitRef.current = () => {
          const geo = scenesRef.current.filter(hasGeo);
          try {
            if (geo.length === 0) { map.setView([20, 0], 2); return; }
            if (geo.length === 1) { map.setView([geo[0].geo.lat, geo[0].geo.lng], 16); return; }
            map.fitBounds(L.latLngBounds(geo.map((s): L.LatLngExpression => [s.geo.lat, s.geo.lng])), { padding: [50, 50] });
          } catch { /* ignore */ }
        };
      }
    } catch (err) {
      console.warn('[MapView] Leaflet init error:', err);
      return;
    }
    return () => {
      try { map.remove(); } catch { /* ignore */ }
      mapRef.current = null;
      markersRef.current.clear();
      linesLayerRef.current = null;
      circlesLayerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync markers whenever scenes / active scene / categories change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const geoScenes = scenes.filter(hasGeo);
    const currentIds = new Set(geoScenes.map((s) => s.id));

    for (const [id, marker] of markersRef.current) {
      if (!currentIds.has(id)) { marker.remove(); markersRef.current.delete(id); }
    }

    for (const scene of geoScenes) {
      const isActive = scene.id === activeSceneId;
      const color = colorFor(scene);
      const latlng: L.LatLngExpression = [scene.geo.lat, scene.geo.lng];
      const title = scene.title?.en || scene.slug;

      if (markersRef.current.has(scene.id)) {
        const m = markersRef.current.get(scene.id)!;
        m.setLatLng(latlng);
        m.setIcon(makeIcon(color, isActive));
        if (m.getTooltip()) m.setTooltipContent(title);
      } else {
        try {
          const marker = L.marker(latlng, { icon: makeIcon(color, isActive), draggable: true });
          marker.addTo(map);
          marker.bindTooltip(title, { permanent: false, direction: 'top', offset: [0, -16] });
          marker.on('dragend', () => {
            const { lat, lng } = marker.getLatLng();
            onDragEndRef.current(scene.id, lat, lng);
          });
          // Set flag before map click fires (Leaflet fires layer click before map click)
          marker.on('click', () => {
            markerClickingRef.current = true;
            onSelectRef.current(scene.id);
          });
          markersRef.current.set(scene.id, marker);
        } catch (err) {
          console.warn('[MapView] marker error:', err);
        }
      }
    }

    // Auto-fit on first load with GPS data
    if (!didFitRef.current && geoScenes.length >= 1) {
      didFitRef.current = true;
      try {
        if (geoScenes.length === 1) {
          map.setView([geoScenes[0].geo.lat, geoScenes[0].geo.lng], 16);
        } else {
          map.fitBounds(
            L.latLngBounds(geoScenes.map((s): L.LatLngExpression => [s.geo.lat, s.geo.lng])),
            { padding: [50, 50] }
          );
        }
      } catch { /* ignore fitBounds errors */ }
    }
  }, [scenes, activeSceneId, categories]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync connection lines (drawn from link hotspots between geo-located scenes)
  useEffect(() => {
    const layer = linesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showLines) return;
    for (const scene of scenes) {
      if (!hasGeo(scene)) continue;
      for (const h of scene.hotspots) {
        if (h.type !== 'link') continue;
        const target = scenes.find((s) => s.id === (h as LinkHotspot).targetSceneId);
        if (!target || !hasGeo(target)) continue;
        L.polyline(
          [[scene.geo.lat, scene.geo.lng], [target.geo.lat, target.geo.lng]],
          { color: '#60a5fa', weight: 2, opacity: 0.7, dashArray: '6 4' }
        ).addTo(layer);
      }
    }
  }, [scenes, showLines]);

  // Sync visibility radius circles
  useEffect(() => {
    const layer = circlesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showRadii) return;
    for (const scene of scenes) {
      if (!hasGeo(scene)) continue;
      const radius = scene.visibilityRadius ?? DEFAULT_RADIUS;
      const color = colorFor(scene);
      L.circle([scene.geo.lat, scene.geo.lng], {
        radius,
        color,
        weight: 1.5,
        opacity: 0.5,
        fillColor: color,
        fillOpacity: 0.07,
      }).addTo(layer);
    }
  }, [scenes, showRadii]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      data-testid="leaflet-map"
    />
  );
}

// ── Main MapScreen ────────────────────────────────────────────────────────────

export function MapScreen() {
  const { project, activeSceneId, setActiveScene, updateScene, addHotspot, deleteHotspot, undo } = useProject();
  const [autoResult, setAutoResult] = useState<string | null>(null);
  const [showLines, setShowLines] = useState(true);
  const [showRadii, setShowRadii] = useState(true);
  const [linkMode, setLinkMode] = useState(false);
  const [linkSourceId, setLinkSourceId] = useState<string | null>(null);
  const [bidir, setBidir] = useState(true);
  const autoFitRef = useRef<() => void>(() => {});

  const geoScenes = project.scenes.filter(hasGeo);
  const activeScene = project.scenes.find((s) => s.id === activeSceneId) ?? null;

  const handleDragEnd = useCallback((sceneId: string, lat: number, lng: number) => {
    const scene = project.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    updateScene(sceneId, { geo: { ...scene.geo, lat, lng } });
    setAutoResult(null);
  }, [project.scenes, updateScene]);

  // Click anywhere on the map → place / move the active scene there
  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (!activeSceneId) return;
    const scene = project.scenes.find((s) => s.id === activeSceneId);
    if (!scene) return;
    updateScene(activeSceneId, { geo: { ...scene.geo, lat, lng } });
    setAutoResult(null);
  }, [activeSceneId, project.scenes, updateScene]);

  const handleGeoInput = useCallback((sceneId: string, field: keyof GeoCoord, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    const scene = project.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    updateScene(sceneId, { geo: { ...scene.geo, [field]: num } });
    setAutoResult(null);
  }, [project.scenes, updateScene]);

  const handleHeightInput = useCallback((sceneId: string, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    updateScene(sceneId, { captureHeightMeters: num });
    setAutoResult(null);
  }, [updateScene]);

  const handleRadiusInput = useCallback((sceneId: string, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return;
    updateScene(sceneId, { visibilityRadius: num });
    setAutoResult(null);
  }, [updateScene]);

  const handleAutoCompute = useCallback(() => {
    if (geoScenes.length < 2) {
      setAutoResult('Need at least 2 scenes with GPS coordinates.');
      return;
    }

    let added = 0;
    let skipped = 0;

    for (const src of geoScenes) {
      // Remove existing auto-generated link hotspots (links to other geo scenes)
      const autoIds = src.hotspots
        .filter((h) => h.type === 'link' && geoScenes.some((t) => t.id === (h as LinkHotspot).targetSceneId))
        .map((h) => h.id);
      for (const id of autoIds) deleteHotspot(src.id, id);

      // Per-scene visibility radius (like autogarrows search_radius)
      const radius = src.visibilityRadius ?? DEFAULT_RADIUS;

      for (const tgt of geoScenes) {
        if (src.id === tgt.id) continue;
        const dist = haversineDistance(src.geo, tgt.geo);
        if (dist > radius) { skipped++; continue; }

        const bearing = bearingBetween(src.geo, tgt.geo);
        const ath = bearingToAth(bearing, src.heading);
        const srcH = src.geo.altitude ?? src.captureHeightMeters ?? 1.6;
        const tgtH = tgt.geo.altitude ?? tgt.captureHeightMeters ?? 1.6;
        const atv = elevationToAtv(dist, tgtH - srcH);

        const h: LinkHotspot = { id: uuid(), type: 'link', ath, atv, targetSceneId: tgt.id };
        addHotspot(src.id, h);
        added++;
      }
    }

    if (added === 0 && skipped > 0) {
      setAutoResult(`No links added — all pairs exceed their visibility radius.`);
    } else {
      setAutoResult(`Done — ${added} link hotspot${added !== 1 ? 's' : ''} added.`);
    }
  }, [geoScenes, addHotspot, deleteHotspot]);

  const handleLinkScenes = useCallback((clickedId: string) => {
    if (!linkSourceId) {
      setLinkSourceId(clickedId);
      return;
    }
    if (linkSourceId === clickedId) {
      setLinkSourceId(null);
      return;
    }
    const src = project.scenes.find((s) => s.id === linkSourceId);
    const tgt = project.scenes.find((s) => s.id === clickedId);
    if (!src || !tgt) return;

    function computeLink(from: Scene, to: Scene): LinkHotspot {
      let ath = 0, atv = 0;
      if (hasGeo(from) && hasGeo(to)) {
        const bearing = bearingBetween(from.geo, to.geo);
        ath = bearingToAth(bearing, from.heading);
        const dist = haversineDistance(from.geo, to.geo);
        const fromH = from.geo.altitude ?? from.captureHeightMeters ?? 1.6;
        const toH = to.geo.altitude ?? to.captureHeightMeters ?? 1.6;
        atv = elevationToAtv(dist, toH - fromH);
      }
      return { id: uuid(), type: 'link', ath, atv, targetSceneId: to.id };
    }

    addHotspot(linkSourceId, computeLink(src, tgt));
    if (bidir) addHotspot(clickedId, computeLink(tgt, src));

    const srcName = src.title?.en || src.slug;
    const tgtName = tgt.title?.en || tgt.slug;
    setAutoResult(bidir ? `Linked: ${srcName} ↔ ${tgtName}` : `Linked: ${srcName} → ${tgtName}`);
    setLinkSourceId(null);
    setLinkMode(false);
  }, [linkSourceId, bidir, project.scenes, addHotspot]); // eslint-disable-line react-hooks/exhaustive-deps

  if (project.scenes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-ink-faded text-sm" data-testid="map-screen">
        Import photos first to place them on the map.
      </div>
    );
  }

  return (
    <div className="h-full flex" data-testid="map-screen">
      {/* ── Leaflet map (raw, no react-leaflet JSX) ── */}
      <div className="flex-1 relative overflow-hidden">
        <MapView
          scenes={project.scenes}
          categories={project.categories}
          activeSceneId={activeSceneId}
          showLines={showLines}
          showRadii={showRadii}
          onDragEnd={handleDragEnd}
          onSelect={setActiveScene}
          onMapClick={handleMapClick}
          autoFitRef={autoFitRef}
        />

        {/* Auto-fit button — top-right */}
        <button
          onClick={() => autoFitRef.current()}
          title="Auto-fit map to GPS points"
          className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full backdrop-blur-sm border bg-white/80 text-zinc-700 border-zinc-300 hover:bg-white shadow-sm transition-colors"
        >
          <Maximize2 size={11} />
          Auto-fit
        </button>

        {/* Toggle overlay — top-left */}
        <div className="absolute top-3 left-3 z-[1000] flex gap-1.5">
          <button
            onClick={() => setShowLines((v) => !v)}
            title="Toggle connection lines"
            className={`text-[11px] px-2.5 py-1 rounded-full backdrop-blur-sm border transition-colors ${
              showLines
                ? 'bg-blue-500/80 text-white border-blue-400'
                : 'bg-black/50 text-white/60 border-white/20 hover:bg-black/70'
            }`}
          >
            ↔ Connections
          </button>
          <button
            onClick={() => setShowRadii((v) => !v)}
            title="Toggle visibility radius circles"
            className={`text-[11px] px-2.5 py-1 rounded-full backdrop-blur-sm border transition-colors ${
              showRadii
                ? 'bg-blue-500/80 text-white border-blue-400'
                : 'bg-black/50 text-white/60 border-white/20 hover:bg-black/70'
            }`}
          >
            ○ Radii
          </button>
        </div>

        {/* "Click to place" hint for active scene without GPS */}
        {!linkMode && activeScene && !hasGeo(activeScene) && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
            <div className="bg-black/70 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm flex items-center gap-1.5">
              <MapPin size={12} />
              Click the map to place <strong className="ml-1">{activeScene.title?.en || activeScene.slug}</strong>
            </div>
          </div>
        )}

        {/* Link mode hint */}
        {linkMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
            <div className="bg-blue-600/90 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm flex items-center gap-1.5">
              <Link2 size={12} />
              {linkSourceId
                ? `From "${project.scenes.find((s) => s.id === linkSourceId)?.title?.en || '?'}" — click the target scene in the panel →`
                : 'Click the source scene in the right panel'}
            </div>
          </div>
        )}

        {/* Bottom overlay — undo / auto-compute / link */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2 pointer-events-none">
          {autoResult && (
            <div
              data-testid="auto-result"
              className="pointer-events-auto bg-black/80 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm flex items-center gap-1.5"
            >
              <Check size={12} className="text-green-400 flex-shrink-0" />
              <span>{autoResult}</span>
              <button onClick={() => setAutoResult(null)} className="ml-1 opacity-60 hover:opacity-100"><X size={11} /></button>
            </div>
          )}
          <div className="pointer-events-auto flex items-center gap-2">
            {/* Undo */}
            <button
              onClick={() => { undo(); setAutoResult(null); }}
              title="Undo (Ctrl+Z)"
              className="flex items-center justify-center w-9 h-9 bg-white text-zinc-700 rounded-full shadow-lg hover:bg-zinc-100 transition-colors"
            >
              <Undo2 size={15} />
            </button>

            {/* Auto-compute */}
            <button
              onClick={handleAutoCompute}
              disabled={geoScenes.length < 2}
              className="flex items-center gap-2 bg-white text-zinc-900 text-sm font-medium px-4 py-2 rounded-full shadow-lg
                         hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              data-testid="auto-compute-btn"
            >
              <Zap size={14} />
              Auto-compute
            </button>

            {/* Manual link */}
            <button
              onClick={() => {
                setLinkMode((v) => !v);
                setLinkSourceId(null);
                setAutoResult(null);
              }}
              title="Manually link two scenes"
              className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-full shadow-lg transition-colors ${
                linkMode
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'bg-white text-zinc-900 hover:bg-zinc-100'
              }`}
            >
              <Link2 size={14} />
              Link
            </button>
          </div>

          {/* Bidirectional toggle — shown when link mode is active */}
          {linkMode && (
            <label className="pointer-events-auto flex items-center gap-1.5 text-[11px] text-white bg-black/60 px-3 py-1.5 rounded-full backdrop-blur-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={bidir}
                onChange={(e) => setBidir(e.target.checked)}
                className="accent-blue-400"
              />
              Bidirectional
            </label>
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="w-72 flex flex-col border-l border-line-soft bg-paper-soft overflow-y-auto flex-shrink-0" data-testid="map-panel">
        <div className="px-4 py-3 border-b border-line-soft">
          <h2 className="text-sm font-medium text-ink-strong">Scenes</h2>
          {linkMode ? (
            <p className="text-xs text-blue-500 mt-0.5">
              {linkSourceId ? 'Now click the target scene' : 'Click the source scene'}
            </p>
          ) : (
            <p className="text-xs text-ink-faded mt-0.5">Click map to place · drag pins to move</p>
          )}
        </div>

        <div className="flex-1 divide-y divide-line-soft">
          {project.scenes.map((scene, idx) => {
            const isActive = scene.id === activeSceneId;
            const isLinkSource = scene.id === linkSourceId;
            const hasPin = hasGeo(scene);
            const color = project.categories.find((c) => c.id === scene.categoryIds[0])?.color ?? '#6b6b68';
            const linkCount = scene.hotspots.filter((h) => h.type === 'link').length;

            return (
              <div
                key={scene.id}
                className={`p-3 cursor-pointer transition-colors border-l-2 ${
                  isLinkSource
                    ? 'bg-blue-500/10 border-blue-500'
                    : isActive && !linkMode
                    ? 'bg-paper-tinted border-transparent'
                    : 'border-transparent hover:bg-paper-tinted/50'
                }`}
                onClick={() => {
                  if (linkMode) {
                    handleLinkScenes(scene.id);
                  } else {
                    setActiveScene(scene.id);
                  }
                }}
                data-testid={`map-scene-row-${scene.id}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {idx + 1}
                  </div>
                  <span className="text-xs font-medium text-ink-strong truncate flex-1">
                    {scene.title?.en ?? scene.slug}
                  </span>
                  {!hasPin && <MapPin size={11} className="text-ink-faded flex-shrink-0" />}
                </div>

                {isActive && (
                  <div className="space-y-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
                    {(['lat', 'lng'] as const).map((field) => (
                      <div key={field} className="flex items-center gap-1.5">
                        <label className="text-[10px] text-ink-faded w-8 flex-shrink-0 capitalize">{field}</label>
                        <input
                          type="number"
                          step="0.000001"
                          defaultValue={scene.geo[field] || ''}
                          placeholder="0.000000"
                          className="flex-1 bg-paper-strong border border-line-soft rounded px-2 py-0.5 text-[11px] text-ink-strong focus:outline-none focus:border-accent"
                          onBlur={(e) => handleGeoInput(scene.id, field, e.target.value)}
                          data-testid={`${field}-input-${scene.id}`}
                        />
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5">
                      <label className="text-[10px] text-ink-faded w-8 flex-shrink-0">H</label>
                      <input
                        type="number"
                        step="0.1"
                        defaultValue={scene.captureHeightMeters}
                        className="flex-1 bg-paper-strong border border-line-soft rounded px-2 py-0.5 text-[11px] text-ink-strong focus:outline-none focus:border-accent"
                        onBlur={(e) => handleHeightInput(scene.id, e.target.value)}
                        data-testid={`height-input-${scene.id}`}
                      />
                      <span className="text-[9px] text-ink-faded">m</span>
                    </div>
                    {/* Visibility radius — like autogarrows search_radius, per scene */}
                    <div className="flex items-center gap-1.5">
                      <label className="text-[10px] text-ink-faded w-8 flex-shrink-0">R</label>
                      <input
                        type="number"
                        step="10"
                        min="10"
                        max="5000"
                        defaultValue={scene.visibilityRadius ?? DEFAULT_RADIUS}
                        className="flex-1 bg-paper-strong border border-line-soft rounded px-2 py-0.5 text-[11px] text-ink-strong focus:outline-none focus:border-accent"
                        onBlur={(e) => handleRadiusInput(scene.id, e.target.value)}
                        data-testid={`radius-input-${scene.id}`}
                      />
                      <span className="text-[9px] text-ink-faded">m</span>
                    </div>
                    {linkCount > 0 && (
                      <div className="text-[10px] text-ink-faded">
                        {linkCount} link hotspot{linkCount !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                )}

                {!isActive && (
                  <div className="text-[10px] text-ink-faded font-mono">
                    {hasPin
                      ? `${scene.geo.lat.toFixed(5)}, ${scene.geo.lng.toFixed(5)}`
                      : 'No GPS — select then click map'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
