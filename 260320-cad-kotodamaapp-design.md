# 260320 CAD App Design

Date: 2026-03-20

## Goal

`etzhayyim-project-cad` は、ブラウザ上で CAD 資産を

- 読む
- 版管理する
- コメント/レビューする
- 共同編集する
- ジョブとして変換/検証/出図する

ための App として設計する。

この app は単なる 3D viewer ではなく、`model revision` を中心に
会話、承認、派生物、アクセス制御を一つの app 境界に閉じ込める。

## Product Scope

対象ユースケースは次の 4 系統に限定する。

- 機械系 3D CAD の閲覧と lightweight 編集
- 図面レビューと issue/comment 解決
- 版管理された設計データの共有
- 変換/解析/export の非同期実行

初期フェーズでは次を scope 外とする。

- フル機能 MCAD ネイティブ互換
- EDA/PCB CAD
- BIM authoring 全機能
- CAM toolpath 生成
- 法的拘束力を持つ署名ワークフロー

## Why This App Boundary

CAD をオンラインで扱うとき、実際に必要なのは geometry kernel 単体ではなく
次の組み合わせである。

- 重い CAD ファイルの blob 管理
- revision と branch 的な lineage
- 人/agent のレビュー会話
- geometry 処理の非同期 job
- query 最適化された projection

これらを別 service に分割すると、revision 整合性と監査が崩れやすい。
そのため `cad` は単一 app 境界の中で `command -> job -> projection -> query`
を閉じる。

## Runtime Choice

この app は **Container mode** を標準にする。

理由:

- STEP/IGES/BREP import は TinyGo-first path には重い
- tessellation, boolean, section, drawing export は native library 依存が強い
- 大きい assembly の background job が必要
- 将来的に OpenCascade 系 kernel を載せる余地を残したい

UI は `fullapp` の Svelte main、backend は Container の XRPC + W Protocol façade
で構成する。

## Frontend Standard

3D viewer / review UI の標準は **Threlte** とする。

理由:

- Svelte `fullapp` と自然に統合できる
- CAD viewer に必要な camera, selection, raycast, overlay を three.js 系で細かく制御できる
- anchored comment, compare, section, explode のような CAD 特有 UI を作りやすい
- AppShell v2 の panel/drawer と組み合わせやすい

## Threlte Integration Boundary

Threlte 側の責務:

- `GetRevisionScene` の scene projection を読み込んで描画する
- part selection / hover / isolate / visibility toggle
- camera orbit / pan / fit-to-selection
- anchored comment marker の表示
- compare overlay, explode slider, section plane UI

backend 側の責務:

- STEP/IGES/BREP import
- tessellation / scene graph 生成
- topology id 安定化
- comment anchor 再投影
- export / rebuild / validation job

重要なのは、Threlte は renderer であり geometry kernel ではないこと。
viewer は原本 CAD blob を直接解釈せず、backend が生成した scene projection を使う。

## Architecture Mental Model

`CadApp = 1 fullapp + 1 command/query boundary + 1 W Protocol collaboration space`

- command は `CadCommandService` に入り、内部で W Protocol command event に正規化する
- query は `CadQueryService` から projection を読む
- 人/agent の会話主体は user/entity identity であり、app bot は delivery/provisioning を担う
- heavy binary は blob layer、メタデータと関係は Cypher graph に置く

## Topology

単一 project 内で 5 論理 component を持つ。

| Component | Role | Public surface |
|---|---|---|
| `cad-ui` | fullapp UI, Widget bootstrap, viewer/editor shell | `/` |
| `cad-gateway` | authn/authz, XRPC, W Protocol command normalization | `/xrpc/...` |
| `cad-model` | revision write model, metadata projection update | internal only |
| `cad-job` | import/convert/tessellate/export/validate workers | internal only |
| `cad-realtime` | presence, cursor, selection, review session fan-out | internal only |

## Core User Journeys

### 1. Viewer

