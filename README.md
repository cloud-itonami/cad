# cad

**`cloud-itonami/cad` は browser CAD の *レジストリと appview* であって、幾何カーネルではない。**

扱う単位は `workspace → model → revision → representation` で、実際の幾何
（STEP / IGES / BREP / メッシュ）は **CID で参照するだけ**、バイト列はこのリポジトリの
データ面に載らない。レビュー（anchored comment）と revision の系譜がこのリポジトリの
主題で、パースとテセレーションは別プロセス（CF Container `cad-job`）の仕事。

- GitHub: `cloud-itonami/cad` ／ west name: **`cloud-itonami-cad`** ／ path: `orgs/cloud-itonami/cad`
- controller DID: `did:web:cad.etzhayyim.com`
- AT PDS collections: `com.etzhayyim.apps.cad.{model,revision,comment}`

> `README.edn` は `:name "com-etzhayyim-app-cad"` のまま止まっている（etzhayyim/root から
> 切り出す前の名前）。現在の identity は上の 3 行が正しい。

## 何が入っているか — 2 つの面があり、片方だけが今日ビルドできる

| 面 | 中身 | 今日の状態 |
|---|---|---|
| **`kotoba/`** | `@etzhayyim/cad-kotoba` — model / revision / comment の登録・照会・coverage。AT PDS レコードに対する純粋な TypeScript ライブラリ | **ビルド・テストが通る**（実測、下記 quickstart） |
| **`appview/etzhayyim-wasm-cad-cd4dview/`** | Cloudflare Worker（`src/app.ts`、`@etzhayyim/kotodama-host-sdk`）+ ClojureScript scaffold（`cljs/`、shadow-cljs + reagent + re-frame + jp-go-dds）+ 事前ビルド済み wasm ビューア（`static/`） | **`cljs/` はビルド・テストが通る。Worker（`src/app.ts`）は依存解決対象が定義されておらず単体ビルド不可**（下記） |

`260320-cad-kotodamaapp-design.md`（15 KB）が詳細設計の正本。CommandService /
QueryService の分割、`GetRevisionScene` の応答契約、blob 層と graph 層の境界、
フェーズ計画はそこに書いてある。**このリポジトリのコードは設計の全体ではなく、
Phase 1 のレジストリ部分**である。

### `kotoba/` の境界（ここが実装済みの本体）

`src/registry.ts` の 9 関数 + `coverage`。守っている不変条件は 3 つ:

1. **revision と comment は model を FK 参照する。** 存在しない `modelId` に対する
   `addRevision` / `addComment` は `modelNotFound` を返す（作らない）。
2. **`version` は正の整数のみ**（AT Lexicon に float が無いため。`types.ts` 冒頭に明記）。
3. **`representationCid` は CID の形をしていなければ `rejected`。** ここが
   「幾何を inline しない」という設計を型ではなく実行時に守っている唯一の場所。

この 3 つは `test/cad.test.ts` が実際に押さえている（壊すと赤くなることを確認済み。
証拠は `docs/operator-quickstart.md` の末尾）。

### `appview/` の境界（動かす前に読むこと）

- **2026-08-26 に `svelte/` を `cljs/` へ移行した**（Svelte 5 + Vite → shadow-cljs +
  reagent + re-frame + jp-go-dds、workspace 標準スタックへの揃え、ADR-2608080100）。
  `cljs/src/cad/app.cljs` は旧 `App.svelte`（32 行のスキャフォールド、"Vite entry
  scaffold after SvelteKit cleanup." と自分で書いていた）の**忠実な移植**——
  見出し 1 行 + 状態文 1 行のままで、CAD ビューア機能は増やしていない。旧 svelte の
  `"@etzhayyim/design-system": "workspace:*"` 未解決依存（`kotoba-lang/
  svelte-design-system` が実体、npm workspace 未設定で `EUNSUPPORTEDPROTOCOL`）は
  UI をこのワークスペースの基本 design system（jp-go-dds）に置き換えたことで解消した。
  手順は `docs/operator-quickstart.md`。
- **`static/v2.htm` + `static/v2/` が実際に動く唯一のビューア面。** これは
  `kotoba-lang/kami-app-cad` を wasm-bindgen でビルドした**成果物がチェックイン
  されているだけ**で、ソースもビルドレシピもこのリポジトリには無い。作り直すには
  上流の repo に行く必要がある。この cljs 移行より前は `svelte/static/` 配下に
  あった（Svelte アプリの静的アセットディレクトリに間借りしていただけで、Svelte
  ソースの一部ではない）。移行時に `appview/etzhayyim-wasm-cad-cd4dview/static/`
  へ移設し、Svelte の削除に巻き込まれないようにした。
- `src/app.ts` は Worker のエントリだが、`appview/` 直下に `package.json` が無いので
  このリポジトリ単体では依存解決もビルドもできない（フロントエンドの移行対象外
  ——これは backend で、今回は触っていない）。

## 3D の権威 — Threlte はこのリポジトリの独断では使えない

`CLAUDE.md`（リポジトリ内、2026-03 の設計時点）は「CAD viewer の標準実装は Svelte +
Threlte」と書いている。**これは superproject の repo-wide 規則と衝突している。**

superproject の `CLAUDE.md`「3D はすべて kami-engine を使う」（2026-07-10、設計書より後）は、
用途を問わず canonical な kami-engine stack を使うことを求め、**Three.js / Babylon.js 等を
app ごとの第 2 エンジンとして導入することを名指しで禁じている**（Threlte は Three.js の
Svelte ラッパ）。例外には対象・期間・理由・撤去条件を書いた accepted ADR が要るが、
**このリポジトリにその ADR は無い。**

現状は偶然そちら側に揃っている —— 実際に動くビューアは Threlte ではなく
`kami-app-cad` の wasm だからである（2026-08-26 の cljs 移行で `svelte/` 自体が
消えたので、なおさら Threlte 実装はこのリポジトリに存在しない）。**新しい
ビューア実装を書くときは、このリポジトリ内 `CLAUDE.md` の Threlte 記述を
根拠にしない。** superproject 側が勝つ。詳細は
`docs/adr/0001-what-this-repo-is-authoritative-for.md`。

## 使いはじめる

**`docs/operator-quickstart.md`** —— 実際に踏んだ手順だけが書いてある（実行結果の
実測値つき）。読む順は quickstart → `260320-cad-kotodamaapp-design.md` →
`kotoba/src/types.ts`。

```bash
cd kotoba && npm install && npm test     # 4 tests, 1 file
```

## 隣との境界

| 混同しやすい相手 | 違い |
|---|---|
| `kotoba-lang/kami-app-cad` | 幾何とレンダの**実装**（Rust → wasm）。このリポジトリはその成果物を静的に配るだけ |
| `cad-job`（CF Container） | STEP/IGES のパースとテセレーション。重い処理はすべてあちら。ここには入れない |
| `kotoba-lang/jp-go-digital-design-system` | `cljs/` scaffold が使う UI 部品・トークンの実体（デジタル庁デザインシステム） |

## ライセンス

Apache-2.0 + etzhayyim Charter Compliance Rider v3.1（`NOTICE` を参照）。
