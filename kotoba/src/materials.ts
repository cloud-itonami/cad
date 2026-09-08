/**
 * cad kotoba — material & units designation (manufacturing material provenance).
 *
 * A design revision is authored for a recorded material designation and a
 * units regime. Here that binding is registered as an immutable AT PDS record
 * so the production-release gate and MES traceability can point at a
 * transportable, human-sourced material identifier when a revision enters a
 * manufacturing cell.
 *
 * It is a DECISION over recorded facts: it records the designation string and
 * a human-supplied source URL. It never invents a material constant (density,
 * yield, rating, certification, capacity, cycle time, price) — such values
 * stay unmeasured until a direct manufacturer / owner-operated dealer source
 * records them (system-scope rule 7).
 *
 * activity  : a human author designates the material + units regime for a model
 * decision  : FK -> model present | designation non-empty | units regime in the
 *             allowed set | source URL present and http(s) | author is a human
 *             (never a cad-controller-namespace bot/actor DID)
 * effect    : AT PDS material-designation record (audit artifact)
 * audit     : designation, units regime, source URL, author, model FK,
 *             timestamps — one immutable record per designation
 *
 * Hazard boundary: authorizes no equipment command, procurement, sale, payment,
 * or regulatory commitment. Safety interlocks live in the manufacturing cells
 * (see the itonami decision contracts); this gate only records material
 * provenance.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  MATERIAL_DESIGNATION_COLLECTION,
  MODEL_COLLECTION,
  UNITS_REGIMES,
  looksLikeHttpUrl,
  materialDesignationDidFor,
  materialDesignationRkey,
  modelRkey,
  type EtzhayyimRecord,
  type GetMaterialDesignationInput,
  type GetMaterialDesignationOutput,
  type ListMaterialDesignationsInput,
  type ListMaterialDesignationsOutput,
  type MaterialDesignationRecord,
  type MaterialDesignationView,
  type RegisterMaterialDesignationInput,
  type RegisterMaterialDesignationOutput,
} from "./types.js";

const PAGE_LIMIT = 100;

function isHumanDid(did: string): boolean {
  if (!did.startsWith("did:")) return false;
  // The cad controller DID namespace belongs to bots/actors of this app; a
  // material designation is a physical-recorded fact and cannot be issued by
  // them.
  return !did.startsWith("did:web:cad.etzhayyim.com");
}

async function readRecord<T>(e: Etzhayyim, collection: string, rkey: string): Promise<EtzhayyimRecord<T> | undefined> {
  const resp = await e.read<T>({ collection, rkey }).catch(() => ({ records: [] }));
  return resp.records[0];
}

export async function registerMaterialDesignation(
  e: Etzhayyim,
  input: RegisterMaterialDesignationInput,
): Promise<RegisterMaterialDesignationOutput> {
  if (!input.designationId || !input.modelId || !input.designation || !input.sourceUrl) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  if (!input.designation.trim()) return { status: "rejected", error: "emptyDesignation" };
  if (!UNITS_REGIMES.has(input.unitsRegime)) return { status: "rejected", error: "invalidUnitsRegime" };
  if (!input.sourceUrl || !looksLikeHttpUrl(input.sourceUrl)) {
    return { status: "rejected", error: "invalidSourceUrl" };
  }
  if (!input.authorDid || !isHumanDid(input.authorDid)) {
    return { status: "rejected", error: "invalidAuthorDid" };
  }
  const model = await readRecord(e, MODEL_COLLECTION, modelRkey(input.modelId));
  if (!model?.value) return { status: "modelNotFound", error: `modelNotFound:${input.modelId}` };

  const rkey = materialDesignationRkey(input.designationId);
  const existing = await readRecord<MaterialDesignationRecord>(e, MATERIAL_DESIGNATION_COLLECTION, rkey);
  if (existing?.value) {
    return {
      status: "alreadyExists",
      designationUri: existing.uri,
      did: existing.value.did,
      designationId: input.designationId,
    };
  }

  const did = materialDesignationDidFor(input.designationId);
  const record: MaterialDesignationRecord = {
    did,
    designationId: input.designationId,
    modelId: input.modelId,
    designation: input.designation,
    kind: input.kind,
    unitsRegime: input.unitsRegime,
    sourceUrl: input.sourceUrl,
    authorDid: input.authorDid,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({
    collection: MATERIAL_DESIGNATION_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "registered", designationUri: receipt.uri, did, designationId: input.designationId };
}

export async function getMaterialDesignation(e: Etzhayyim, input: GetMaterialDesignationInput): Promise<GetMaterialDesignationOutput> {
  if (!input.designationId) return { error: "invalidDesignationId" };
  const r = await readRecord<MaterialDesignationRecord>(e, MATERIAL_DESIGNATION_COLLECTION, materialDesignationRkey(input.designationId));
  if (!r) return { error: "notFound" };
  return { designation: { ...r.value, designationUri: r.uri } };
}

export async function listMaterialDesignations(e: Etzhayyim, input: ListMaterialDesignationsInput = {}): Promise<ListMaterialDesignationsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<MaterialDesignationRecord>({ collection: MATERIAL_DESIGNATION_COLLECTION, cursor: input.cursor, limit });
  const items: MaterialDesignationView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.modelId && v.modelId !== input.modelId) return false;
      if (input.kind && v.kind !== input.kind) return false;
      return true;
    })
    .map((r) => ({ ...r.value, designationUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}