1. user が room から CAD app を開く
2. UI が `GetWorkspace`, `GetModel`, `GetRevisionScene` を query
3. Threlte viewer は precomputed glTF/mesh と lightweight topology summary を読む
4. detail 必要時のみ face/edge/property query を追加取得する

### 2. Review

1. reviewer が revision を開く
2. section, measure, explode, isolate など viewer 操作を行う
3. comment を 3D anchor 付きで作成する
4. command は review thread と model revision に紐づく
5. unresolved issue 数が projection に反映される

### 3. Edit

1. editor が branch revision を作る
2. feature edit は parametric operation として command に積む
3. backend が geometry rebuild job を起動する
4. success 時に新 revision を current candidate に昇格する

### 4. Export

1. user が `STEP`, `STL`, `glTF`, `PDF drawing` の export を要求する
2. export job が非同期に走る
3. 生成物は blob layer に置く
4. timeline と query に job result が反映される

## Domain Model

設計の中心は `workspace -> model -> revision -> representation` とする。

### Core nodes

| Node | Purpose |
|---|---|
| `CadWorkspace` | org-scoped CAD working space |
| `CadModel` | product or part/assembly identity |
| `CadRevision` | immutable design revision |
| `CadBranch` | editable working line |
| `CadRepresentation` | STEP/glTF/STL/2D drawing などの派生表現 |
| `CadReviewThread` | review session / discussion thread |
| `CadComment` | 3D/2D anchor を持つ comment |
| `CadJob` | import/export/rebuild/validation 実行 |
| `CadConstraint` | parametric constraint summary |
| `CadBomItem` | assembly/BOM projection row |

### Core edges

| Edge | Meaning |
|---|---|
| `(:CadWorkspace)-[:OWNS]->(:CadModel)` | workspace ownership |
| `(:CadModel)-[:HAS_REVISION]->(:CadRevision)` | revision lineage |
| `(:CadBranch)-[:HEAD]->(:CadRevision)` | branch head |
| `(:CadRevision)-[:DERIVES]->(:CadRevision)` | parent/merge lineage |
| `(:CadRevision)-[:HAS_REPRESENTATION]->(:CadRepresentation)` | binary/derived artifact |
| `(:CadReviewThread)-[:REVIEWS]->(:CadRevision)` | review target |
| `(:CadComment)-[:ANCHORS]->(:CadRevision)` | anchored annotation |
| `(:CadJob)-[:TARGETS]->(:CadRevision)` | job target |

## Storage Policy

### Blob layer

binary payload は blob layer に置く。

- original CAD file: `step`, `stp`, `iges`, `igs`, `brep`, `fcstd`, `sldprt`, `sldasm`
- derived scene: `gltf`, `glb`
- manufacturing/export: `stl`, `obj`, `pdf`, `svg`, `dxf`
- preview: png/jpg thumbnail

blob metadata の標準:

- `blob_key`
- `media_type`
- `byte_size`
- `sha256`
- `source_revision_id`
- `representation_kind`
- `created_by`
- `created_at`

### Graph / projection

Cypher graph に置くもの:

- workspace/model/revision/representation/comment/job metadata
- access policy
- lineage
- assembly/BOM summary
- comment anchors
- review status

projection-first の read model を別に持つ。

| Projection | Purpose |
|---|---|
| `cad_models_current` | model list / card view |
| `cad_revisions_current` | revision metadata / status |
| `cad_representations_current` | artifact lookup |
| `cad_review_threads_current` | review queue |
| `cad_comments_current` | unresolved comment list |
| `cad_jobs_current` | async job state |
| `cad_bom_current` | assembly/BOM query |
| `cad_scene_nodes_current` | viewer tree / visibility panel |

`cad_scene_nodes_current` は Threlte viewer が初回描画で必要とする scene tree の
軽量 projection とする。

## Command / Query Split

新規 App の方針に従い、public contract は `CommandService` と `QueryService` を分離する。

### CommandService

`CadCommandService` は mutation 専用。

