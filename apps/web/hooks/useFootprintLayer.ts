import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { BuildingFootprint } from "@sodeja/schemas";
import { apiFetch } from "../lib/apiClient";

const SOURCE_ID = "sodeja-footprints";
const FILL_LAYER_ID = "sodeja-footprints-fill";
const LINE_LAYER_ID = "sodeja-footprints-line";

/** UX spec Step 1: "footprint layer visible at zoom >= 17". */
export const FOOTPRINT_MIN_ZOOM = 17;

function toFeatureCollection(footprints: BuildingFootprint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: footprints.map((f) => ({
      type: "Feature",
      id: f.id,
      geometry: f.geom as GeoJSON.Polygon,
      properties: { id: f.id, areaSqm: f.areaSqm, source: f.source, sourceVintage: f.sourceVintage },
    })),
  };
}

/**
 * Renders `geo.building_footprint` rows as a MapLibre GeoJSON layer, always
 * on top of — and independent of — whatever base tiles are (or are not)
 * available (see useBaseTileLayer.ts). Refetches `GET /geo/footprints?bbox=`
 * on every `moveend` once the map is zoomed in past FOOTPRINT_MIN_ZOOM;
 * clears the layer below that zoom rather than fetching a huge bbox.
 */
export function useFootprintLayer(map: MapLibreMap | null): { loading: boolean } {
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (!map) return;

    function ensureLayers(): void {
      if (map!.getSource(SOURCE_ID)) return;
      map!.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map!.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        minzoom: FOOTPRINT_MIN_ZOOM,
        paint: { "fill-color": "#2563eb", "fill-opacity": 0.25 },
      });
      map!.addLayer({
        id: LINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        minzoom: FOOTPRINT_MIN_ZOOM,
        paint: { "line-color": "#1d4ed8", "line-width": 1.5 },
      });
    }

    async function refresh(): Promise<void> {
      const source = map!.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (!source) return;

      if (map!.getZoom() < FOOTPRINT_MIN_ZOOM) {
        source.setData({ type: "FeatureCollection", features: [] });
        return;
      }

      const bounds = map!.getBounds();
      const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(",");
      const thisRequest = ++requestId.current;
      setLoading(true);
      try {
        const footprints = await apiFetch<BuildingFootprint[]>(`/geo/footprints?bbox=${encodeURIComponent(bbox)}`);
        if (thisRequest !== requestId.current) return; // superseded by a later request
        source.setData(toFeatureCollection(footprints));
      } catch {
        // Non-fatal: the viewport layer is a visual aid. The tap-to-select
        // request (LocationStep's own apiFetch, not this hook) is what
        // surfaces an actual error to the user.
      } finally {
        if (thisRequest === requestId.current) setLoading(false);
      }
    }

    function onLoad(): void {
      ensureLayers();
      void refresh();
    }

    if (map.isStyleLoaded()) onLoad();
    else map.once("load", onLoad);

    map.on("moveend", refresh);
    return () => {
      map.off("moveend", refresh);
    };
  }, [map]);

  return { loading };
}
