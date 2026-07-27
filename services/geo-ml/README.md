# `services/geo-ml` — Geospatial / ML Service

**Status: PHASE 3 — placeholder only. Deliberately not built for the MVP.**

This directory exists to mark the seam, not to be filled in soon. Creating it now
is free; discovering later that the monolith has no place to put a GPU workload
is not.

## Why this is Phase 3 and not Phase 1

**The value is already available for free.** Google Open Buildings V3 and
Microsoft GlobalML footprints both reportedly cover the DR under storable
licences. Ingested into PostGIS, "detect the building the user tapped" becomes a
sub-10ms `ST_Contains` query returning a real polygon with a computed area — no
inference cost, no imagery-licensing exposure. An in-house CV model would spend
heavily to slightly improve a solved problem.

**The harder half is not solvable from overhead imagery by anyone.** Satellite
imagery yields a roof outline. It does not yield floor count, interior
partitions, ceiling height, column spacing, or usable-versus-gross area. Module 4
(space layout) therefore cannot be imagery-driven at any budget, and is built
from user-entered dimensions plus parametric typology templates instead — which
is also more auditable in a document a user shows a lender.

So Phase 1's "detection" is **footprint retrieval plus geometric heuristics**,
served by the monolith. It is not a neural model, and the product copy must not
imply that it is. *(Master Plan §4.1 records this as an open product decision:
whether "AI detection" is a marketing claim or a capability commitment.)*

## Intended stack when it is built

Python 3 + FastAPI, GeoPandas / rasterio / shapely, PyTorch only if genuine
segmentation work is approved. This is the one justified polyglot seam in the
system — Python owns the geospatial and ML ecosystem outright.

Always invoked asynchronously via the queue, never in a request path.

## Hard constraint carried forward

Any model must train and infer on **openly-licensed or purchased imagery**.
Google and Mapbox satellite tiles are display-only; running detection against
them risks API-key termination (risk L4). This constraint is the reason
footprints come from open datasets while satellite tiles stay presentational.

## Gating dependencies

B-4 (footprints ingested) and **B-22 (a 30-50 space ground-truth set)**. Without
B-22 there is no way to measure whether a model improves on the free datasets, and
no accuracy claim may be published (risk D4).

## Related backlog items

B-29 (Python geo/ML service, genuine CV refinement).
