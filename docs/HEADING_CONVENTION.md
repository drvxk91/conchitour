# Heading Convention

## Definition

`Scene.heading` is the **compass bearing** (0–360°, clockwise from true North) of the panorama's **ath=0 direction** (the image center / "forward" direction when the panorama was captured).

- 0° = panorama center points North
- 90° = panorama center points East
- 180° = panorama center points South
- 270° = panorama center points West

## Canonical formula

To convert a compass bearing to a krpano/Pannellum `ath` value:

```
ath = ((bearing - heading + 360) % 360)
if (ath > 180) ath -= 360
```

Result is in `[-180, 180]`. Implemented in `src/lib/geo.ts → bearingToAth(bearing, heading)`.

The same formula exists locally in `electron/main.ts → geoAth(bearing, heading)` because main.ts
runs in a separate Node process and cannot import from `src/`. Both implementations are identical.

## Compass direction of the current view (radar fan)

```
currentBearing = (heading + pannellumYaw + 360) % 360
```

Where `pannellumYaw` is the raw Pannellum yaw (0 at image center, positive = right).

## Set North mode

`northDir` (internal to SceneViewer): compass bearing that the view center currently faces.
`finalHeading = ((northDir - pannellumYaw + 360) % 360 + 360) % 360` — this is what gets saved.

## Sources

| Field | Source | Normalized? |
|-------|--------|-------------|
| `Scene.heading` (from EXIF) | `electron/main.ts → exif.direction = normalizeHeading(Number(dir))` | ✓ |
| `Scene.heading` (from newScene) | `src/lib/scene-factory.ts → normalizeHeading(meta.exif?.direction ?? 0)` | ✓ |
| `Scene.heading` (from Set North) | `ScenesScreen → normalizeHeading(finalHeading)` | ✓ |

## normalizeHeading

All heading values must pass through `normalizeHeading` before storage.

```typescript
// src/lib/heading.ts
export function normalizeHeading(deg: number): number {
  return ((deg % 360) + 360) % 360;
}
```

Raw EXIF values may be `360.0` (out of range) or `-0.5` (negative). Always normalize before storing.
