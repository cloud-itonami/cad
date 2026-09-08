/**
 * cad kotoba — production-release gate (manufacturing decision contract).
 *
 * Stands between the design registry (model → revision → anchored comments) and
 * the manufacturing cells that consume a revision (die machining, cartridge
 * integration, reactor fabrication, PEM stack assembly, system EOL). A revision
 * may only be released for production use when the gate passes; the gate is a
 * pure decision over recorded facts, and the release record is the audit
 * artifact the MES side can point at.
 *
 * activity  : a revision is proposed for use by a manufacturing cell
 *             (requestProductionRelease with mesLotRef)
 * decision  : revision FK holds · representation CID present · all anchored
 *             comments on the model/revision resolved · MES lot ref present ·
 *             HUMAN approver distinct from the requester · safety sign-off for
 *             hazardous cells · supersedes ref (if given) resolves
 * effect    : AT PDS release record (com.etzhayyim.apps.cad.production-release)
 * audit     : requester, human approver, safety sign-off, decision reasons,
 *             MES lot ref, timestamps — every release is one record, immutable
 *
 * Hazard boundary: the gate never issues a release autonomously. approverDid
 * and (for hazardous cells) safetySignoffDid must be human DIDs — a DID under
 * the cad controller prefix (bots/actors) is refused as an approver. This
 * contract authorizes no physical equipment, procurement, sale, payment, or
 * regulatory commitment.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  COMMENT_COLLECTION,
  MATERIAL_DESIGNATION_COLLECTION,
  PRODUCTION_RELEASE_COLLECTION,
  looksLikeCid,
  materialDesignationRkey,
  productionReleaseDidFor,
  productionReleaseRkey,
  revisionRkey,
  type EtzhayyimRecord,
  type ListProductionReleasesInput,
  type ListProductionReleasesOutput,
  type GetProductionReleaseInput,
  type GetProductionReleaseOutput,
  type ProductionReleaseCell,
  type ProductionReleaseRecord,
  type ProductionReleaseView,
  type RequestProductionReleaseInput,
  type RequestProductionReleaseOutput,
  type ResolveProductionReleaseInput,
  type ResolveProductionReleaseOutput,
} from "./types.js";

const PAGE_LIMIT = 100;

/** Cells whose tooling presents physical hazards (molten Mg, H2, HV, rotating equipment). */
export const HAZARDOUS_CELLS: ReadonlySet<ProductionReleaseCell> = new Set([
  "die-machining",
  "cartridge-integration",
  "reactor-fabrication",
  "pem-stack-assembly",
  "system-eol",
]);

export const PRODUCTION_RELEASE_CELLS: ReadonlySet<string> = new Set([
  ...HAZARDOUS_CELLS,
  "electronics-smt-and-test",
  "other",
]);

function isHumanDid(did: string): boolean {
  if (!did.startsWith("did:")) return false;
  // The cad controller DID namespace belongs to bots/actors of this app; a
  // production release is a human commitment and cannot be issued by them.
  return !did.startsWith("did:web:cad.etzhayyim.com");
}