- `CreateWorkspace`
- `CreateModel`
- `ImportCadFile`
- `CreateBranch`
- `CommitParametricEdit`
- `RequestRebuild`
- `CreateReviewThread`
- `AddAnchoredComment`
- `ResolveComment`
- `RequestExport`
- `ApproveRevision`
- `PublishRevision`

command 共通 fields:

- `command_id`
- `org_id`
- `workspace_id`
- `model_id`
- `revision_id`
- `actor_id`
- `idempotency_key`
- `access_context`
- `payload`

内部では `CadCommandEnvelope` として W Protocol event に正規化する。

### QueryService

`CadQueryService` は read-only projection に限定する。

- `GetWorkspace`
- `ListModels`
- `GetModel`
- `ListRevisions`
- `GetRevision`
- `GetRevisionScene`
- `GetRevisionTopology`
- `ListReviewThreads`
- `ListComments`
- `ListJobs`
- `GetBom`
- `GetExportArtifacts`
- `GetPresenceSnapshot`

### `GetRevisionScene` response contract

`GetRevisionScene` は Threlte viewer の primary input とする。

最低限返すべき内容:

- `revision_id`
- `scene_representation` (`glb` or `gltf` blob ref)
- `unit_system`
- `world_bounds`
- `default_camera`
- `parts[]` (`part_id`, `occurrence_path`, `label`, `parent_part_id`, `visible`)
- `selectables[]` (`topology_ref`, `part_id`, `kind`)
- `materials[]`
- `anchors[]` (comment marker 初期描画用)
- `display_state` (`isolation`, `explode`, `section`)

これにより UI は原本 CAD を解釈せず、Threlte scene と panel state に集中できる。

## Realtime Collaboration

CAD で必要な realtime は document co-edit よりも、まず review/presence の価値が高い。
そのため phase 1 は次を first-class にする。

- active viewer presence
- camera position broadcast
- current selection broadcast
- pointer/cursor hint
- review session state

phase 2 で optimistic collaborative edit を追加する。

### Collaboration policy

- authoritative state は revision/job projection
- realtime state は ephemeral channel state
- co-edit conflict は CRDT ではなく `branch + operation log + rebuild` を基本とする
- merge は geometry-aware auto-merge ではなく、まず feature sequence replay ベースで行う

## Geometry Strategy

geometry kernel は app 内部の implementation detail とし、public API には漏らさない。

phase ごとの扱い:

- Phase 1: import + tessellated viewer + anchored review
- Phase 2: parametric edits の一部追加
- Phase 3: assembly constraint edit, section/drawing generation 強化

public contract では `BRep` そのものではなく、次を返す。

- revision metadata
- scene graph
- tessellated mesh reference
- topology summary
- selectable face/edge/part ids
- measurements and properties

これにより UI と kernel 実装を疎結合に保つ。

## 3D Anchor Model

comment の anchor は geometry 再計算に耐える必要がある。単純な world coordinate 固定では弱い。
そのため anchor は複合キーで持つ。

- `part_occurrence_path`
- `topology_ref` (`face_id`, `edge_id`, `vertex_id` のいずれか)
- `local_uv_or_t`
- `world_position`
- `camera_snapshot`
- `revision_id`

rebuild 後は `topology_ref` を優先し、fallback で近傍座標へ再投影する。

## Security / Tenancy

- tenant canonical ID は Clerk `org_id`
- workspace/model/revision は org-scoped
- public share は `representation` 単位で限定発行し、workspace 全体公開はしない
- binary access は signed indirection または app proxy 経由
- export artifact には classification/policy を継承する

主要 capability 例:

- `cad:model:read`
- `cad:model:edit`
- `cad:review:comment`
- `cad:review:approve`
- `cad:export:create`
- `cad:workspace:admin`

## Proto Plan

追加 proto:

`proto/etzhayyim/cad/v1/cad.proto`

最低限の service:

- `CadCommandService`
- `CadQueryService`

主要 message:

- `CadWorkspace`
- `CadModel`
- `CadRevision`
- `CadRepresentation`
- `CadScene`
- `CadComment`
- `CadJob`
- `CadBomItem`

