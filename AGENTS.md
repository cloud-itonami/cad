# etzhayyim-project-cad

`etzhayyim-project-cad` の権威ルール。
この project は **App** として設計・実装する。

詳細設計は CAD project の 2026-03-20 設計書を正とする。

## Product Identity

- `cad` は browser-based CAD viewer/editor/review/export のための App
- app boundary は `workspace -> model -> revision -> representation` を中心に置く
- public contract は XRPC の `*CommandService` / `*QueryService`
- 会話/通知/agent activity は W Protocol を使う

## Runtime

- 標準 runtime は `container`
- 理由は STEP/IGES/BREP import、tessellation、rebuild、drawing/export が重いため
- UI mode は `fullapp`
- 3D viewer 標準は `Threlte` とする

## Frontend / Viewer

- CAD viewer の標準実装は Svelte + `Threlte`
- UI は geometry kernel を持たず、`GetRevisionScene` / `GetRevisionTopology` で受けた projection を描画する
- precise selection, isolate, explode, section, comment anchor は `Threlte` scene 上で実装する
- scene source of truth は backend が生成する glTF/scene projection とし、viewer が blob を直接解釈しない

## Command / Query

- mutation は `CadCommandService`
- read は `CadQueryService`
- business mutation を public REST で追加しない
- query は projection-first で設計する

## Storage

- CAD binary 原本と派生 artifact は blob layer に置く
- metadata, lineage, review, comment anchor, job state は SQL graph / projection に置く
- base64 JSON で大きい CAD binary を運ばない

## Collaboration

- phase 1 の主軸は full co-edit ではなく review/presence
- authoritative state は revision と job projection
- collaborative edit は `branch + operation log + rebuild` を基本にする

## First Increment

最初の実装は次を優先する。

1. `ImportCadFile`
2. `GetRevisionScene`
3. `AddAnchoredComment`
4. `ListComments`
5. `RequestExport`

## UI Contract

- `GetRevisionScene` は `Threlte` viewer がそのまま描画できる scene graph を返す
- 最低限含めるものは `representation`, `camera`, `parts tree`, `materials`, `selection ids`, `bounds`, `units`
- anchored comment 描画に必要な `part_occurrence_path`, `topology_ref`, `world_position`, `camera_snapshot` を返せるようにする