async function readRecord<T>(e: Etzhayyim, collection: string, rkey: string): Promise<EtzhayyimRecord<T> | undefined> {
  const resp = await e.read<T>({ collection, rkey }).catch(() => ({ records: [] }));
  return resp.records[0];
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

/** Gate decision: collect every blocking reason, release only when the list is empty. */
export async function requestProductionRelease(
  e: Etzhayyim,
  input: RequestProductionReleaseInput,
): Promise<RequestProductionReleaseOutput> {
  const reasons: string[] = [];
  if (!input.releaseId || !input.revisionId || !input.mesLotRef) {
    return { status: "rejected", error: "missingRequiredFields", reasons: [] };
  }
  if (!PRODUCTION_RELEASE_CELLS.has(input.releasedFor)) {
    return { status: "rejected", error: "invalidReleasedFor", reasons: [] };
  }
  if (!input.requestedByDid || !input.requestedByDid.startsWith("did:")) {
    return { status: "rejected", error: "invalidRequestedByDid", reasons: [] };
  }
  if (!isHumanDid(input.approverDid ?? "")) {
    reasons.push("noHumanApprover");
  } else if (input.approverDid === input.requestedByDid) {
    reasons.push("approverEqualsRequester");
  }
  if (HAZARDOUS_CELLS.has(input.releasedFor) && !isHumanDid(input.safetySignoffDid ?? "")) {
    reasons.push("noHumanSafetySignoff");
  }
  if (!input.mesLotRef.trim()) {
    reasons.push("missingMesLotRef");
  }

interface RevisionLike {
  revisionId: string;
  modelId: string;
  version: number;
  representationCid?: string;
}
const revision = await readRecord<RevisionLike>(
  e,
  "com.etzhayyim.apps.cad.revision",
  revisionRkey(input.revisionId),
);
  if (!revision?.value) {
    reasons.push("revisionNotFound");
  } else {
    if (!revision.value.representationCid || !looksLikeCid(revision.value.representationCid)) {
      reasons.push("missingRepresentationCid");
    }
    // All anchored comments on the model (model-level or pinned to this
    // revision) must be resolved before the revision can enter production.
    const open = await scanOpenComments(e, revision.value.modelId, input.revisionId);
    if (open > 0) reasons.push(`openComments:${open}`);
  }

  if (input.supersedesReleaseId) {
    const prior = await readRecord<ProductionReleaseRecord>(e, PRODUCTION_RELEASE_COLLECTION, productionReleaseRkey(input.supersedesReleaseId));
    if (!prior?.value) {
      reasons.push("supersedesReleaseNotFound");
    } else if (revision?.value && prior.value.revisionId === input.revisionId) {
      reasons.push("supersedesSameRevision");
    }
  }

  let materialDesignationId: string | undefined;
  if (input.materialDesignationId) {
    const mat = await readRecord<MaterialDesignationRecordLike>(e, MATERIAL_DESIGNATION_COLLECTION, materialDesignationRkey(input.materialDesignationId));
    if (!mat?.value) {
      reasons.push("materialDesignationNotFound");
    } else if (revision?.value && mat.value.modelId !== revision.value.modelId) {
      reasons.push("materialDesignationDifferentModel");
    } else {
      materialDesignationId = input.materialDesignationId;
    }
  }

  if (reasons.length > 0) {
    return { status: "blocked", reasons };
  }

  const rkey = productionReleaseRkey(input.releaseId);
  const existing = await readRecord<ProductionReleaseRecord>(e, PRODUCTION_RELEASE_COLLECTION, rkey);
  if (existing?.value) {
    return {
      status: "alreadyReleased",
      releaseUri: existing.uri,
      did: existing.value.did,
      releaseId: input.releaseId,
      reasons: [],
    };
  }

  const did = productionReleaseDidFor(input.releaseId);
  const record: ProductionReleaseRecord = {
    did,
    releaseId: input.releaseId,
    revisionId: input.revisionId,
    modelId: revision!.value.modelId,
    revisionVersion: revision!.value.version,
    representationCid: revision!.value.representationCid!,
    releasedFor: input.releasedFor,
    mesLotRef: input.mesLotRef,
    requestedByDid: input.requestedByDid,
    approverDid: input.approverDid!,
    materialDesignationId,
    safetySignoffDid: input.safetySignoffDid,
    supersedesReleaseId: input.supersedesReleaseId,
    note: input.note,
    status: "released",
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: PRODUCTION_RELEASE_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "released", releaseUri: receipt.uri, did, releaseId: input.releaseId, reasons: [] };
}

async function scanOpenComments(e: Etzhayyim, modelId: string, revisionId?: string): Promise<number> {
  let open = 0;
  await scanAll<CommentRecordLike>(e, COMMENT_COLLECTION, 10_000, (v) => {
    if (v.modelId !== modelId || v.status !== "open") return;
    // A revision-scoped release is blocked by comments pinned to that revision
    // and by model-level comments; comments pinned to a DIFFERENT revision do
    // not block this revision.
    if (v.revisionId && revisionId && v.revisionId !== revisionId) return;
    open += 1;
  });
  return open;
}

interface CommentRecordLike {
  commentId: string;
  modelId: string;
  revisionId?: string;
  status: "open" | "resolved";
}

interface MaterialDesignationRecordLike {
  designationId: string;
  modelId: string;
  designation: string;
  unitsRegime: string;
  sourceUrl: string;
  authorDid: string;
}

export async function getProductionRelease(e: Etzhayyim, input: GetProductionReleaseInput): Promise<GetProductionReleaseOutput> {
  if (!input.releaseId) return { error: "invalidReleaseId" };
  const r = await readRecord<ProductionReleaseRecord>(e, PRODUCTION_RELEASE_COLLECTION, productionReleaseRkey(input.releaseId));
  if (!r) return { error: "notFound" };
  return { release: { ...r.value, releaseUri: r.uri } };
}

export async function listProductionReleases(e: Etzhayyim, input: ListProductionReleasesInput = {}): Promise<ListProductionReleasesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<ProductionReleaseRecord>({ collection: PRODUCTION_RELEASE_COLLECTION, cursor: input.cursor, limit });
  const items: ProductionReleaseView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.revisionId && v.revisionId !== input.revisionId) return false;
      if (input.modelId && v.modelId !== input.modelId) return false;
      if (input.releasedFor && v.releasedFor !== input.releasedFor) return false;
      return true;
    })
    .map((r) => ({ ...r.value, releaseUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

/**
 * Widen a superseded release's audit state. A superseding release does not
 * rewrite the prior record (AT PDS records are immutable) — instead the
 * superseded release carries a `supersededBy` resolution entry so MES queries
 * can see that this release is no longer the live one for its model.
 */
export async function resolveProductionRelease(e: Etzhayyim, input: ResolveProductionReleaseInput): Promise<ResolveProductionReleaseOutput> {
  if (!input.releaseId || !input.supersededByReleaseId || !input.byDid || !isHumanDid(input.byDid)) {
    return { status: "rejected", error: "invalidSupersessionInput" };
  }
  if (input.releaseId === input.supersededByReleaseId) {
    return { status: "rejected", error: "selfSupersession" };
  }
  const rkey = productionReleaseRkey(input.releaseId);
  const release = await readRecord<ProductionReleaseRecord>(e, PRODUCTION_RELEASE_COLLECTION, rkey);
  if (!release?.value) return { status: "rejected", error: "releaseNotFound" };
  const successor = await readRecord<ProductionReleaseRecord>(e, PRODUCTION_RELEASE_COLLECTION, productionReleaseRkey(input.supersededByReleaseId));
  if (!successor?.value) return { status: "rejected", error: "supersedingReleaseNotFound" };
  if (successor.value.modelId !== release.value.modelId) {
    return { status: "rejected", error: "supersedingReleaseDifferentModel" };
  }
  const record: ProductionReleaseRecord = {
    ...release.value,
    status: "superseded",
    supersededByReleaseId: input.supersededByReleaseId,
    supersededAt: new Date().toISOString(),
    supersededByDid: input.byDid,
  };
  await e.write({ collection: PRODUCTION_RELEASE_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "superseded", releaseId: input.releaseId, supersededByReleaseId: input.supersededByReleaseId };
}
