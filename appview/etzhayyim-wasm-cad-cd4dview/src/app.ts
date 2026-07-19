import {
  asAgentTool,
  createKyselyDb,
  createWorkerExport,
  decodeJson,
  genID,
  nowISO,
  nsid,
  sql,
  withCapabilityTags,
  type HostSDK,
} from "@etzhayyim/kotodama-host-sdk";

const PRIMARY_DID = "did:web:cad.etzhayyim.com";
const IMPORTER_DID = "did:web:cad.etzhayyim.com:actor:importer";
const TESSELLATOR_DID = "did:web:cad.etzhayyim.com:actor:tessellator";
const REVIEWER_DID = "did:web:cad.etzhayyim.com:actor:reviewer";
const EXPORTER_DID = "did:web:cad.etzhayyim.com:actor:exporter";

let pathDidsReady = false;

async function ensurePathDids(sdk: HostSDK): Promise<void> {
  if (pathDidsReady) return;
  sdk.pds.dispatch({ type: "com.atproto.identity.create", payload: { path: "actor:importer",    displayName: "CAD Importer",    description: "STEP/IGES/BREP/STL/OBJ/glTF parser (CF Container)" } });
  sdk.pds.dispatch({ type: "com.atproto.identity.create", payload: { path: "actor:tessellator", displayName: "CAD Tessellator", description: "BREP → triangle mesh (LOD 3)" } });
  sdk.pds.dispatch({ type: "com.atproto.identity.create", payload: { path: "actor:reviewer",    displayName: "CAD Reviewer",    description: "Anchored comment / review thread" } });
  sdk.pds.dispatch({ type: "com.atproto.identity.create", payload: { path: "actor:exporter",    displayName: "CAD Exporter",    description: "STEP / IGES / glTF / STL / PDF / DXF export" } });
  pathDidsReady = true;
}

// ── com.etzhayyim.apps.cad.importCadFile ──
async function cmdImportCadFile(sdk: HostSDK, env: Record<string, unknown>, body: Uint8Array): Promise<string> {
  const input = decodeJson(body, {
    workspaceId: "",
    modelId: "",
    blobKey: "",
    format: "step",
    units: "millimetre",
    mergeDuplicates: true,
    tessellationTolerance: 0.1,
  });
  if (!input.workspaceId) return JSON.stringify({ error: "workspaceId required" });
  if (!input.blobKey) return JSON.stringify({ error: "blobKey required" });
  await ensurePathDids(sdk);

  const modelId = input.modelId || `model-${genID()}`;
  const revisionId = genID();
  const _importer = IMPORTER_DID;
  const _tessellator = TESSELLATOR_DID;

  // Enqueue heavy parse on the cad-job CF Container via service binding
  // (ADR 2604241500). Container fetches the CAD blob from B2 by `blobKey`.
  const cadJob = (env as { CAD_JOB?: { fetch: (req: Request) => Promise<Response> } }).CAD_JOB;
  if (!cadJob) {
    return JSON.stringify({
      modelId, revisionId, jobId: genID(), status: "queued",
      note: "CAD_JOB binding missing — Container deploy not yet wired",
    });
  }
  try {
    const req = new Request("https://cad-job.etzhayyim.com/jobs/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        modelId,
        revisionId,
        blobKey: input.blobKey,
        format: input.format,
        units: input.units,
        tessellationTolerance: input.tessellationTolerance,
      }),
    });
    const resp = await cadJob.fetch(req);
    const text = await resp.text();
    if (!resp.ok) {
      return JSON.stringify({ modelId, revisionId, jobId: genID(), status: "failed", error: `cad-job ${resp.status}: ${text}` });
    }
    const out = JSON.parse(text) as { jobId: string; status: string };
    return JSON.stringify({ modelId, revisionId, jobId: out.jobId, status: out.status });
  } catch (e) {
    return JSON.stringify({ modelId, revisionId, jobId: genID(), status: "failed", error: String(e) });
  }
}

// ── com.etzhayyim.apps.cad.getRevisionScene ──
async function qGetRevisionScene(_sdk: HostSDK, body: Uint8Array): Promise<string> {
  const input = decodeJson(body, {
    revisionId: "", representation: "shaded", lod: "medium", includeMeshBlobRefs: true,
  });
  if (!input.revisionId) return JSON.stringify({ error: "revisionId required" });
  // TODO: SELECT vertex_cad_revision + tessellation cache + parts tree.
  return JSON.stringify({
    revisionId: input.revisionId,
    units: "millimetre",
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    camera: { target: [0, 0, 0], distance: 0.5, yaw: 0.9, pitch: 0.45 },
    partsTree: { id: "root", children: [] },
    items: [],
    materials: [],
    selectionIds: [],
    note: "Phase 1 stub — viewer falls back to demo part",
  });
}