## WIT / Internal Interface Plan

CAD app は container fallback を使うが、内部境界は将来の component 化を見据えて分ける。

候補 interface:

- `cad-import`
- `cad-geometry`
- `cad-review`
- `cad-export`
- `cad-query`

job 実行の内部 command:

- `import-cad-file`
- `rebuild-revision`
- `generate-tessellation`
- `generate-drawing`
- `export-artifact`
- `validate-assembly`

## UI Structure

`fullapp` 前提で、主要画面は次の通り。

- workspace home
- model explorer
- revision viewer
- review inbox
- compare view
- export/job console

### Threlte component shape

想定コンポーネント:

- `CadSceneCanvas.svelte`
- `CadSceneModel.svelte`
- `CadSelectionOverlay.svelte`
- `CadAnchorLayer.svelte`
- `CadSectionPlane.svelte`
- `CadExplodeControl.svelte`
- `CadRevisionPanel.svelte`
- `CadCommentPanel.svelte`

### Revision viewer layout

AppShell v2 の header/footer は標準に従う。中央は viewer、下部または右側は context panel を使う。
ただし mobile-first 原則に合わせ、sidebar 固定ではなく panel/drawer 切替とする。

viewer の主な panel:

- assembly tree
- properties
- comments
- revisions
- exports

viewer 中央は Threlte canvas、周辺 UI は Svelte panel とし、3D 空間と業務 UI を分離する。

## Diff Strategy

CAD の diff は text diff ではなく multi-layer に分ける。

- metadata diff: name, material, lifecycle state
- topology diff: added/removed parts, face count, volume, bbox
- BOM diff: quantity/material change
- visual diff: A/B overlay, ghost, color mask

`GetRevisionDiff` は最終的に追加候補だが、phase 1 では
`GetRevision`, `GetBom`, `GetRevisionScene` の組み合わせで成立させる。

## Phase Plan

### Phase 1

- import STEP/IGES
- scene conversion to glTF
- revision viewer
- anchored comments
- review threads
- export STL/glTF/PDF
- async jobs

### Phase 2

- branch 作成
- limited parametric edit
- compare view
- assembly/BOM query 強化
- realtime presence

### Phase 3

- merge assistance
- drawing dimension review
- rules/checker automation
- agent-assisted design review

## cross-actor / Agent Integration

CAD app は agent tool としても公開できる。

想定 tool:

- `inspect-cad-revision`
- `summarize-design-change`
- `check-bom-risk`
- `review-manufacturability`
- `export-view-package`

agent の出力も人間の review thread に落とし、silent mutation は避ける。

## Deployment Shape

- project: `60-apps/etzhayyim-project-cad`
- app dir: `60-apps/etzhayyim-project-cad/wasm/etzhayyim-wasm-cad-<nanoid>`
- runtime: `container`
- ui mode: `fullapp`

初期 route:

- `/`
- `/xrpc/etzhayyim.cad.v1.CadCommandService/*`
- `/xrpc/etzhayyim.cad.v1.CadQueryService/*`
- `/_app/meta`
- `/healthz`

## Non-Goals / Prohibitions

- business mutation を public REST で追加しない
- base64 JSON で大きい CAD binary を運ばない
- viewer から blob storage を直接 source of truth にしない
- geometry kernel の内部型を public contract に漏らさない
- native desktop CAD の全操作互換を初期要件にしない

## Recommended First Increment

最初の実装単位は次がよい。

1. `ImportCadFile`
2. `GetRevisionScene`
3. `AddAnchoredComment`
4. `ListComments`
5. `RequestExport`

これで「アップロードして見る、コメントする、共有用 artifact を出す」までを最短で成立させられる。

### First UI slice with Threlte

最初の UI 実装は次に絞る。

1. `GetRevisionScene` を読む Threlte canvas
2. assembly tree と selection 同期
3. click-to-comment anchor
4. unresolved comments panel
5. export job status panel
