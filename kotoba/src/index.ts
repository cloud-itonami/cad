/**
 * cad kotoba — barrel.
 *
 * Per ADR-2606011400. Browser CAD (models + revisions + anchored comments) on the
 * etzhayyim substrate (AT PDS records; no RW).
 *
 *   model    : createModel / getModel / listModels (q = app-layer search)
 *   revision : addRevision (FK→model, geometry CID) / getRevision / listRevisions
 *   comment  : addComment (FK→model, anchored) / resolveComment / listComments
 *   coverage
 *
 * CAD design technical data; large geometry referenced by CID (IPFS).
 */

export * from "./types.js";
export {
  createModel,
  getModel,
  listModels,
  addRevision,
  getRevision,
  listRevisions,
  addComment,
  resolveComment,
  listComments,
  coverage,
} from "./registry.js";
export {
  requestProductionRelease,
  getProductionRelease,
  listProductionReleases,
  resolveProductionRelease,
  HAZARDOUS_CELLS,
  PRODUCTION_RELEASE_CELLS,
} from "./production.js";
