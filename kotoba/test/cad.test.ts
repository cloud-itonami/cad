import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
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
} from "../src/index.js";

const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const OWNER = "did:web:engineer.example.com";

describe("cad kotoba", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:cad.etzhayyim.com" });
  });

  describe("model", () => {
    it("creates, reads, lists by workspace/format + app-layer search; validates", async () => {
      expect((await createModel(e, { modelId: "M-1", name: "Bracket", format: "STEP", workspaceId: "WS-1", ownerDid: OWNER })).status).toBe("created");
      expect((await getModel(e, { modelId: "M-1" })).model?.format).toBe("STEP");
      expect((await createModel(e, { modelId: "M-1", name: "dup", format: "STL" })).status).toBe("alreadyExists");
      expect((await createModel(e, { modelId: "M-X", name: "x", format: "PRT" as any })).status).toBe("rejected");
      expect((await listModels(e, { workspaceId: "WS-1" })).total).toBe(1);
      expect((await listModels(e, { q: "brack" })).total).toBe(1);
      expect((await listModels(e, { format: "STEP" })).total).toBe(1);
    });
  });

  describe("revisions + comments against a model", () => {
    beforeEach(async () => {
      await createModel(e, { modelId: "M-1", name: "Bracket", format: "STEP" });
    });
    it("adds revisions (FK→model + CID), rejects bad version/cid/missing model", async () => {
      expect((await addRevision(e, { revisionId: "R-1", modelId: "M-1", version: 1, representationCid: CID })).status).toBe("added");
      expect((await getRevision(e, { revisionId: "R-1" })).revision?.version).toBe(1);
      expect((await addRevision(e, { revisionId: "R-X", modelId: "M-1", version: 0 })).status).toBe("rejected");
      expect((await addRevision(e, { revisionId: "R-X", modelId: "M-1", version: 1, representationCid: "nope" })).status).toBe("rejected");
      expect((await addRevision(e, { revisionId: "R-X", modelId: "GHOST", version: 1 })).status).toBe("modelNotFound");
      await addRevision(e, { revisionId: "R-2", modelId: "M-1", version: 2 });
      expect((await listRevisions(e, { modelId: "M-1" })).total).toBe(2);
    });
    it("adds + resolves anchored comments (FK→model), filters", async () => {
      expect((await addComment(e, { commentId: "C-1", modelId: "M-1", body: "fillet radius too small", anchorRef: "edge#42", authorDid: OWNER })).status).toBe("added");
      expect((await addComment(e, { commentId: "C-X", modelId: "GHOST", body: "x" })).status).toBe("modelNotFound");
      expect((await listComments(e, { modelId: "M-1", status: "open" })).total).toBe(1);
      expect((await resolveComment(e, { commentId: "C-1" })).status).toBe("resolved");
      expect((await resolveComment(e, { commentId: "C-1" })).status).toBe("rejected");
      expect((await listComments(e, { status: "resolved" })).total).toBe(1);
    });
    it("coverage rolls up the three collections", async () => {
      await addRevision(e, { revisionId: "R-1", modelId: "M-1", version: 1 });
      await addComment(e, { commentId: "C-1", modelId: "M-1", body: "note" });
      const cov = await coverage(e);
      expect(cov.modelCount).toBe(1);
      expect(cov.revisionCount).toBe(1);
      expect(cov.commentCount).toBe(1);
      expect(cov.modelsByFormat?.STEP).toBe(1);
      expect(cov.openComments).toBe(1);
    });
  });
});
