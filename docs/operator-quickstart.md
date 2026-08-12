# operator quickstart — cad

**この文書の手順はすべて実際に踏んである。** 実行結果は実測値で、期待値ではない。
測ったのは 2026-08-12、macOS 15（darwin 25.3.0 / arm64）、Node v26.3.0 / npm 11.12.1。

踏めなかった手順は「踏めない」と書いてあり、手順として並べていない。

---

## 0. 前提

- Node（測ったのは v26.3.0）と npm。それ以外の前提は無い。
- **`kotoba/` の依存はネットワークから取る** —— `@etzhayyim/sdk` と
  `@etzhayyim/sdk-mock` は npm registry ではなく **GitHub の commit SHA に固定された
  git 依存**（`kotoba/package.json` に SHA が直書きされている）。`github.com` に
  到達できない環境では `npm install` が通らない。

```bash
git clone git@github.com:cloud-itonami/cad.git
cd cad
```

west 管理下（superproject）なら checkout は `orgs/cloud-itonami/cad`。
west name は **`cloud-itonami-cad`**（ディレクトリ名の `cad` ではない）:

```bash
west update --fetch smart cloud-itonami-cad
```

---

## 1. `kotoba/` を動かす —— ここが今日ビルドできる唯一の面

```bash
cd kotoba
npm install
```

**実測**: `added 135 packages, and audited 136 packages in 3m`。
git 依存 8 本（`@etzhayyim/{sdk,sdk-mock,atproto-client,base-l2,checkpointer,ipfs,pqh,witness-quorum}`）を
clone して `prepare: tsc` を走らせるので長い。**同じ日に測り直したら 4 分、
別の回は 7 分を超えた** —— ネットワークと npm キャッシュ次第で大きくぶれる。
**短いタイムアウトで囲まないこと**（囲んで殺すと下記の壊れ方をする）。

`npm warn allow-scripts` が 8 パッケージぶん出るが、これは npm が install script を
保留した通知であって失敗ではない。**承認しなくてもテストは通る**（下記は承認せずに
測った値）。

### install が途中で死んだときの直し方（実際に踏んだ）

install をタイムアウトで殺した／ディスクが埋まった（`ENOSPC`）場合、
**`node_modules/` は「中途半端に存在する」状態で残り、`npm install` を叩き直しても
直らない。** そのとき出る症状は、実装が壊れているように見えるので紛らわしい:

```
sh: vitest: command not found                                    # npm test
src/registry.ts(121,11): error TS7006: Parameter 'r' implicitly has an 'any' type.   # npm run typecheck
```

**この TS7006 群はソースの欠陥ではない。** `@etzhayyim/sdk` が展開されておらず
`Etzhayyim` 型が解決できないための派生エラーで、完全な `node_modules`
（`node_modules/@etzhayyim/` に 8 ディレクトリ）では `tsc --noEmit` は exit 0 になる。
実測で確認済み。直し方:

```bash
rm -rf node_modules package-lock.json
npm install      # 最後まで走らせる。殺さない
ls node_modules/@etzhayyim/ | wc -l    # ← 8 であること。これが完了の判定
```

### テスト

```bash
npm test
```

**実測**:

```
 RUN  v4.1.10

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  298ms
```

4 本の内訳（`npx vitest run --reporter=verbose`）:

| テスト | 押さえている不変条件 |
|---|---|
| `model > creates, reads, lists by workspace/format + app-layer search; validates` | 重複 `modelId` は `alreadyExists`、未知の format は `rejected`、`q` は name の部分一致 |
| `revisions + comments > adds revisions (FK→model + CID), rejects bad version/cid/missing model` | `version` は正整数、`representationCid` は CID の形、model が無ければ `modelNotFound` |
| `revisions + comments > adds + resolves anchored comments (FK→model), filters` | comment も model を FK 参照、`resolve` は冪等ではない（2 回目は `rejected`） |
| `revisions + comments > coverage rolls up the three collections` | `coverage` が 3 コレクションを横断して数える |

### 型検査

```bash
npm run typecheck     # tsc --noEmit
```

**実測**: 出力なし、exit 0。

---

## 2. このテストが本当に噛んでいることの確認（3 回壊した）

**通ることは、検査していることの証拠にならない。** 実装を 3 箇所壊して、
それぞれ赤くなることを確認した。手元で再現できる:

| # | 壊し方（`kotoba/src/registry.ts`） | 実測の結果 |
|---|---|---|
| 1 | `representationCid` の CID 検証を無効化（`if (false && ...)`） | `1 failed \| 3 passed` — `AssertionError: expected 'added' to be 'rejected'` |
| 2 | `addComment` の model 存在検査を無効化（`if (false) {`） | `1 failed \| 3 passed` — `AssertionError: expected 'added' to be 'modelNotFound'` |
| 3 | `coverage` の返り値を `modelCount: 0` に固定 | `1 failed \| 3 passed` — `AssertionError: expected +0 to be 1` |

