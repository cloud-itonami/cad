/**
 * cad kotoba — browser-CAD record types.
 *
 * Per ADR-2606011400 + ADR-2604241500 (cad/bim topology). cad is a browser CAD
 * viewer/editor/reviewer/exporter: models + revisions (FK→model, geometry by CID)
 * + anchored comments (FK→model). app boundary workspace→model→revision→
 * representation. Registry on AT PDS records (replaces RW). ADR-2605172000
 * kotoba.
 *
 * AXIS NOTE (ADR-2605172400): axis-clean — CAD design technical data, not
 * personal PII. No settlement, no fulfillment liability (viewer/reviewer). Large
 * geometry (STEP/IGES/…) referenced by CID (IPFS, a permitted etzhayyim
 * substrate), not inlined.
 *
 * AT-Lexicon: no float. Revision version is an integer.
 *
 * Identity hierarchy:
 *   did:web:cad.etzhayyim.com                          — controller
 *   did:web:cad.etzhayyim.com:model:{modelId}          — a CAD model
 *   did:web:cad.etzhayyim.com:revision:{revisionId}    — a model revision
 *   did:web:cad.etzhayyim.com:comment:{commentId}      — an anchored comment
 */

export const CAD_DID_PREFIX = "did:web:cad.etzhayyim.com:" as const;

export const MODEL_COLLECTION = "com.etzhayyim.apps.cad.model";
export const REVISION_COLLECTION = "com.etzhayyim.apps.cad.revision";
export const COMMENT_COLLECTION = "com.etzhayyim.apps.cad.comment";

// ─── Model ──────────────────────────────────────────────────────────

export type CadFormat = "STEP" | "IGES" | "DWG" | "DXF" | "STL" | "OBJ" | "GLTF" | "other";
export type ModelStatus = "active" | "archived";

export interface ModelRecord {
  did: string;
  modelId: string;
  /** Workspace grouping (workspace→model), optional. */
  workspaceId?: string;
  name: string;
  format: CadFormat;
  ownerDid?: string;
  status: ModelStatus;
  createdAt: string;
}
export interface ModelView extends ModelRecord {
  modelUri: string;
}
export interface CreateModelInput {
  modelId: string;
  name: string;
  format: CadFormat;
  workspaceId?: string;
  ownerDid?: string;
}
export interface CreateModelOutput {
  status: "created" | "alreadyExists" | "rejected";
  modelUri?: string;
  did?: string;
  modelId?: string;
  error?: string;
}
export interface GetModelInput {
  modelId: string;
}
export interface GetModelOutput {
  model?: ModelView;
  error?: string;
}
export interface ListModelsInput {
  workspaceId?: string;
  ownerDid?: string;
  format?: CadFormat;
  status?: ModelStatus;
  /** App-layer substring match over name. */
  q?: string;
  limit?: number;
  cursor?: string;
}
export interface ListModelsOutput {
  items: ModelView[];
  cursor?: string;
  total: number;
}

// ─── Revision ───────────────────────────────────────────────────────

export interface RevisionRecord {
  did: string;
  revisionId: string;
  /** FK → model modelId. */
  modelId: string;
  /** Monotonic revision number (≥1). */
  version: number;
  /** IPFS CID of the geometry representation, optional. */
  representationCid?: string;
  note?: string;
  createdAt: string;
}
export interface RevisionView extends RevisionRecord {
  revisionUri: string;
}
export interface AddRevisionInput {
  revisionId: string;
  modelId: string;
  version: number;
  representationCid?: string;
  note?: string;
}
export interface AddRevisionOutput {
  status: "added" | "alreadyExists" | "rejected" | "modelNotFound";
  revisionUri?: string;
  did?: string;
  revisionId?: string;
  error?: string;
}
export interface GetRevisionInput {
  revisionId: string;
}
export interface GetRevisionOutput {
  revision?: RevisionView;
  error?: string;
}
export interface ListRevisionsInput {
  modelId?: string;
  limit?: number;
  cursor?: string;
}
export interface ListRevisionsOutput {
  items: RevisionView[];
  cursor?: string;
  total: number;
}

// ─── Anchored comment ───────────────────────────────────────────────

export type CommentStatus = "open" | "resolved";

