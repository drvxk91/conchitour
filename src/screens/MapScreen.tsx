import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { v4 as uuid } from 'uuid';
import { Zap, Check, MapPin } from 'lucide-react';
import { useProject } from '@/store/project';
import { haversineDistance, bearingBetween, bearingToAth, elevationToAtv } from '@/lib/geo';
import type { GeoCoord, LinkHotspot } from '@/types';

// Fix Leaflet's default icon path (broken by Vite's asset hashing)
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href,
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
  shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href,
});

const DEFAULT_CENTER: L.LatLngExpression = [48.8566, 2.3522];
const MAX_AUTO_LINK_DISTANCE = 150;

// ── MapView — raw Leaflet map in a useEffect ─────────────────────────────────

interface MapViewProps {
  scenes: ReturnType<typeof useProject>['project']['scenes'];
  categories: ReturnType<typeof useProject>['project']['categories'];
  activeSceneId: string | null;
  onDragEnd: (sceneId: string, lat: number, lng: number) => void;
  onSelect: (sceneId: string) => void;
}

function MapView({ scenes, categories, activeSceneId, onDragEnd, onSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  function colorFor(scene: typeof scenes[0]) {
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
      map = L.map(containerRef.current, { zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
    } catch (err) {
      console.warn('[MapView] Leaflet init error:', err);
      return;
    }
    return () => {
      try { map.remove(); } catch { /* ignore */ }
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync markers whenever scenes or activeSceneId change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const geoScenes = scenes.filter((s) => s.geo.lat !== 0 || s.geo.lng !== 0);
    const currentIds = new Set(geoScenes.map((s) => s.id));

    // Remove stale markers
    for (const [id, marker] of markersRef.current) {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Add or update markers
    for (const scene of geoScenes) {
      const isActive = scene.id === activeSceneId;
      const color = colorFor(scene);
      const latlng: L.LatLngExpression = [scene.geo.lat, scene.geo.lng];

      if (markersRef.current.has(scene.id)) {
        const m = markersRef.current.get(scene.id)!;
        m.setLatLng(latlng);
        m.setIcon(makeIcon(color, isActive));
      } else {
        let marker: L.Marker;
        try {
          marker = L.marker(latlng, {
            icon: makeIcon(color, isActive),
            draggable: true,
          });
          marker.addTo(map);
          marker.on('dragend', () => {
            const { lat, lng } = marker.getLatLng();
            onDragEnd(scene.id, lat, lng);
          });
          marker.on('click', () => onSelect(scene.id));
          markersRef.current.set(scene.id, marker);
        } catch (err) {
          console.warn('[MapView] marker error:', err);
        }
      }
    }

    // Auto-fit bounds on first load
    if (geoScenes.length >= 1 && markersRef.current.size > 0) {
      try {
        if (geoScenes.length === 1) {
          if (!map.getBounds().contains([geoScenes[0].geo.lat, geoScenes[0].geo.lng])) {
            map.setView([geoScenes[0].geo.lat, geoScenes[0].geo.lng], 17);
          }
        } else {
          const coords = geoScenes.map((s): L.LatLngExpression => [s.geo.lat, s.geo.lng]);
          map.fitBounds(L.latLngBounds(coords), { padding: [40, 40], maxZoom: 18 });
        }
      } catch { /* ignore fitBounds errors */ }
    }
  }, [scenes, activeSceneId, categories]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const { project, activeSceneId, setActiveScene, updateScene, addHotspot, deleteHotspot } = useProject();
  const [autoResult, setAutoResult] = useState<string | null>(null);

  const geoScenes = project.scenes.filter((s) => s.geo.lat !== 0 || s.geo.lng !== 0);

  const handleDragEnd = useCallback((sceneId: string, lat: number, lng: number) => {
    const scene = project.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    updateScene(sceneId, { geo: { ...scene.geo, lat, lng } });
    setAutoResult(null);
  }, [project.scenes, updateScene]);

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

  const handleAutoCompute = useCallback(() => {
    if (geoScenes.length < 2) {
      setAutoResult('Need at least 2 scenes with GPS coordinates.');
      return;
    }

    let added = 0;
    let skipped = 0;

    for (const src of geoScenes) {
      // Delete all existing auto-generated link hotspots for this source scene
      const autoIds = src.hotspots
        .filter((h) => h.type === 'link' && geoScenes.some((t) => t.id === (h as LinkHotspot).targetSceneId))
        .map((h) => h.id);
      for (const id of autoIds) deleteHotspot(src.id, id);

      // Add fresh link hotspots for all nearby targets
      for (const tgt of geoScenes) {
        if (src.id === tgt.id) continue;
        const dist = haversineDistance(src.geo, tgt.geo);
        if (dist > MAX_AUTO_LINK_DISTANCE) { skipped++; continue; }

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
      setAutoResult(`No links added — all pairs are more than ${MAX_AUTO_LINK_DISTANCE}m apart.`);
    } else {
      setAutoResult(`Done — added ${added} link hotspot${added !== 1 ? 's' : ''}.`);
    }
  }, [geoScenes, addHotspot, deleteHotspot]);

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
          onDragEnd={handleDragEnd}
          onSelect={setActiveScene}
        />

        {/* Auto-compute overlay */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2 pointer-events-none">
          {autoResult && (
            <div
              data-testid="auto-result"
              className="pointer-events-auto bg-black/80 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm flex items-center gap-1.5"
            >
              <Check size={12} className="text-green-400 flex-shrink-0" />
              <span>{autoResult}</span>
            </div>
          )}
          <button
            onClick={handleAutoCompute}
            disabled={geoScenes.length < 2}
            className="pointer-events-auto flex items-center gap-2 bg-white text-zinc-900 text-sm font-medium px-4 py-2 rounded-full shadow-lg
                       hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            data-testid="auto-compute-btn"
          >
            <Zap size={14} />
            Auto-compute link hotspots
          </button>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="w-72 flex flex-col border-l border-line-soft bg-paper-soft overflow-y-auto flex-shrink-0" data-testid="map-panel">
        <div className="px-4 py-3 border-b border-line-soft">
          <h2 className="text-sm font-medium text-ink-strong">Scenes</h2>
          <p className="text-xs text-ink-faded mt-0.5">Drag map pins or type coordinates</p>
        </div>

        <div className="flex-1 divide-y divide-line-soft">
          {project.scenes.map((scene, idx) => {
            const isActive = scene.id === activeSceneId;
            const hasPin = scene.geo.lat !== 0 || scene.geo.lng !== 0;
            const color = project.categories.find((c) => c.id === scene.categoryIds[0])?.color ?? '#6b6b68';

            return (
              <div
                key={scene.id}
                className={`p-3 cursor-pointer transition-colors ${isActive ? 'bg-paper-tinted' : 'hover:bg-paper-tinted/50'}`}
                onClick={() => setActiveScene(scene.id)}
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
                    {scene.title.en ?? scene.slug}
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
                    {scene.hotspots.filter((h) => h.type === 'link').length > 0 && (
                      <div className="text-[10px] text-ink-faded">
                        {scene.hotspots.filter((h) => h.type === 'link').length} link hotspot
                        {scene.hotspots.filter((h) => h.type === 'link').length !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                )}

                {!isActive && (
                  <div className="text-[10px] text-ink-faded font-mono">
                    {hasPin
                      ? `${scene.geo.lat.toFixed(5)}, ${scene.geo.lng.toFixed(5)}`
                      : 'No GPS — click to set'}
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
