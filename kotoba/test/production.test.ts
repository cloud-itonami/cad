import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  createModel,
  addRevision,
  addComment,
  resolveComment,
  requestProductionRelease,
  getProductionRelease,
  listProductionReleases,
  resolveProductionRelease,
} from "../src/index.js";

const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const ENGINEER = "did:web:engineer.example.com";
const HUMAN = "did:web:supervisor.example.com";
const SAFETY = "did:web:safety-officer.example.com";
const BOT = "did:web:cad.etzhayyim.com:design-bot";

async function seedRevision(e: any, revisionId = "R-1", modelId = "M-1") {
  await createModel(e, { modelId, name: "Cartridge shell", format: "STEP" });
  await addRevision(e, { revisionId, modelId, version: 1, representationCid: CID });
}

const base = {
  releaseId: "PR-1",
  revisionId: "R-1",
  releasedFor: "cartridge-integration" as const,
  mesLotRef: "LOT-2026-0903-001",
  requestedByDid: ENGINEER,
  approverDid: HUMAN,
  safetySignoffDid: SAFETY,
};

describe("production release gate", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:cad.etzhayyim.com" });
  });

  it("releases a clean revision and writes one immutable audit record", async () => {
    await seedRevision(e);
    const out = await requestProductionRelease(e, base);
    expect(out.status).toBe("released");
    expect(out.reasons).toEqual([]);
    const got = await getProductionRelease(e, { releaseId: "PR-1" });
    expect(got.release?.modelId).toBe("M-1");
    expect(got.release?.revisionVersion).toBe(1);
    expect(got.release?.approverDid).toBe(HUMAN);
    expect(got.release?.mesLotRef).toBe("LOT-2026-0903-001");
    const list = await listProductionReleases(e, { releasedFor: "cartridge-integration" });
    expect(list.total).toBe(1);
  });

  it("blocks without a human approver — bot/controller DIDs cannot release", async () => {
    await seedRevision(e);
    const botApproved = await requestProductionRelease(e, { ...base, approverDid: BOT });
    expect(botApproved.status).toBe("blocked");
    expect(botApproved.reasons).toContain("noHumanApprover");
    const missing = await requestProductionRelease(e, { ...base, releaseId: "PR-2", approverDid: "" });
    expect(missing.reasons).toContain("noHumanApprover");
    // Nothing was written
    expect((await getProductionRelease(e, { releaseId: "PR-1" })).error).toBe("notFound");
  });

  it("blocks approver === requester (no self-approval)", async () => {
    await seedRevision(e);
    const out = await requestProductionRelease(e, { ...base, approverDid: ENGINEER });
    expect(out.status).toBe("blocked");
    expect(out.reasons).toContain("approverEqualsRequester");
  });

  it("requires human safety sign-off for hazardous cells only", async () => {
    await seedRevision(e);
    const hazardousNoSafety = await requestProductionRelease(e, { ...base, safetySignoffDid: undefined });
    expect(hazardousNoSafety.status).toBe("blocked");
    expect(hazardousNoSafety.reasons).toContain("noHumanSafetySignoff");
    const hazardousBotSafety = await requestProductionRelease(e, { ...base, releaseId: "PR-3", safetySignoffDid: BOT });
    expect(hazardousBotSafety.reasons).toContain("noHumanSafetySignoff");
    const benignOk = await requestProductionRelease(e, {
      ...base, releaseId: "PR-4", releasedFor: "electronics-smt-and-test", safetySignoffDid: undefined,
    });
    expect(benignOk.status).toBe("released");
  });

  it("blocks while anchored comments are open; clears once resolved", async () => {
    await seedRevision(e);
    await addComment(e, { commentId: "C-1", modelId: "M-1", revisionId: "R-1", body: "wall thickness flag" });
    const blocked = await requestProductionRelease(e, base);
    expect(blocked.status).toBe("blocked");
    expect(blocked.reasons?.[0]).toMatch(/openComments/);
    await resolveComment(e, { commentId: "C-1" });
    const cleared = await requestProductionRelease(e, { ...base, releaseId: "PR-5" });
    expect(cleared.status).toBe("released");
  });

  it("does not let comments on another revision block this revision", async () => {
    await seedRevision(e);
    await addRevision(e, { revisionId: "R-2", modelId: "M-1", version: 2, representationCid: CID });
    await addComment(e, { commentId: "C-2", modelId: "M-1", revisionId: "R-2", body: "about R-2" });
    const out = await requestProductionRelease(e, base);
    expect(out.status).toBe("released");
  });

  it("requires a representation CID on the revision", async () => {
    await createModel(e, { modelId: "M-1", name: "shell", format: "STEP" });
    await addRevision(e, { revisionId: "R-nogeom", modelId: "M-1", version: 1 });
    const out = await requestProductionRelease(e, { ...base, revisionId: "R-nogeom" });
    expect(out.status).toBe("blocked");
    expect(out.reasons).toContain("missingRepresentationCid");
  });

  it("validates MES lot ref, cell, revision FK, and duplicate ids", async () => {
    await seedRevision(e);
    expect((await requestProductionRelease(e, { ...base, mesLotRef: "   " })).reasons).toContain("missingMesLotRef");
    expect((await requestProductionRelease(e, { ...base, releaseId: "PR-6", releasedFor: "not-a-cell" as any })).status).toBe("rejected");
    expect((await requestProductionRelease(e, { ...base, releaseId: "PR-7", revisionId: "GHOST" })).reasons).toContain("revisionNotFound");
    expect((await requestProductionRelease(e, base)).status).toBe("released");
    const dup = await requestProductionRelease(e, base);
    expect(dup.status).toBe("alreadyReleased");
  });

  it("supersession: validates prior release, refuses self-same-revision, marks superseded", async () => {
    await seedRevision(e);
    await requestProductionRelease(e, base);
    await addRevision(e, { revisionId: "R-2", modelId: "M-1", version: 2, representationCid: CID });
    const badPrior = await requestProductionRelease(e, {
      ...base, releaseId: "PR-8", revisionId: "R-2", supersedesReleaseId: "GHOST-RELEASE",
    });
    expect(badPrior.reasons).toContain("supersedesReleaseNotFound");
    const sameRev = await requestProductionRelease(e, {
      ...base, releaseId: "PR-9", revisionId: "R-1", supersedesReleaseId: "PR-1",
    });
    expect(sameRev.reasons).toContain("supersedesSameRevision");
    const good = await requestProductionRelease(e, {
      ...base, releaseId: "PR-10", revisionId: "R-2", supersedesReleaseId: "PR-1",
    });
    expect(good.status).toBe("released");
    const resolved = await resolveProductionRelease(e, { releaseId: "PR-1", supersededByReleaseId: "PR-10", byDid: HUMAN });
    expect(resolved.status).toBe("superseded");
    const old = await getProductionRelease(e, { releaseId: "PR-1" });
    expect(old.release?.status).toBe("superseded");
    expect(old.release?.supersededByReleaseId).toBe("PR-10");
    // Non-human cannot mark supersession; mismatched model refused
    expect((await resolveProductionRelease(e, { releaseId: "PR-1", supersededByReleaseId: "PR-10", byDid: BOT })).status).toBe("rejected");
    expect((await resolveProductionRelease(e, { releaseId: "PR-1", supersededByReleaseId: "PR-1", byDid: HUMAN })).status).toBe("rejected");
  });
});
