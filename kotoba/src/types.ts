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
