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
3. **入力**: テキスト貼り付け、Instagram URL、またはファイルアップロード。
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
