# ADR 0001 — cad が正本として持つもの、持たないもの

- **Status**: accepted
- **Date**: 2026-08-12
- **Scope**: `cloud-itonami/cad`（west name `cloud-itonami-cad`）

## Context

このリポジトリは `etzhayyim/root` の `60-apps/etzhayyim-project-cad` から
26 ファイル・336 KB として切り出された（`migration.edn`）。切り出しは成功しているが、
**切り出された結果が何であるかを述べる文書が無かった** —— 入口は
`README.edn`（1 行のメタデータ）と `CLAUDE.md`（2026-03 の設計時点の指示）だけで、
どちらも「今このリポジトリで何が動くか」を答えない。

実測すると、リポジトリの中身は 2 つの面に分かれていて、**動く度合いが大きく違う**:

| 面 | 実測 |
|---|---|
| `kotoba/` | `npm install` → `npm test` が通る（4 tests / 1 file）。`tsc --noEmit` も exit 0 |
| `appview/.../svelte/` | `npm install` が `EUNSUPPORTEDPROTOCOL` で落ちる（`"@etzhayyim/design-system": "workspace:*"` を解決できない）。`App.svelte` は 32 行のスキャフォールド |
| `appview/.../src/app.ts` | `appview/` 直下に `package.json` も `wrangler.toml` も無く、ビルド対象が定義されていない |
| `appview/.../svelte/static/v2*` | wasm がチェックイン済みで、静的配信すれば 3 資産とも解決する。ただし**ソースもビルドレシピもこのリポジトリに無い** |

さらに、リポジトリ内 `CLAUDE.md` が「CAD viewer の標準実装は Svelte + Threlte」と
書いているが、**superproject の repo-wide 規則（2026-07-10、設計書より 4 か月後）は
Three.js 系を app ごとの第 2 エンジンとして導入することを禁じている**。Threlte は
Three.js の Svelte ラッパなので、この 2 つは正面から衝突している。

## Decision

1. **`kotoba/` をこのリポジトリの正本とする。** model / revision / anchored comment の
   レジストリ意味論（FK 制約・`version` 正整数・`representationCid` の CID 形式）は
   ここが所有し、`test/cad.test.ts` が守る。

2. **幾何は所有しない。** STEP / IGES / BREP / メッシュのバイト列はこのリポジトリの
   データ面に載せない（CID 参照のみ）。パースとテセレーションは `cad-job`
   Container の仕事であり、ここに持ち込まない。設計書 `260320-cad-kotodamaapp-design.md`
   の blob 層 / graph 層の分離をそのまま維持する。

3. **レンダリング実装も所有しない。** `static/v2/kami_app_cad*` は
   `kotoba-lang/kami-app-cad` の**成果物**であって、このリポジトリのソースではない。
   ビューアを変更したい場合の行き先は上流であり、ここではない。

4. **3D については superproject の規則が勝つ。** リポジトリ内 `CLAUDE.md` の
   Threlte 記述を、新しいビューア実装の根拠にしない。superproject の
   「3D はすべて kami-engine を使う」に対する例外 ADR はこのリポジトリに存在せず、
   本 ADR もそれを発行しない。現状は偶然規則側に揃っている（実際に動くビューアは
   Threlte ではなく kami-app-cad の wasm）ので、**壊すのは新しい Threlte 実装を
   足したときだけ**である。足したくなったら、先に例外 ADR を superproject に起票する。

5. **`appview/` は「切り出しの残骸」として明示し、動くふりをさせない。**
   README と operator quickstart の両方に、ビルドできないこととその理由を書く。
   黙って放置すると、次に来た者が「UI があるのに壊れている」と読んで修理を始める ——
   実際には修理して得られる UI が無い（32 行のスキャフォールド）。

## Consequences

- 新しい機能は `kotoba/` に入る。`appview/` を触る作業は、下の open question を
  先に解いてからでないと成果が出ない。
- `test/cad.test.ts` が唯一の実行可能な検査面になる。3 箇所を壊して 3 箇所とも
  赤くなることを確認済み（手順と実測は `docs/operator-quickstart.md` §2）。
- 幾何とレンダを持たないので、このリポジトリのテストは**ブラウザも GPU も要らない**。
  これは意図した性質であり、E2E をここに足す前に境界を再確認すること。

## Open questions（解いていない。次に触る者へ）

1. **`svelte/` の `workspace:*` をどう解くか。** 選択肢は (a) npm/pnpm workspace を
   このリポジトリに張る (b) `kotoba-lang/svelte-design-system` への git 依存に
   書き換える (c) `svelte/` ごと削除して `static/v2` だけ残す。
   **32 行のスキャフォールドを生かすためだけなら (c) が正直**だが、Phase 2 以降の
   UI をここに置く計画があるなら (a)/(b) になる。設計書のフェーズ計画と突き合わせて
   決めること。
2. **`README.edn` の `:name` が `com-etzhayyim-app-cad` のまま**（切り出し前の名前）。
   現在の identity は `cloud-itonami/cad`。直すべきだが、`README.edn` を読んでいる
   下流（`etzhayyim.repository/v1` スキーマの消費者）が居るかを確かめてから触ること。
3. **`kotoba/package-lock.json` を commit するか。** 現在は `.gitignore` している。
   直接依存は commit SHA で固定されているが、**推移的依存は固定されていない** ——
   再現性を求めるなら commit すべきである。今回 commit しなかったのは、この docs パスの
   範囲外で、かつ 1 台のマシンの解決結果を焼き付けることになるため。
4. **`appview/src/app.ts` のビルド/デプロイ経路がどこにあるか。** kotodama host 側に
   あると読めるが、実際にデプロイした証跡をこのリポジトリからは辿れない。
