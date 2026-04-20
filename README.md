# 表現・法令チェッカー（薬機法 / 特商法 / 社内ルール）

AIを活用して、SNS投稿や広告文を**薬機法**、**特定商取引法（特商法）**、または**社内ルール**の観点から解析し、修正案を提案するツールです。

## 概要

動画制作の最終工程やSNS投稿前のチェック用です。最上位でチェック種別を1つ選び、テキスト・Instagram URL・画像/動画のいずれかで入力します。種別ごとに**別々に**解析を実行します（同時解析はしません）。

## 主な機能

- **チェック種別（3択・単一選択）**
  - **薬機法**: `knowledge/薬機法` 内の PDF を参照（フォルダが空のときは従来どおり `knowledge` 直下の PDF にフォールバック）。
  - **特商法**: `knowledge/特商法` 内の PDF を参照。
  - **社内ルール**: 指定の **Google ドキュメント**をサーバーがテキスト取得し、プロンプトの参照文書として使用（下記環境変数・共有設定が必要）。
- **マルチ入力対応解析**
  - **テキスト解析** / **Instagram URL解析** / **ファイル解析**（画像・動画・マルチファイル）。
- **リスクラベリング**
  - 薬機法モードでは一覧に **CRITICAL** のみ表示（従来どおり）。
  - 特商法・社内ルールでは **CRITICAL** と **WARNING** を一覧表示。
- **AI代替案**
  - 指摘箇所に対し最大3件の修正案・言い換え案を提示（ワンクリックコピー）。

## 使い方

1. **チェック種別**: 「薬機法」「特商法」「社内ルール」から1つを選びます。種別を変えると解析結果はクリアされます。
2. **入力方法**: 「テキスト解析」「Instagram URL」「画像・動画」のタブから選びます。
3. **入力**: テキスト貼り付け、Instagram の投稿 URL（または「ユーザー名＋投稿 URL／投稿 ID」）、またはファイルアップロード。
4. **解析実行**: 種別に応じたボタン（例:「特商法で解析する」）をクリック。
5. **結果**: 右側のパネルで総評・指摘・修正案を確認します。

## ローカルでの起動方法

### 前提条件

- **Node.js**: 18.x 以上を推奨。
- **APIキー**: Google Gemini API キー、および（必要に応じて）Instagram Graph API のアクセス情報が必要です。

### 1. リポジトリのクローンとインストール

```bash
cd yakki-check
npm install
```

### 2. 環境変数の設定

プロジェクトのルートディレクトリに `.env.local` ファイルを作成し、以下の情報を設定してください。

```env
# Google Gemini API (必須)
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_api_key_here
# 使用モデル（任意・省略時は gemini-2.5-flash）。Vercel の Environment Variables でも同様に設定可能
# GOOGLE_GENERATIVE_AI_MODEL=gemini-2.5-pro

# Instagram Graph API (URL解析機能を使用する場合に必須)
INSTAGRAM_ACCESS_TOKEN=your_access_token_here
INSTAGRAM_BUSINESS_ACCOUNT_ID=your_business_account_id_here

# 社内ルール用 Google ドキュメント（省略時はリポジトリ既定のドキュメントIDを使用）
# ドキュメントIDは URL の /d/ と /edit の間の文字列です。
INTERNAL_RULES_GOOGLE_DOC_ID=your_google_doc_id_here
```

**社内ルールについて**: サーバーは `https://docs.google.com/document/d/{ID}/export?format=txt` から本文を取得します。**リンクを知っている全員が閲覧できる**など、認証なしでテキスト export が可能な共有設定にしてください。非公開のままでは取得に失敗します。

### 3. ガイドライン資料の配置

次のように **サブフォルダごとに PDF** を置きます。

| チェック種別 | フォルダ |
|-------------|----------|
| 薬機法 | `knowledge/薬機法/` |
| 特商法 | `knowledge/特商法/` |

薬機法で `knowledge/薬機法` が空の場合のみ、後方互換として `knowledge` 直下の PDF も読み込みます。

### 4. 開発サーバーの起動

```bash
npm run dev
```

