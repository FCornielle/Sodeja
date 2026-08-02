import { useEffect, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { API_BASE_URL } from "../lib/apiClient";

const SOURCE_ID = "sodeja-base-tiles";
const TILE_URL_TEMPLATE = `${API_BASE_URL}/providers/tiles/{z}/{x}/{y}`;

/**
 * B-4's OSM->PMTiles generation pipeline hasn't run yet (out of scope for
 * B-7 — see apps/api/src/providers/providers.controller.ts and
 * packages/providers/src/adapters/localDirectoryTileProvider.ts), so
 * `GET /providers/tiles/:z/:x/:y` currently 503s with `NOT_CONFIGURED` for
 * EVERY request. Rather than let MapLibre spam per-tile 'error' events (one
 * per visible tile, on every pan/zoom, hard to turn into one clean UI
 * state), this hook does a single pre-flight fetch against one arbitrary
 * tile coordinate to decide up front whether a base layer exists at all.
 *
 * The layer style below (Protomaps' standard basemap schema — water,
 * landuse, roads, buildings source-layers — matching SODEJA_ARCHITECTURE.
 * md's "self-hosted Protomaps/PMTiles built from OSM") is a best-effort,
 * UNVERIFIED placeholder: no real tiles have ever been generated, so the
 * exact source-layer names cannot be confirmed against real output. It only
 * matters once B-4 ships; today this hook always resolves to "error" in any
 * environment without a manually populated TILES_LOCAL_DIR, and that is the
 * path this app actually exercises and tests.
 */
export type BaseTileStatus = "checking" | "ok" | "error";

function addProtomapsStyleLayers(map: MapLibreMap): void {
  map.addSource(SOURCE_ID, { type: "vector", tiles: [TILE_URL_TEMPLATE], minzoom: 0, maxzoom: 15 });
  map.addLayer({
    id: `${SOURCE_ID}-water`,
    type: "fill",
    source: SOURCE_ID,
    "source-layer": "water",
    paint: { "fill-color": "#bfe0f0" },
  });
  map.addLayer({
    id: `${SOURCE_ID}-landuse`,
    type: "fill",
    source: SOURCE_ID,
    "source-layer": "landuse",
    paint: { "fill-color": "#eef0e8" },
  });
  map.addLayer({
    id: `${SOURCE_ID}-roads`,
    type: "line",
    source: SOURCE_ID,
    "source-layer": "roads",
    paint: { "line-color": "#cbcbcb", "line-width": 1 },
  });
  map.addLayer({
    id: `${SOURCE_ID}-buildings`,
    type: "fill",
    source: SOURCE_ID,
    "source-layer": "buildings",
    paint: { "fill-color": "#e2ddd3" },
  });
}

export function useBaseTileLayer(map: MapLibreMap | null): {
  status: BaseTileStatus;
  retry: () => void;
} {
  const [status, setStatus] = useState<BaseTileStatus>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    setStatus("checking");

    fetch(`${API_BASE_URL}/providers/tiles/0/0/0`)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          if (!map.getSource(SOURCE_ID)) addProtomapsStyleLayers(map);
          setStatus("ok");
        } else {
          setStatus("error");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [map, attempt]);

  return { status, retry: () => setAttempt((n) => n + 1) };
}
