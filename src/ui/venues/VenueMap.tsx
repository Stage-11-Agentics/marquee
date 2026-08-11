import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { walkingMinutes } from "../../lib/venue-geometry";
import type { VenueBuildingInput } from "../../lib/venues";

const TILE_SIZE = 256;
const ZOOM = 16;
const MAP_HEIGHT = 360;
const PLANE_WIDTH = 1120;

interface ProjectedPoint {
  building: VenueBuildingInput;
  x: number;
  y: number;
}

function project(lat: number, lng: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** ZOOM;
  const sine = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale,
  };
}

function tileUrl(x: number, y: number): string {
  return `https://tile.openstreetmap.org/${ZOOM}/${x}/${y}.png`;
}

export function VenueMap({ buildings }: { buildings: readonly VenueBuildingInput[] }): JSX.Element {
  const [tilesFailed, setTilesFailed] = useState(false);
  const pinned = buildings.filter((building) => building.lat !== null && building.lng !== null);
  if (pinned.length === 0) {
    return <div class="venue-map-shell" style={{ height: `${MAP_HEIGHT}px` }}><div class="venue-map-empty">No buildings are pinned yet. Add a verified coordinate to see the conference map.</div><span class="venue-map-attribution">© OpenStreetMap contributors</span></div>;
  }

  const rawPoints = pinned.map((building) => ({ building, ...project(building.lat!, building.lng!) }));
  const centerX = (Math.min(...rawPoints.map((point) => point.x)) + Math.max(...rawPoints.map((point) => point.x))) / 2;
  const centerY = (Math.min(...rawPoints.map((point) => point.y)) + Math.max(...rawPoints.map((point) => point.y))) / 2;
  const originX = centerX - PLANE_WIDTH / 2;
  const originY = centerY - MAP_HEIGHT / 2;
  const points: ProjectedPoint[] = rawPoints.map((point) => ({ ...point, x: point.x - originX, y: point.y - originY }));
  const tileStartX = Math.floor(originX / TILE_SIZE);
  const tileEndX = Math.floor((originX + PLANE_WIDTH) / TILE_SIZE);
  const tileStartY = Math.floor(originY / TILE_SIZE);
  const tileEndY = Math.floor((originY + MAP_HEIGHT) / TILE_SIZE);
  const tiles: JSX.Element[] = [];
  for (let x = tileStartX; x <= tileEndX; x += 1) {
    for (let y = tileStartY; y <= tileEndY; y += 1) {
      tiles.push(<img class="venue-map-tile" key={`${x}-${y}`} alt="" src={tileUrl(x, y)} style={{ left: `${x * TILE_SIZE - originX}px`, top: `${y * TILE_SIZE - originY}px` }} onError={() => setTilesFailed(true)} />);
    }
  }
  const lines: JSX.Element[] = [];
  for (let index = 0; index < points.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < points.length; nextIndex += 1) {
      const from = points[index]!;
      const to = points[nextIndex]!;
      const minutes = walkingMinutes(from.building, to.building);
      if (minutes === null) continue;
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      lines.push(<g key={`${from.building.id}-${to.building.id}`}><line class="venue-map-walk-line" x1={from.x} y1={from.y} x2={to.x} y2={to.y} /><rect class="venue-map-walk-label-bg" x={midX - 22} y={midY - 10} width="44" height="20" rx="2" /><text class="venue-map-walk-label" x={midX} y={midY + 4} text-anchor="middle">{minutes} min</text></g>);
    }
  }

  return <div class={`venue-map-shell ${tilesFailed ? "tiles-failed" : ""}`} style={{ height: `${MAP_HEIGHT}px` }} aria-label="Conference site map">
    <div class="venue-map-plane" style={{ width: `${PLANE_WIDTH}px`, height: `${MAP_HEIGHT}px` }}>
      {tiles}
      <svg class="venue-map-overlay" width={PLANE_WIDTH} height={MAP_HEIGHT} aria-hidden="true">{lines}</svg>
      <div class="venue-map-pins">{points.map((point) => <span class="venue-map-pin-wrap" key={point.building.id} style={{ left: `${point.x}px`, top: `${point.y}px` }}><i class="venue-map-pin" /><span class="venue-map-pin-label">{point.building.name}</span></span>)}</div>
    </div>
    <span class="venue-map-attribution">© OpenStreetMap contributors</span>
    {tilesFailed && <span class="venue-map-fallback" role="status">Map tiles unavailable · pins and walking times remain available</span>}
  </div>;
}