起動後、 [http://localhost:3000](http://localhost:3000) にアクセスしてください。

## HTTP API

Next.js の Route Handler として次のエンドポイントがあります。ローカルではベース URL は `http://localhost:3000`、本番ではデプロイ先のオリジンを前提にしてください。いずれも **`Content-Type: application/json`** の **POST** です。

### `POST /api/instagram-info`

Instagram Graph API（business discovery 等）で、指定投稿の**キャプション**と **Graph の `media_url` 一覧**を取得します。ブラウザ UI では、続けて返却された URL を `/api/check` に渡して解析しています。

**必要な環境変数**: `INSTAGRAM_ACCESS_TOKEN`、`INSTAGRAM_BUSINESS_ACCOUNT_ID`（未設定やプレースホルダー時はエラーになります）。

#### リクエストボディ（どちらか一方）

**A. 投稿 URL のみ**

```json
{
  "url": "https://www.instagram.com/example_user/p/AbCdEfGhIjK/"
}
```

短い共有 URL（パスが `/p/` や `/reel/` のみ）の場合、ユーザー名が URL から取れないときは **instagram oembed** で投稿者を補完します（トークンが必要）。

**B. ユーザー名と投稿 URL、または投稿 ID（ショートコード）**

```json
{
  "username": "example_user",
  "postUrlOrShortcode": "https://www.instagram.com/p/DXG6SJvj7d5/?hl=ja&img_index=1"
}
```

`postUrlOrShortcode` には `/p/…` や `/reel/…` を含む URL のほか、**ショートコードだけ**（例: `DXG6SJvj7d5`）も指定できます。リール由来の URL の場合は内部的に `/reel/{ショートコード}/` 形式に組み立てます。

`username` が非空かつ `postUrlOrShortcode` が非空のときは **B が優先**され、この場合は `url` は参照されません。

#### レスポンス

成功時（HTTP 200）は概ね次の形です。

```json
{
  "success": true,
  "caption": "投稿本文…",
  "author": "example_user",
  "timestamp": "…",
  "media_items": [
    { "media_url": "https://…", "media_type": "IMAGE" }
  ]
}
```

カルーセルは `media_items` に複数要素が入ることがあります。失敗時は HTTP **400** または **500** で `{ "error": "メッセージ" }` が返ります。

---

### `POST /api/check`

Google Gemini にチェック種別に応じたシステムプロンプトと入力（テキスト・PDF 知識・画像/動画バイナリ）を渡し、**JSON 形式**の解析結果を返します。

**必要な環境変数**: `GOOGLE_GENERATIVE_AI_API_KEY`（必須）。Instagram の `media_url` をサーバーで取得して解析する場合は `INSTAGRAM_ACCESS_TOKEN` も必要です。

#### リクエストボディ

| フィールド | 型 | 説明 |
|------------|-----|------|
| `checkType` | 文字列 | **必須。** `yakki`（薬機法） / `tokusho`（特商法） / `internal`（社内ルール） |
| `text` | 文字列 | 解析に含めるテキスト（キャプション等）。省略可 |
| `files` | 配列 | アップロード解析。各要素は少なくとも `data`（Data URL 形式の文字列）、`type`（MIME）、`name` を想定。動画では `duration`、参照用の `frames`（スクリーンショットの Data URL と `timeSec`）などを UI が付与 |
| `instagramGraphMediaUrls` | 文字列の配列 | Instagram Graph の `media_url` のリスト（サーバーがトークン付きで取得して Gemini に渡す） |
| `instagramGraphMediaTypes` | 文字列の配列 | 省略可。`instagramGraphMediaUrls` と同じ長さで、各メディアの種別（例: `IMAGE`, `VIDEO`, `REELS`）。省略時は `IMAGE` 扱い |

**入力のルール**

- `text`・`files`・`instagramGraphMediaUrls` の**いずれか一つ以上**が必要です。すべて空だと HTTP 400 です。
- **`files` と `instagramGraphMediaUrls` を同時に指定できません**（400）。

`checkType` が `internal` のときは社内ルール用の Google ドキュメントをサーバーが取得します（共有設定・`INTERNAL_RULES_GOOGLE_DOC_ID` は「ローカルでの起動方法」の説明を参照）。`yakki` / `tokusho` では `knowledge/` 配下の PDF が参照資料として添付されます。

#### レスポンス

成功時（HTTP 200）は、Gemini が出力した JSON（例: 指摘の `results`、全体の `summary` など）に、サーバーが次を**付加**します。

- `caption`: リクエストの `text` をエコーしたもの
- `checkType`: リクエストと同じ値
- Instagram 経由でメディアを扱った場合、プレビュー用に `previewUrls`（`url` と `IMAGE` / `VIDEO`）が含まれることがあります

失敗時は HTTP **400** または **500** で `{ "error": "メッセージ" }` です。メディアサイズ超過など、条件によっては 500 になります。

## 技術スタック

- **Frontend**: Next.js (App Router), Tailwind CSS
- **UI Components**: Framer Motion, Lucide React
- **AI**: Vercel AI SDK, Google Gemini 2.5 Pro/Flash
- **Validation**: Zod

## ディレクトリ構造

- `/app`: アプリケーションのメインロジック（UI、APIルート）。
- `/knowledge/薬機法`, `/knowledge/特商法`: 各チェック種別の参照 PDF（社内ルールは Google ドキュメントを取得）。
- `/prompts`: AIへの指示書（システムプロンプト）。
- `/lib`: ユーティリティ関数など。