// ── com.etzhayyim.apps.cad.addAnchoredComment ──
async function cmdAddAnchoredComment(sdk: HostSDK, body: Uint8Array): Promise<string> {
  const input = decodeJson(body, {
    revisionId: "", partOccurrencePath: "",
    topologyRef: { kind: "face", topoId: "" },
    worldPosition: [0, 0, 0],
    cameraSnapshot: null,
    text: "", replyTo: "",
  });
  if (!input.revisionId) return JSON.stringify({ error: "revisionId required" });
  if (!input.text) return JSON.stringify({ error: "text required" });
  await ensurePathDids(sdk);
  const rkey = genID();
  const createdAt = nowISO();
  const _reviewer = REVIEWER_DID;
  // TODO: Hyperdrive INSERT vertex_cad_comment.
  return JSON.stringify({
    commentUri: `at://${PRIMARY_DID}/com.etzhayyim.apps.cad.comment/${rkey}`,
    rkey,
    createdAt,
  });
}

// ── com.etzhayyim.apps.cad.listComments ──
async function qListComments(_sdk: HostSDK, body: Uint8Array): Promise<string> {
  const input = decodeJson(body, {
    revisionId: "", partOccurrencePath: "", status: "open",
    offset: 0, limit: 50,
  });
  const offset = Math.max(0, Number(input.offset) || 0);
  const limit = Math.min(200, Math.max(1, Number(input.limit) || 50));
  if (!input.revisionId) return JSON.stringify({ error: "revisionId required" });
  return JSON.stringify({ items: [], total: 0, offset, limit, note: "Phase 1 stub" });
}

