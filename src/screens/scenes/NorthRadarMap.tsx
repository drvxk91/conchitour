import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Scene } from '@/types';

interface Props {
  scene: Scene;
  /** Live Pannellum yaw (same value reported by northDraftHeading in SceneToolbar) */
  yaw: number;
}

function radarHtml(color: string, az: number): string {
  return (
    '<div style="position:relative;width:48px;height:48px;display:flex;align-items:center;justify-content:center">' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="-24 -24 48 48"' +
    ' style="position:absolute;inset:0;overflow:visible;transform:rotate(' + az + 'deg);transform-origin:50% 50%;transition:transform .08s linear">' +
    '<path d="M0,0 L-11,-22 A26,26,0,0,1,11,-22 Z"' +
    ' fill="rgba(255,255,255,0.35)" stroke="rgba(255,255,255,0.8)" stroke-width="1.5" stroke-linejoin="round"/>' +
    '</svg>' +
    '<div style="width:20px;height:20px;border-radius:50%;background:' + color + ';border:2.5px solid #fff;' +
    'box-shadow:0 0 0 1px rgba(0,0,0,.25),0 2px 8px rgba(0,0,0,.4);z-index:1;position:relative"></div>' +
    '</div>'
  );
}

export function NorthRadarMap({ scene, yaw }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const yawRef = useRef(yaw);

  useEffect(() => {
    yawRef.current = yaw;
    const m = markerRef.current;
    if (!m || !m._icon) return;
    const az = ((scene.heading + yaw) % 360 + 360) % 360;
    const svgEl = m._icon.querySelector('svg');
    if (svgEl) (svgEl as HTMLElement).style.transform = `rotate(${az}deg)`;
  }, [yaw, scene.heading]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const lat = scene.geo.lat;
    const lng = scene.geo.lng;
    const map = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    map.setView([lat, lng], 17);
    mapRef.current = map;

    const az = ((scene.heading + yawRef.current) % 360 + 360) % 360;
    const icon = L.divIcon({ html: radarHtml('#3b82f6', az), className: '', iconSize: [48, 48], iconAnchor: [24, 24] });
    const marker = L.marker([lat, lng], { icon, interactive: false }).addTo(map);
    markerRef.current = marker;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [scene.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="w-72 flex-shrink-0 flex flex-col border-l border-line bg-paper">
      <div className="px-3 py-2 border-b border-line flex items-center gap-2 flex-shrink-0">
        <span className="text-xs font-semibold text-ink-soft uppercase tracking-wide">North compass</span>
      </div>
      <div className="text-[10px] text-ink-faded px-3 py-2 flex-shrink-0">
        Drag the panorama to align. The radar fan shows where the camera is pointing relative to true North.
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" />
      <div className="px-3 py-2 border-t border-line flex-shrink-0 text-xs text-ink-soft">
        Heading: <span className="font-mono font-semibold text-ink">{((((scene.heading + yaw) % 360) + 360) % 360).toFixed(1)}°</span>
      </div>
    </div>
  );
}
