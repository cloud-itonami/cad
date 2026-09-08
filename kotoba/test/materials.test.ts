import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  createModel,
  addRevision,
  registerMaterialDesignation,
  getMaterialDesignation,
  listMaterialDesignations,
  requestProductionRelease,
  getProductionRelease,
} from "../src/index.js";

const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const DESIGNER = "did:web:designer.example.com";
const HUMAN = "did:web:supervisor.example.com";
const SAFETY = "did:web:safety-officer.example.com";
const BOT = "did:web:cad.etzhayyim.com:design-bot";

const base = {
  designationId: "MAT-AZ91D-1",
  modelId: "M-CARTRIDGE",
  designation: "AZ91D (registered alloy designation)",
  kind: "alloy-designation" as const,
  unitsRegime: "metric-si" as const,
  sourceUrl: "https://alloys.example.com/az91d",
  authorDid: HUMAN,
};

async function seedModel(e: any) {
  await createModel(e, { modelId: "M-CARTRIDGE", name: "Cartridge shell", format: "STEP" });
}

describe("material & units designation registry", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:cad.etzhayyim.com" });
  });

  it("registers a designation and writes the immutable audit record", async () => {
    await seedModel(e);
    const out = await registerMaterialDesignation(e, base);
    expect(out.status).toBe("registered");
    const got = await getMaterialDesignation(e, { designationId: "MAT-AZ91D-1" });
    expect(got.designation?.modelId).toBe("M-CARTRIDGE");
    expect(got.designation?.designation).toBe("AZ91D (registered alloy designation)");
    expect(got.designation?.authorDid).toBe(HUMAN);
    expect(got.designation?.unitsRegime).toBe("metric-si");
    const list = await listMaterialDesignations(e, { modelId: "M-CARTRIDGE" });
    expect(list.total).toBe(1);
  });

  it("requires a human author — bot/controller DIDs are refused", async () => {
    await seedModel(e);
    const out = await registerMaterialDesignation(e, { ...base, authorDid: BOT });
    expect(out.status).toBe("rejected");
    expect(out.error).toBe("invalidAuthorDid");
    expect((await getMaterialDesignation(e, { designationId: "MAT-AZ91D-1" })).error).toBe("notFound");
  });

  it("validates FK -> model, units regime, source URL, designation, and duplicates", async () => {
    expect((await registerMaterialDesignation(e, { ...base, modelId: "GHOST" })).status).toBe("modelNotFound");
    expect((await registerMaterialDesignation(e, { ...base, unitsRegime: "furlong" as any })).status).toBe("rejected");
    expect((await registerMaterialDesignation(e, { ...base, sourceUrl: "not-a-url" })).error).toBe("invalidSourceUrl");
    expect((await registerMaterialDesignation(e, { ...base, designation: "  " })).error).toBe("emptyDesignation");
    await seedModel(e);
    expect((await registerMaterialDesignation(e, base)).status).toBe("registered");
    expect((await registerMaterialDesignation(e, base)).status).toBe("alreadyExists");
  });

  it("does not invent material constants (only records designation + source + units)", async () => {
    await seedModel(e);
    await registerMaterialDesignation(e, base);
    const got = await getMaterialDesignation(e, { designationId: "MAT-AZ91D-1" });
    // The record carries the human-supplied designation string, source URL, and
    // units regime only — no density, yield, capacity, price, or certification.
    expect(got.designation?.designation).toBe(base.designation);
    expect(got.designation?.sourceUrl).toBe(base.sourceUrl);
    expect(got.designation?.unitsRegime).toBe("metric-si");
  });
});

describe("production release gate carries material provenance", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:cad.etzhayyim.com" });
  });

  const rel = {
    releaseId: "PR-M1",
    revisionId: "R-M1",
    releasedFor: "cartridge-integration" as const,
    mesLotRef: "LOT-1",
    requestedByDid: DESIGNER,
    approverDid: HUMAN,
    safetySignoffDid: SAFETY,
  };

  it("binds a release to a registered material designation for the same model", async () => {
    await seedModel(e);
    await addRevision(e, { revisionId: "R-M1", modelId: "M-CARTRIDGE", version: 1, representationCid: CID });
    await registerMaterialDesignation(e, base);
    const out = await requestProductionRelease(e, { ...rel, materialDesignationId: "MAT-AZ91D-1" });
    expect(out.status).toBe("released");
    const got = await getProductionRelease(e, { releaseId: "PR-M1" });
    expect(got.release?.materialDesignationId).toBe("MAT-AZ91D-1");
  });

  it("blocks a release whose material designation is for a different model", async () => {
    await seedModel(e);
    await createModel(e, { modelId: "M-OTHER", name: "Other shell", format: "STEP" });
    await addRevision(e, { revisionId: "R-M1", modelId: "M-CARTRIDGE", version: 1, representationCid: CID });
    await registerMaterialDesignation(e, { ...base, designationId: "MAT-OTHER-1", modelId: "M-OTHER" });
    const out = await requestProductionRelease(e, { ...rel, materialDesignationId: "MAT-OTHER-1" });
    expect(out.status).toBe("blocked");
    expect(out.reasons).toContain("materialDesignationDifferentModel");
  });

  it("blocks a release referencing a missing material designation", async () => {
    await seedModel(e);
    await addRevision(e, { revisionId: "R-M1", modelId: "M-CARTRIDGE", version: 1, representationCid: CID });
    const out = await requestProductionRelease(e, { ...rel, materialDesignationId: "GHOST-DESIGNATION" });
    expect(out.status).toBe("blocked");
    expect(out.reasons).toContain("materialDesignationNotFound");
  });
});