// ── com.etzhayyim.apps.cad.requestExport ──
async function cmdRequestExport(sdk: HostSDK, env: Record<string, unknown>, body: Uint8Array): Promise<string> {
  const input = decodeJson(body, {
    revisionId: "", target: "step", units: "millimetre",
    drawingTemplate: "", tessellationTolerance: 0.1,
  });
  if (!input.revisionId) return JSON.stringify({ error: "revisionId required" });
  await ensurePathDids(sdk);
  const _exporter = EXPORTER_DID;

  const cadJob = (env as { CAD_JOB?: { fetch: (req: Request) => Promise<Response> } }).CAD_JOB;
  if (!cadJob) {
    return JSON.stringify({ jobId: genID(), status: "queued", estimatedSeconds: 30, note: "CAD_JOB binding missing" });
  }
  try {
    const req = new Request("https://cad-job.etzhayyim.com/jobs/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const resp = await cadJob.fetch(req);
    const text = await resp.text();
    if (!resp.ok) return JSON.stringify({ jobId: genID(), status: "failed", error: `cad-job ${resp.status}: ${text}` });
    return text;
  } catch (e) {
    return JSON.stringify({ jobId: genID(), status: "failed", error: String(e) });
  }
}

async function cmdHealth(): Promise<string> {
  return JSON.stringify({ ok: true, app: "cad", ts: nowISO() });
}

export default createWorkerExport((sdk) => {
  const env = (sdk as unknown as { env?: Record<string, unknown> }).env ?? {};
  sdk.app.command(
    nsid("com.etzhayyim.apps.cad.importCadFile"),
    async (_ctx: unknown, body: Uint8Array) => cmdImportCadFile(sdk, env, body),
    asAgentTool("Import a CAD file (STEP/IGES/BREP/STL/OBJ/glTF) into a workspace; returns a job id."),
    withCapabilityTags("write", "cad", "import"),
  );
  sdk.app.query(
    nsid("com.etzhayyim.apps.cad.getRevisionScene"),
    async (_ctx: unknown, body: Uint8Array) => qGetRevisionScene(sdk, body),
    asAgentTool("Return a scene-graph projection of a CAD revision for WebGPU rendering."),
    withCapabilityTags("read", "cad", "scene"),
  );
  sdk.app.command(
    nsid("com.etzhayyim.apps.cad.addAnchoredComment"),
    async (_ctx: unknown, body: Uint8Array) => cmdAddAnchoredComment(sdk, body),
    asAgentTool("Add an anchored review comment to a face/edge/vertex on a CAD revision."),
    withCapabilityTags("write", "cad", "comment"),
  );
  sdk.app.query(
    nsid("com.etzhayyim.apps.cad.listComments"),
    async (_ctx: unknown, body: Uint8Array) => qListComments(sdk, body),
    asAgentTool("List anchored comments on a CAD revision."),
    withCapabilityTags("read", "cad", "comments"),
  );
  sdk.app.command(
    nsid("com.etzhayyim.apps.cad.requestExport"),
    async (_ctx: unknown, body: Uint8Array) => cmdRequestExport(sdk, env, body),
    asAgentTool("Enqueue a STEP/IGES/glTF/STL/PDF/DXF/OBJ export job."),
    withCapabilityTags("write", "cad", "export"),
  );
  sdk.app.command(nsid("com.etzhayyim.apps.cad.health"), async () => cmdHealth());

  // ── Internal callback: cad-job container → Worker ───────────────────
  // Mirrors bim/_internal/jobs/complete. Container POSTs catalog +
  // bbox; we Hyperdrive-INSERT vertex_cad_feature rows + flip
  // vertex_cad_revision.status. HMAC-auth via INTERNAL_JOB_SECRET.
  const router = (sdk as unknown as { router: any }).router;
  if (router?.post) {
    router.post("/_internal/jobs/complete", async (c: any) => {
      const secret = (c.env?.INTERNAL_JOB_SECRET as string | undefined) ?? "";
      if (!secret) return new Response("INTERNAL_JOB_SECRET missing", { status: 500 });
      const sig = c.req.header("x-internal-auth") ?? "";
      const raw = await c.req.text();
      const expected = await hmacHex(secret, raw);
      if (!constantTimeEq(sig, expected)) {
        return new Response("auth", { status: 401 });
      }
      try {
        const body = JSON.parse(raw) as CadJobCompleteBody;
        return await ingestCadCatalog(c.env ?? {}, body);
      } catch (e) {
        return new Response(`bad request: ${String(e)}`, { status: 400 });
      }
    });
  }
});

interface CadJobCompleteBody {
  jobId: string;
  workspaceId?: string;
  modelId: string;
  revisionId: string;
  ok: boolean;
  catalog?: {
    parser?: string;
    format?: string;
    partCount?: number;
    totals?: { vertices?: number; faces?: number };
    boundsMin?: number[];
    boundsMax?: number[];
    parts?: Array<{
      name?: string;
      vertices?: number;
      faces?: number;
      areaM2?: number;
      volumeM3?: number;
    }>;
    meshBlobKey?: string;
  };
  error?: string;
}

async function ingestCadCatalog(env: Record<string, unknown>, body: CadJobCompleteBody): Promise<Response> {
  const hd = (env as { HYPERDRIVE?: unknown }).HYPERDRIVE;
  if (!hd) return new Response("HYPERDRIVE binding missing", { status: 500 });
  const db = createKyselyDb(hd as any);
  const now = nowISO();
  const owner = body.modelId; // CAD models live under their workspace controller; revision owner = model

  // Update revision: status + bbox + optional tessellation cache key.
  try {
    const cat = body.catalog;
    const min = cat?.boundsMin ?? [0, 0, 0];
    const max = cat?.boundsMax ?? [0, 0, 0];
    await sql`
      UPDATE vertex_cad_revision
      SET status = ${body.ok ? "ready" : "failed"},
          message = ${body.error ?? null},
          bbox_min_x = ${min[0] ?? 0}, bbox_min_y = ${min[1] ?? 0}, bbox_min_z = ${min[2] ?? 0},
          bbox_max_x = ${max[0] ?? 0}, bbox_max_y = ${max[1] ?? 0}, bbox_max_z = ${max[2] ?? 0},
          tessellation_key = COALESCE(${cat?.meshBlobKey ?? null}, tessellation_key)
      WHERE vertex_id = ${body.revisionId}
    `.execute(db);
  } catch (e) {
    console.warn("[cad/_internal] revision update:", String(e));
  }

  if (!body.ok || !body.catalog) {
    return new Response(JSON.stringify({ ok: true, applied: 0 }), {
      headers: { "content-type": "application/json" },
    });
  }

  // Insert one feature row per parsed part (Phase 2-pre = trimesh part list).
  let inserted = 0;
  let idx = 0;
  for (const part of body.catalog.parts ?? []) {
    const featureId = `at://${owner}/com.etzhayyim.apps.cad.feature/${genID()}`;
    try {
      await sql`
        INSERT INTO vertex_cad_feature (
          vertex_id, owner_did, repo, revision_id, feature_type,
          feature_index, params_json, created_at
        )
        SELECT ${featureId}, ${owner}, ${owner}, ${body.revisionId},
          ${"importedPart"}, ${idx},
          ${JSON.stringify({ name: part.name ?? "", vertices: part.vertices ?? 0, faces: part.faces ?? 0, areaM2: part.areaM2 ?? 0, volumeM3: part.volumeM3 ?? 0 })},
          ${now}
        WHERE NOT EXISTS (
          SELECT 1 FROM vertex_cad_feature WHERE vertex_id = ${featureId}
        )
      `.execute(db);
      inserted++;
    } catch (e) {
      console.warn("[cad/_internal] feature insert:", String(e));
    }
    idx++;
  }

  return new Response(JSON.stringify({ ok: true, inserted }), {
    headers: { "content-type": "application/json" },
  });
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const view = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < view.length; i++) hex += view[i].toString(16).padStart(2, "0");
  return hex;
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