再現手順（1 番の例）:

```bash
cd kotoba
cp src/registry.ts /tmp/registry.ts.bak
perl -0pi -e 's/if \(input\.representationCid && !looksLikeCid\(input\.representationCid\)\)/if (false && input.representationCid \&\& !looksLikeCid(input.representationCid))/' src/registry.ts
npx vitest run          # ← 赤くなること
cp /tmp/registry.ts.bak src/registry.ts
npx vitest run          # ← 緑に戻ること
```

**4 番目として `coverage` の `modelsByFormat` も試したが、そこは別の書き方が要る** ——
返り値がショートハンド（`modelCount,`）なので `modelCount: X,` を狙う置換は
**何も置換せずに緑のまま通る**。置換が効いたことを `sed -n` などで目で確かめてから
テストを読むこと（一度これで「テストが噛んでいない」と誤読しかけた）。

---

## 3. 静的ビューア（`v2.htm`）を配る

実際に動くビューア面はここだけ。ビルド不要 —— wasm がチェックイン済み。

```bash
cd appview/etzhayyim-wasm-cad-cd4dview/svelte/static
python3 -m http.server 8787
```

**実測**（3 資産すべて解決した）:

```
GET /v2.htm                     200  text/html   5113 bytes
GET /v2/kami_app_cad.js         200              62453 bytes
GET /v2/kami_app_cad_bg.wasm    200              先頭 4 byte = 00 61 73 6d ("\0asm")
```

ブラウザで `http://127.0.0.1:8787/v2.htm` を開くと、デモ部品（base plate + boss + pin）の
CAD ビューアが立ち上がる想定。操作は HUD の下部に出る: drag でオービット、ホイールで
ズーム、ドラッグ無しの左クリックでピック。

> **ここまでで検証したのは「3 資産が配信でき、wasm が本物の WebAssembly モジュールで
> あること」までである。描画されたフレームは今回見ていない**（WebGPU/WebGL のブラウザ
> セッションが要り、この docs パスの範囲外）。「開けば動く」と読まないこと。

このビューアを作り直したくなったら、ソースはここではなく
**`kotoba-lang/kami-app-cad`** にある。

---

## 4. 踏めない手順 —— やろうとして止まった場所

### `svelte/` の UI はこのリポジトリ単体でインストールできない

```bash
cd appview/etzhayyim-wasm-cad-cd4dview/svelte
npm install
```

**実測**:

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
```

`package.json` の `"@etzhayyim/design-system": "workspace:*"` が原因。このリポジトリは
npm/pnpm workspace のルートを持たないので、`workspace:` プロトコルを解決できない。
依存先の実体は **`kotoba-lang/svelte-design-system`**（`package.json` の `name` が
`@etzhayyim/design-system`）。

直すには workspace を張るか git 依存に書き換えるかだが、**どちらにするかは未決**
（`docs/adr/0001` の open question を参照）。そして `src/App.svelte` は 32 行の
スキャフォールドなので、**今これを直しても得られる UI は無い。**

### `appview/` の Worker はビルド対象が定義されていない

`appview/etzhayyim-wasm-cad-cd4dview/src/app.ts` は
`@etzhayyim/kotodama-host-sdk` を import するが、`appview/` 直下に `package.json` も
`wrangler.toml` も無い。**このリポジトリ単体では依存解決もビルドもデプロイもできない。**
デプロイ経路は kotodama host 側にあり、ここには無い。

---

## 5. 後片付け

`npm install` は `kotoba/node_modules/` と `kotoba/package-lock.json` を作る。
どちらも `.gitignore` 済みなので、quickstart を踏んでもツリーは汚れない
（`git status --porcelain` が空のままであることを確認済み）。

---

## 付録: この文書を疑うとき

数字が合わなくなったら、まずここを確かめる:

- **`npm install` が 3 分より大幅に速い/遅い** — git 依存 8 本の clone が支配的なので、
  ネットワークと npm キャッシュの状態で動く。3〜7 分の幅を実測している。異常ではない。
- **`vitest: command not found` / `src/registry.ts` に TS7006 の山** — ソースではなく
  `node_modules` が不完全。§1 の「install が途中で死んだときの直し方」へ。
- **テスト数が 4 でない** — `test/cad.test.ts` は 1 ファイル・4 ケース。増減していたら
  この文書のほうが古い。
- **`npm install` が `EUNSUPPORTEDPROTOCOL` で落ちる** — `kotoba/` ではなく
  `svelte/` に居る。§4 のとおりそれは既知で、`kotoba/` に戻ること。
