/**
 * cad kotoba — model + revision + comment registries + coverage.
 * AT PDS records (no RW). Revisions / comments FK-reference an existing model.
 * CAD design data; geometry referenced by CID.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  COMMENT_COLLECTION,
  FORMATS,
  MODEL_COLLECTION,
  REVISION_COLLECTION,
  commentDidFor,
  commentRkey,
  isPosInt,
  looksLikeCid,
  modelDidFor,
  modelRkey,
  revisionDidFor,
  revisionRkey,
  type AddCommentInput,
  type AddCommentOutput,
  type AddRevisionInput,
  type AddRevisionOutput,
  type CommentRecord,
  type CommentView,
  type CoverageInput,
  type CoverageOutput,
  type CreateModelInput,
  type CreateModelOutput,
  type GetModelInput,
  type GetModelOutput,
  type GetRevisionInput,
  type GetRevisionOutput,
  type ListCommentsInput,
  type ListCommentsOutput,
  type ListModelsInput,
  type ListModelsOutput,
  type ListRevisionsInput,
  type ListRevisionsOutput,
  type ModelRecord,
  type ModelView,
  type ResolveCommentInput,
  type ResolveCommentOutput,
  type RevisionRecord,
  type RevisionView,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

async function exists(e: Etzhayyim, collection: string, rkey: string): Promise<boolean> {
  const resp = await e.read({ collection, rkey }).catch(() => ({ records: [] }));
  return Boolean(resp.records[0]?.value);
}

async function scanAll<T>(e: Etzhayyim, collection: string, maxScan: number, onRow: (v: T) => void): Promise<number> {
  let cursor: string | undefined;
  let scanned = 0;
  while (scanned < maxScan) {
    const page = await e.read<T>({ collection, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      if (scanned >= maxScan) break;
      onRow(r.value);
      scanned += 1;
    }
    if (scanned >= maxScan || !page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return scanned;
}

// ─── Model ──────────────────────────────────────────────────────────

export async function createModel(e: Etzhayyim, input: CreateModelInput): Promise<CreateModelOutput> {
  if (!input.modelId || !input.name) return { status: "rejected", error: "missingRequiredFields" };
  if (!FORMATS.has(input.format)) return { status: "rejected", error: "invalidFormat" };
  if (input.ownerDid && !input.ownerDid.startsWith("did:")) return { status: "rejected", error: "invalidOwnerDid" };
  const rkey = modelRkey(input.modelId);
  const existing = await e.read<ModelRecord>({ collection: MODEL_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", modelUri: existing.records[0].uri, did: existing.records[0].value.did, modelId: input.modelId };
  }
  const did = modelDidFor(input.modelId);
  const record: ModelRecord = {
    did,
    modelId: input.modelId,
    workspaceId: input.workspaceId,
    name: input.name,
    format: input.format,
    ownerDid: input.ownerDid,
    status: "active",
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: MODEL_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "created", modelUri: receipt.uri, did, modelId: input.modelId };
}

export async function getModel(e: Etzhayyim, input: GetModelInput): Promise<GetModelOutput> {
  if (!input.modelId) return { error: "invalidModelId" };
  const resp = await e.read<ModelRecord>({ collection: MODEL_COLLECTION, rkey: modelRkey(input.modelId) }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { model: { ...r.value, modelUri: r.uri } };
}

export async function listModels(e: Etzhayyim, input: ListModelsInput = {}): Promise<ListModelsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<ModelRecord>({ collection: MODEL_COLLECTION, cursor: input.cursor, limit });
  const q = input.q?.toLowerCase();
  const items: ModelView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.workspaceId && v.workspaceId !== input.workspaceId) return false;
      if (input.ownerDid && v.ownerDid !== input.ownerDid) return false;
      if (input.format && v.format !== input.format) return false;
      if (input.status && v.status !== input.status) return false;
      if (q && !v.name.toLowerCase().includes(q)) return false;
      return true;
    })
    .map((r) => ({ ...r.value, modelUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Revision ───────────────────────────────────────────────────────

export async function addRevision(e: Etzhayyim, input: AddRevisionInput): Promise<AddRevisionOutput> {
  if (!input.revisionId || !input.modelId) return { status: "rejected", error: "missingRequiredFields" };
  if (!isPosInt(input.version)) return { status: "rejected", error: "versionMustBePosInt" };
  if (input.representationCid && !looksLikeCid(input.representationCid)) return { status: "rejected", error: "invalidRepresentationCid" };
  if (!(await exists(e, MODEL_COLLECTION, modelRkey(input.modelId)))) {
    return { status: "modelNotFound", error: `modelNotFound:${input.modelId}` };
  }
  const rkey = revisionRkey(input.revisionId);
  const existing = await e.read<RevisionRecord>({ collection: REVISION_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", revisionUri: existing.records[0].uri, did: existing.records[0].value.did, revisionId: input.revisionId };
  }
  const did = revisionDidFor(input.revisionId);
  const record: RevisionRecord = {
    did,
    revisionId: input.revisionId,
    modelId: input.modelId,
    version: input.version,
    representationCid: input.representationCid,
    note: input.note,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: REVISION_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "added", revisionUri: receipt.uri, did, revisionId: input.revisionId };
}

export async function getRevision(e: Etzhayyim, input: GetRevisionInput): Promise<GetRevisionOutput> {
  if (!input.revisionId) return { error: "invalidRevisionId" };
  const resp = await e.read<RevisionRecord>({ collection: REVISION_COLLECTION, rkey: revisionRkey(input.revisionId) }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { revision: { ...r.value, revisionUri: r.uri } };
}

export async function listRevisions(e: Etzhayyim, input: ListRevisionsInput = {}): Promise<ListRevisionsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<RevisionRecord>({ collection: REVISION_COLLECTION, cursor: input.cursor, limit });
  const items: RevisionView[] = resp.records
    .filter((r) => (input.modelId ? r.value.modelId === input.modelId : true))
    .map((r) => ({ ...r.value, revisionUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Comment ────────────────────────────────────────────────────────

export async function addComment(e: Etzhayyim, input: AddCommentInput): Promise<AddCommentOutput> {
  if (!input.commentId || !input.modelId || !input.body) return { status: "rejected", error: "missingRequiredFields" };
  if (input.authorDid && !input.authorDid.startsWith("did:")) return { status: "rejected", error: "invalidAuthorDid" };
  if (!(await exists(e, MODEL_COLLECTION, modelRkey(input.modelId)))) {
    return { status: "modelNotFound", error: `modelNotFound:${input.modelId}` };
  }
  const rkey = commentRkey(input.commentId);
  const existing = await e.read<CommentRecord>({ collection: COMMENT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", commentUri: existing.records[0].uri, did: existing.records[0].value.did, commentId: input.commentId };
  }
  const did = commentDidFor(input.commentId);
  const record: CommentRecord = {
    did,
    commentId: input.commentId,
    modelId: input.modelId,
    revisionId: input.revisionId,
    anchorRef: input.anchorRef,
    body: input.body,
    authorDid: input.authorDid,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: COMMENT_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "added", commentUri: receipt.uri, did, commentId: input.commentId };
}

export async function resolveComment(e: Etzhayyim, input: ResolveCommentInput): Promise<ResolveCommentOutput> {
  if (!input.commentId) return { status: "rejected", error: "invalidCommentId" };
  const rkey = commentRkey(input.commentId);
  const resp = await e.read<CommentRecord>({ collection: COMMENT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const comment = resp.records[0]?.value;
  if (!comment) return { status: "notFound", error: "commentNotFound" };
  if (comment.status === "resolved") return { status: "rejected", error: "alreadyResolved" };
  await e.write({ collection: COMMENT_COLLECTION, record: { ...comment, status: "resolved" } as unknown as Record<string, unknown>, rkey });
  return { status: "resolved", commentId: input.commentId };
}

export async function listComments(e: Etzhayyim, input: ListCommentsInput = {}): Promise<ListCommentsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<CommentRecord>({ collection: COMMENT_COLLECTION, cursor: input.cursor, limit });
  const items: CommentView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.modelId && v.modelId !== input.modelId) return false;
      if (input.revisionId && v.revisionId !== input.revisionId) return false;
      if (input.status && v.status !== input.status) return false;
      return true;
    })
    .map((r) => ({ ...r.value, commentUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Coverage ───────────────────────────────────────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const modelsByFormat: Record<string, number> = {};
  const modelCount = await scanAll<ModelRecord>(e, MODEL_COLLECTION, maxScan, (v) => {
    modelsByFormat[v.format] = (modelsByFormat[v.format] ?? 0) + 1;
  });
  const revisionCount = await scanAll<RevisionRecord>(e, REVISION_COLLECTION, maxScan, () => {});
  let openComments = 0;
  const commentCount = await scanAll<CommentRecord>(e, COMMENT_COLLECTION, maxScan, (v) => {
    if (v.status === "open") openComments += 1;
  });
  return {
    modelCount,
    revisionCount,
    commentCount,
    modelsByFormat,
    openComments,
    truncated: modelCount >= maxScan || revisionCount >= maxScan || commentCount >= maxScan,
  };
}
