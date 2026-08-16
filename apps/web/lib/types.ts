import type { AreaSource } from "@sodeja/schemas";

/**
 * Client-side draft of a confirmed location, produced by either Step 1 (a
 * footprint tap) or Secondary Flow A (draw/type), and consumed by Step 2
 * (`ConfirmAreaStep`) before it becomes a real `PUT /projects/:id/location`
 * call.
 *
 * `areaSource` is how the draft was produced (`footprint_dataset` /
 * `user_drawn` / `user_entered`). Step 2 sends it on to
 * `PUT /projects/:id/location`, downgrading it to `user_entered` if the user
 * edits the number there — the API never infers provenance itself.
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
