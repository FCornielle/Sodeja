import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { polygonAreaSqm, polygonSelfIntersects, type LonLat } from "../lib/geometry";

const SOURCE_ID = "sodeja-draw";
const FILL_LAYER_ID = "sodeja-draw-fill";
const LINE_LAYER_ID = "sodeja-draw-line";
const VERTEX_LAYER_ID = "sodeja-draw-vertices";

function toFeatureCollection(points: LonLat[], invalid: boolean): GeoJSON.FeatureCollection {
  const vertexFeatures: GeoJSON.Feature[] = points.map((point, index) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: point },
    properties: { index, invalid },
  }));

  const outlineFeatures: GeoJSON.Feature[] = [];
  if (points.length >= 2) {
    outlineFeatures.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: points },
      properties: {},
    });
  }
  if (points.length >= 3) {
    outlineFeatures.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...points, points[0]!]] },
      properties: {},
    });
  }

  return { type: "FeatureCollection", features: [...outlineFeatures, ...vertexFeatures] };
}

export interface DrawPolygon {
  points: LonLat[];
  /** From lib/geometry.ts's polygonSelfIntersects — real @turf/kinks topology check. */
  invalid: boolean;
  /** From lib/geometry.ts's polygonAreaSqm — real @turf/area computation; null below 3 points. */
  areaSqm: number | null;
  addPoint: (point: LonLat) => void;
  undoLast: () => void;
  clear: () => void;
}

/**
 * Secondary Flow A's draw mode (specs/ux/flows.md): "Tap to place vertices,
 * drag to adjust, undo last point." Interaction/vertex management here is
 * hand-rolled MapLibre event wiring — only the geometry MATH (area,
 * self-intersection; see lib/geometry.ts) is required to use a real
 * library, per this task's brief; drag/undo bookkeeping is plain UI state,
 * not geometry computation. `invalid`/`areaSqm` are derived from `points` on
 * every change (real @turf/kinks + @turf/area calls), not tracked as
 * separate state, so they can never drift out of sync with the current
 * vertex list.
 *
 * `invalid` drives the "highlight vertices red" state — every vertex, not
 * just the offending pair, matching the UX spec's copy ("El contorno se
 * cruza") which names the shape, not a specific point.
 */
export function useDrawPolygon(map: MapLibreMap | null, active: boolean): DrawPolygon {
  const [points, setPoints] = useState<LonLat[]>([]);
  const invalid = useMemo(() => polygonSelfIntersects(points), [points]);
  const areaSqm = useMemo(() => polygonAreaSqm(points), [points]);
  const activeRef = useRef(active);
  activeRef.current = active;
  const draggingIndex = useRef<number | null>(null);

  const addPoint = useCallback((point: LonLat) => setPoints((prev) => [...prev, point]), []);
  const undoLast = useCallback(() => setPoints((prev) => prev.slice(0, -1)), []);
  const clear = useCallback(() => setPoints([]), []);

  // Reset the drawing whenever draw mode is (re)entered.
  useEffect(() => {
    if (active) setPoints([]);
  }, [active]);

  // Layer setup (once per map instance).
  useEffect(() => {
    if (!map) return;
    function ensureLayers(): void {
      if (map!.getSource(SOURCE_ID)) return;
      map!.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map!.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#16a34a", "fill-opacity": 0.2 },
      });
      map!.addLayer({
        id: LINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        filter: ["!=", ["geometry-type"], "Point"],
        paint: { "line-color": "#15803d", "line-width": 2 },
      });
      map!.addLayer({
        id: VERTEX_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 6,
          "circle-color": ["case", ["get", "invalid"], "#dc2626", "#15803d"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
    }
    if (map.isStyleLoaded()) ensureLayers();
    else map.once("load", ensureLayers);
  }, [map]);

  // Keep the source in sync with `points`/`invalid`.
  useEffect(() => {
    if (!map) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(toFeatureCollection(points, invalid));
  }, [map, points, invalid]);

  // Click-to-add / mousedown-to-drag / mouseup-to-release wiring, active
  // only while draw mode is active.
  useEffect(() => {
    if (!map) return;

    function onVertexMouseDown(e: MapMouseEvent & { features?: GeoJSON.Feature[] }): void {
      if (!activeRef.current) return;
      const feature = e.features?.[0];
      const index = feature?.properties?.index;
      if (typeof index !== "number") return;
      e.preventDefault();
      draggingIndex.current = index;
      map!.dragPan.disable();
      map!.getCanvas().style.cursor = "grabbing";
    }

    function onMapMouseMove(e: MapMouseEvent): void {
      if (draggingIndex.current === null) return;
      const index = draggingIndex.current;
      setPoints((prev) => prev.map((p, i) => (i === index ? [e.lngLat.lng, e.lngLat.lat] : p)));
    }

    function endDrag(): void {
      if (draggingIndex.current === null) return;
      draggingIndex.current = null;
      map!.dragPan.enable();
      map!.getCanvas().style.cursor = "";
    }

    function onMapClick(e: MapMouseEvent & { features?: GeoJSON.Feature[] }): void {
      if (!activeRef.current || draggingIndex.current !== null) return;
      const hitVertex = map!.queryRenderedFeatures(e.point, { layers: [VERTEX_LAYER_ID] });
      if (hitVertex.length > 0) return; // clicking an existing vertex starts a drag, never adds a duplicate
      addPoint([e.lngLat.lng, e.lngLat.lat]);
    }

    map.on("mousedown", VERTEX_LAYER_ID, onVertexMouseDown);
    map.on("mousemove", onMapMouseMove);
    map.on("mouseup", endDrag);
    map.on("click", onMapClick);

    return () => {
      map.off("mousedown", VERTEX_LAYER_ID, onVertexMouseDown);
      map.off("mousemove", onMapMouseMove);
      map.off("mouseup", endDrag);
      map.off("click", onMapClick);
    };
  }, [map, addPoint]);

  return { points, invalid, areaSqm, addPoint, undoLast, clear };
}
