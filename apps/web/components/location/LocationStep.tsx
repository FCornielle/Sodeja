"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { BuildingFootprint, CoverageResult } from "@sodeja/schemas";
import { apiFetch } from "../../lib/apiClient";
import { polygonCentroid, type LonLat } from "../../lib/geometry";
import type { LocationDraft } from "../../lib/types";
import { useBaseTileLayer } from "../../hooks/useBaseTileLayer";
import { useDrawPolygon } from "../../hooks/useDrawPolygon";
import { useFootprintLayer } from "../../hooks/useFootprintLayer";
import { CoverageBanner } from "./CoverageBanner";
import { DrawPanel } from "./DrawPanel";
import { FootprintSheet, type TapState } from "./FootprintSheet";
import { TypeAreaForm } from "./TypeAreaForm";

/** Default map center: Santo Domingo (specs/ux/flows.md Step 1: "Map centred on Santo Domingo by default"). */
const DEFAULT_CENTER: LonLat = [-69.9312, 18.4861];
const DEFAULT_ZOOM = 17.5;

type ViewMode = "map" | "draw" | "type-area";

function ringOf(footprint: BuildingFootprint): LonLat[] {
  return (footprint.geom.coordinates[0] ?? []) as LonLat[];
}

export function LocationStep({ onDraftReady }: { onDraftReady: (draft: LocationDraft) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [view, setView] = useState<ViewMode>("map");
  const [tapState, setTapState] = useState<TapState>({ kind: "idle" });
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const tapRequestId = useRef(0);

  const baseTiles = useBaseTileLayer(map);
  useFootprintLayer(map);
  const draw = useDrawPolygon(map, view === "draw");

  // Map init (once).
  useEffect(() => {
    if (!containerRef.current) return;
    const instance = new MapLibreMap({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [] },
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    setMap(instance);
    return () => instance.remove();
  }, []);

  // Launch-area coverage check, re-evaluated as the user pans (UX spec:
  // "the map still pans so the user can see the covered areas").
  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    async function checkCoverage(): Promise<void> {
      const center = map!.getCenter();
      try {
        const result = await apiFetch<CoverageResult>(
          `/geo/coverage?lon=${center.lng}&lat=${center.lat}`,
        );
        if (!cancelled) setCoverage(result);
      } catch {
        // A failed coverage check should not block panning/exploring; it
        // just leaves the banner in its last known state.
      }
    }

    void checkCoverage();
    map.on("moveend", checkCoverage);
    return () => {
      cancelled = true;
      map.off("moveend", checkCoverage);
    };
  }, [map]);

  // Tap-to-select (Step 1). Disabled while outside the launch area or while
  // in draw/type-area mode.
  useEffect(() => {
    if (!map) return;

    async function onClick(e: MapMouseEvent): Promise<void> {
      if (view !== "map") return;
      if (coverage && !coverage.covered) return; // "Tapping is disabled" outside the launch area

      const requestId = ++tapRequestId.current;
      setTapState({ kind: "loading" });
      try {
        const candidates = await apiFetch<BuildingFootprint[]>(
          `/geo/footprints/at?lon=${e.lngLat.lng}&lat=${e.lngLat.lat}`,
        );
        if (requestId !== tapRequestId.current) return;
        setTapState(candidates.length === 0 ? { kind: "no-candidate" } : { kind: "candidates", candidates });
      } catch {
        if (requestId === tapRequestId.current) setTapState({ kind: "idle" });
      }
    }

    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map, view, coverage]);

  function selectCandidate(footprint: BuildingFootprint): void {
    const centroid = polygonCentroid(ringOf(footprint)) ?? DEFAULT_CENTER;
    onDraftReady({
      areaSqm: footprint.areaSqm,
      centroidLon: centroid[0],
      centroidLat: centroid[1],
      areaSource: "footprint_dataset",
      footprintId: footprint.id,
      datasetSuggestedAreaSqm: footprint.areaSqm,
    });
  }

  function confirmDrawn(): void {
    if (draw.areaSqm === null || draw.invalid) return;
    const centroid = polygonCentroid(draw.points) ?? DEFAULT_CENTER;
    onDraftReady({
      areaSqm: draw.areaSqm,
      centroidLon: centroid[0],
      centroidLat: centroid[1],
      areaSource: "user_drawn",
    });
    draw.clear();
    setView("map");
  }

  function confirmTypedArea(areaSqm: number): void {
    const center = map?.getCenter() ?? { lng: DEFAULT_CENTER[0], lat: DEFAULT_CENTER[1] };
    onDraftReady({
      areaSqm,
      centroidLon: center.lng,
      centroidLat: center.lat,
      areaSource: "user_entered",
    });
    setView("map");
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col">
        <div className="pointer-events-auto">
          <CoverageBanner coverage={coverage} />
        </div>
        {baseTiles.status === "error" && (
          <div className="pointer-events-auto flex items-center justify-between border-b border-neutral-300 bg-neutral-100 px-4 py-2 text-sm text-neutral-700">
            <span>No pudimos cargar el mapa.</span>
            <button type="button" onClick={baseTiles.retry} className="font-medium text-blue-600 underline">
              Reintentar
            </button>
          </div>
        )}
      </div>

      {view === "map" && (
        <FootprintSheet
          tapState={tapState}
          onSelectCandidate={selectCandidate}
          onStartDraw={() => setView("draw")}
          onTypeArea={() => setView("type-area")}
        />
      )}

      {view === "draw" && (
        <DrawPanel
          pointCount={draw.points.length}
          invalid={draw.invalid}
          areaSqm={draw.areaSqm}
          onUndo={draw.undoLast}
          onConfirm={confirmDrawn}
          onCancel={() => {
            draw.clear();
            setView("map");
          }}
          onSwitchToTypeArea={() => setView("type-area")}
        />
      )}

      {view === "type-area" && (
        <TypeAreaForm onConfirm={confirmTypedArea} onCancel={() => setView("map")} />
      )}
    </div>
  );
}