export interface CommentRecord {
  did: string;
  commentId: string;
  /** FK → model modelId. */
  modelId: string;
  /** Optional revision context. */
  revisionId?: string;
  /** Anchor reference (geometry element / coordinate handle), optional. */
  anchorRef?: string;
  body: string;
  authorDid?: string;
  status: CommentStatus;
  createdAt: string;
}
export interface CommentView extends CommentRecord {
  commentUri: string;
}
export interface AddCommentInput {
  commentId: string;
  modelId: string;
  body: string;
  revisionId?: string;
  anchorRef?: string;
  authorDid?: string;
}
export interface AddCommentOutput {
  status: "added" | "alreadyExists" | "rejected" | "modelNotFound";
  commentUri?: string;
  did?: string;
  commentId?: string;
  error?: string;
}
export interface ResolveCommentInput {
  commentId: string;
}
export interface ResolveCommentOutput {
  status: "resolved" | "notFound" | "rejected";
  commentId?: string;
  error?: string;
}
export interface ListCommentsInput {
  modelId?: string;
  revisionId?: string;
  status?: CommentStatus;
  limit?: number;
  cursor?: string;
}
export interface ListCommentsOutput {
  items: CommentView[];
  cursor?: string;
  total: number;
}

// ─── Coverage ───────────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  modelCount?: number;
  revisionCount?: number;
  commentCount?: number;
  modelsByFormat?: Record<string, number>;
  openComments?: number;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export const FORMATS: ReadonlySet<string> = new Set(["STEP", "IGES", "DWG", "DXF", "STL", "OBJ", "GLTF", "other"]);

export function isPosInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}
export function looksLikeCid(s: string): boolean {
  return /^b[a-z2-7]{20,}$/.test(s) || /^Qm[1-9A-HJ-NP-Za-km-z]{20,}$/.test(s);
}

export function modelDidFor(id: string): string {
  return `${CAD_DID_PREFIX}model:${id.toLowerCase()}`;
}
export function modelRkey(id: string): string {
  return `model-${id.toLowerCase()}`;
}
export function revisionDidFor(id: string): string {
  return `${CAD_DID_PREFIX}revision:${id.toLowerCase()}`;
}
export function revisionRkey(id: string): string {
  return `revision-${id.toLowerCase()}`;
}
export function commentDidFor(id: string): string {
  return `${CAD_DID_PREFIX}comment:${id.toLowerCase()}`;
}
export function commentRkey(id: string): string {
  return `comment-${id.toLowerCase()}`;
}

// ─── Production release (manufacturing gate) ────────────────────────
//
// Manufacturing decision contract: a design revision may enter a
// manufacturing cell (die machining, cartridge integration, reactor
// fabrication, PEM stack assembly, system EOL) only through a release record
// issued by a human approver. The gate is a decision over recorded facts; the
// release record is the audit artifact MES traceability points at. No
// equipment command, procurement, sale, payment, or regulatory commitment is
// authorized by this record.

export const PRODUCTION_RELEASE_COLLECTION = "com.etzhayyim.apps.cad.production-release";

export type ProductionReleaseCell =
  | "die-machining"
  | "cartridge-integration"
  | "reactor-fabrication"
  | "pem-stack-assembly"
  | "system-eol"
  | "electronics-smt-and-test"
  | "other";

export type ProductionReleaseStatus = "released" | "superseded";

export interface ProductionReleaseRecord {
  did: string;
  releaseId: string;
  /** FK → revision revisionId. */
  revisionId: string;
  /** Denormalized from the revision at release time (audit snapshot). */
  modelId: string;
  revisionVersion: number;
  representationCid: string;
  releasedFor: ProductionReleaseCell;
  /** MES lot / job reference the release is bound to. */
  mesLotRef: string;
  requestedByDid: string;
  /** Human approver (never a cad-controller-namespace bot/actor DID). */
  approverDid: string;
  /** Optional material provenance carried from the material-designation registry. */
  materialDesignationId?: string;
  /** Required for hazardous cells (molten Mg, H2, HV, rotating equipment). */
  safetySignoffDid?: string;
  /** Prior release this one replaces (validated to exist and be same-model). */
  supersedesReleaseId?: string;
  note?: string;
  status: ProductionReleaseStatus;
  createdAt: string;
  supersededByReleaseId?: string;
  supersededAt?: string;
  supersededByDid?: string;
}
export interface ProductionReleaseView extends ProductionReleaseRecord {
  releaseUri: string;
}

export interface RequestProductionReleaseInput {
  releaseId: string;
  revisionId: string;
  releasedFor: ProductionReleaseCell;
  mesLotRef: string;
  requestedByDid: string;
  approverDid: string;
  materialDesignationId?: string;
  safetySignoffDid?: string;
  supersedesReleaseId?: string;
  note?: string;
}
export interface RequestProductionReleaseOutput {
  status: "released" | "blocked" | "alreadyReleased" | "rejected";
  releaseUri?: string;
  did?: string;
  releaseId?: string;
  /** Gate reasons when blocked (never invented values — refs and counts only). */
  reasons?: string[];
  error?: string;
}

