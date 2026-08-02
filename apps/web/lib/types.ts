import type { AreaSource } from "@sodeja/schemas";

/**
 * Client-side draft of a confirmed location, produced by either Step 1 (a
 * footprint tap) or Secondary Flow A (draw/type), and consumed by Step 2
 * (`ConfirmAreaStep`) before it becomes a real `PUT /projects/:id/location`
 * call.
 *
 * `areaSource` reflects the UX spec's INTENDED provenance
 * (`footprint_dataset` / `user_drawn` / `user_entered`) for on-screen
 * display only. `ConfirmAreaStep.tsx`'s doc comment explains why the value
 * actually persisted by `PUT /projects/:id/location` is always
 * `user_entered` regardless — a documented B-7a contract gap, not a bug in
 * this client.
 */
export interface LocationDraft {
  areaSqm: number;
  centroidLon: number;
  centroidLat: number;
  areaSource: AreaSource;
  /** Present only when the draft originated from a footprint tap (Step 1). */
  footprintId?: number;
  /**
   * The dataset's original suggested area, captured at selection time.
   * Present only for footprint-tap drafts — lets Step 2 tell "accepted
   * unchanged" apart from "edited" per the UX spec's state table.
   */
  datasetSuggestedAreaSqm?: number;
}