export interface GetProductionReleaseInput {
  releaseId: string;
}
export interface GetProductionReleaseOutput {
  release?: ProductionReleaseView;
  error?: string;
}

export interface ListProductionReleasesInput {
  revisionId?: string;
  modelId?: string;
  releasedFor?: ProductionReleaseCell;
  limit?: number;
  cursor?: string;
}
export interface ListProductionReleasesOutput {
  items: ProductionReleaseView[];
  cursor?: string;
  total: number;
}

export interface ResolveProductionReleaseInput {
  releaseId: string;
  supersededByReleaseId: string;
  byDid: string;
}
export interface ResolveProductionReleaseOutput {
  status: "superseded" | "rejected";
  releaseId?: string;
  supersededByReleaseId?: string;
  error?: string;
}

export function productionReleaseDidFor(id: string): string {
  return `${CAD_DID_PREFIX}production-release:${id.toLowerCase()}`;
}
export function productionReleaseRkey(id: string): string {
  return `production-release-${id.toLowerCase()}`;
}

/** AT PDS read page row shape used by the registry helpers. */
export interface EtzhayyimRecord<T> {
  uri: string;
  value: T;
}

// ─── Material & units designation (manufacturing material provenance) ────
//
// A design revision is authored for a recorded material designation and a
// units regime. Before the production-release gate sends a revision into a
// manufacturing cell, it must carry transportable material provenance so MES
// traceability and the consuming cell know what material the geometry is
// dimensioned for. This record is a DECISION over recorded facts — it records
// the designation and a human-supplied source, it does not invent any material
// constant (density, yield, rating, certification) — those values stay
// unmeasured until a direct manufacturer/dealer source records them.
//
// activity : a human author designates the material + units regime for a model
// decision : FK -> model present | designation non-empty | units regime in the
//            allowed set | source URL present and https | author is a human
//            (never a cad-controller bot/actor DID)
// effect   : AT PDS material-designation record (audit artifact)
// audit    : designation, units regime, source URL, author, model FK,
//            timestamps — every designation is one immutable record
//
// Hazard boundary: no equipment command, procurement, sale, payment, or
// regulatory commitment is authorized here. No material constant is asserted.

export const MATERIAL_DESIGNATION_COLLECTION = "com.etzhayyim.apps.cad.material-designation";

export type UnitsRegime = "metric-si" | "imperial";
export type MaterialRecordKind = "alloy-designation" | "generically-magnesium" | "composite" | "polymer" | "other";

export const UNITS_REGIMES: ReadonlySet<string> = new Set(["metric-si", "imperial"]);

export interface MaterialDesignationRecord {
  did: string;
  designationId: string;
  /** FK to the model whose geometry this designation applies to. */
  modelId: string;
  /** Human-recorded material designation (e.g. a registered alloy code). */
  designation: string;
  kind: MaterialRecordKind;
  unitsRegime: UnitsRegime;
  /** Human-supplied source (manufacturer / standards / owner document) URL. */
  sourceUrl: string;
  /** Human author — never a cad-controller-namespace bot/actor DID. */
  authorDid: string;
  createdAt: string;
}
export interface MaterialDesignationView extends MaterialDesignationRecord {
  designationUri: string;
}

export interface RegisterMaterialDesignationInput {
  designationId: string;
  modelId: string;
  designation: string;
  kind: MaterialRecordKind;
  unitsRegime: UnitsRegime;
  sourceUrl: string;
  authorDid: string;
}
export interface RegisterMaterialDesignationOutput {
  status: "registered" | "alreadyExists" | "rejected" | "modelNotFound";
  designationUri?: string;
  did?: string;
  designationId?: string;
  error?: string;
}

export interface GetMaterialDesignationInput {
  designationId: string;
}
export interface GetMaterialDesignationOutput {
  designation?: MaterialDesignationView;
  error?: string;
}

export interface ListMaterialDesignationsInput {
  modelId?: string;
  kind?: MaterialRecordKind;
  limit?: number;
  cursor?: string;
}
export interface ListMaterialDesignationsOutput {
  items: MaterialDesignationView[];
  cursor?: string;
  total: number;
}

export function materialDesignationDidFor(id: string): string {
  return `${CAD_DID_PREFIX}material-designation:${id.toLowerCase()}`;
}
export function materialDesignationRkey(id: string): string {
  return `material-designation-${id.toLowerCase()}`;
}
export function looksLikeHttpUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s);
}
