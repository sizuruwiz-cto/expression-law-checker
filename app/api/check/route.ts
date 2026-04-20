import { GoogleGenerativeAI, Part } from "@google/generative-ai";
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const maxDuration = 60;

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || "");

/** 未設定時は従来どおり。Vercel / .env.local で `GOOGLE_GENERATIVE_AI_MODEL` を上書き可能 */
const GEMINI_MODEL_ID =
  process.env.GOOGLE_GENERATIVE_AI_MODEL?.trim() || "gemini-2.5-flash";

/** デフォルト: 【社内ルール】著作権トラブル防止（共有用 Google ドキュメント） */
const DEFAULT_INTERNAL_RULES_DOC_ID = "10tubqZXDiRnrDaqWTgszhai53FPzLiCBWtOWrvJJsQo";
const INTERNAL_RULES_TEXT_MAX_CHARS = 120_000;

export type CheckType = "yakki" | "tokusho" | "internal";

const KNOWLEDGE_SUBDIR: Record<Exclude<CheckType, "internal">, string> = {
  yakki: "薬機法",
  tokusho: "特商法",
};

const PROMPT_FILE: Record<CheckType, string> = {
  yakki: "yakki-check.md",
  tokusho: "tokusho-check.md",
  internal: "internal-rules-check.md",
};

function getPdfPartsFromDir(dirPath: string): Part[] {
  if (!fs.existsSync(dirPath)) return [];

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const parts: Part[] = [];

  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.toLowerCase().endsWith(".pdf")) continue;
    const filePath = path.join(dirPath, e.name);
    const data = fs.readFileSync(filePath);
    parts.push({
      inlineData: {
        data: data.toString("base64"),
        mimeType: "application/pdf",
      },
    });
  }
  return parts;
}

/**
 * チェック種別に応じた knowledge 配下の PDF を取得する。
 * 薬機法: knowledge/薬機法（空なら従来どおり knowledge 直下の PDF をフォールバック）
 */
function getKnowledgePdfParts(checkType: CheckType): Part[] {
  const knowledgeDir = path.join(process.cwd(), "knowledge");

  if (checkType === "internal") return [];

  const subDir = path.join(knowledgeDir, KNOWLEDGE_SUBDIR[checkType]);
  let parts = getPdfPartsFromDir(subDir);

  if (parts.length === 0 && checkType === "yakki") {
    parts = getPdfPartsFromDir(knowledgeDir);
  }

  return parts;
}

async function fetchInternalRulesDocumentText(): Promise<string> {
  const docId =
    process.env.INTERNAL_RULES_GOOGLE_DOC_ID?.trim() || DEFAULT_INTERNAL_RULES_DOC_ID;
  const url = `https://docs.google.com/document/d/${docId}/export?format=txt`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; YakkiCheck/1.0)",
    },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    throw new Error(
      `社内ルールドキュメントの取得に失敗しました（${res.status}）。ドキュメントが「リンクを知っている全員」に公開されているか、INTERNAL_RULES_GOOGLE_DOC_ID を確認してください。`
    );
  }

  let text = await res.text();
  text = text.replace(/\r\n/g, "\n").trim();

  if (!text) {
    throw new Error("社内ルールドキュメントの本文が空でした。");
  }

  if (text.length > INTERNAL_RULES_TEXT_MAX_CHARS) {
    text =
      text.slice(0, INTERNAL_RULES_TEXT_MAX_CHARS) +
      "\n\n[以下省略: 原文が長いため先頭 " +
      INTERNAL_RULES_TEXT_MAX_CHARS +
      " 文字までを参照に含めています。]";
  }

  return text;
}

/** 画像は従来どおり。動画・リールは Gemini インライン想定に合わせて広め（ai.google.dev の動画理解ガイドラインに沿う） */
function resolveMaxBytesFromEnvMb(envName: string, defaultMb: number): number {
  const raw = process.env[envName]?.trim();
  if (!raw) return Math.floor(defaultMb * 1024 * 1024);
  const mb = Number(raw);
  if (!Number.isFinite(mb) || mb <= 0) return Math.floor(defaultMb * 1024 * 1024);
  return Math.floor(mb * 1024 * 1024);
}

const MAX_INSTAGRAM_IMAGE_BYTES = resolveMaxBytesFromEnvMb("MAX_INSTAGRAM_IMAGE_MB", 20);
const MAX_INSTAGRAM_VIDEO_BYTES = resolveMaxBytesFromEnvMb("MAX_INSTAGRAM_VIDEO_MB", 100);

/**
 * Instagram Graph API の media_url をサーバー側で取得（トークン付与）。
 * クライアントに巨大な Base64 を送らないため、Vercel のリクエストサイズ制限を回避できる。
 * 参照: https://github.com/saitoyuta39/instagram-post-analysis （クライアントに巨大ペイロードを載せない方針）
 */
async function fetchInstagramGraphMediaAsBase64(
  mediaUrl: string,
  accessToken: string,
  options?: { fallbackMimeType?: string; maxBytes?: number }
): Promise<{ base64: string; mimeType: string }> {
  const maxBytes = options?.maxBytes ?? MAX_INSTAGRAM_IMAGE_BYTES;
  const sep = mediaUrl.includes("?") ? "&" : "?";
  const url = `${mediaUrl}${sep}access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Instagram メディアの取得に失敗しました（HTTP ${res.status}）。トークンや URL を確認してください。`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    const capMb = Math.round(maxBytes / 1024 / 1024);
    throw new Error(
      `Instagram メディアが大きすぎます（${Math.round(buf.length / 1024 / 1024)}MB）。上限は約 ${capMb}MB です。それ以上の動画は「画像・動画」タブからファイルをアップロードするか、環境変数 MAX_INSTAGRAM_VIDEO_MB で上限を調整してください。`
    );
  }
  const headerMime = res.headers.get("content-type")?.split(";")[0]?.trim();
  const mimeType =
    headerMime && headerMime !== "application/octet-stream"
      ? headerMime
      : options?.fallbackMimeType || "image/jpeg";
  return { base64: buf.toString("base64"), mimeType };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const checkType = body.checkType as CheckType | undefined;
    const text = body.text as string | undefined;
    const files = body.files as unknown[] | undefined;
    const instagramGraphMediaUrls = body.instagramGraphMediaUrls as string[] | undefined;
    const instagramGraphMediaTypes = body.instagramGraphMediaTypes as string[] | undefined;

    if (checkType !== "yakki" && checkType !== "tokusho" && checkType !== "internal") {
      return NextResponse.json(
        { error: "checkType は yakki / tokusho / internal のいずれかを指定してください。" },
        { status: 400 }
      );
    }

    const hasRemoteUrls = Array.isArray(instagramGraphMediaUrls) && instagramGraphMediaUrls.length > 0;

    if (!text && (!files || files.length === 0) && !hasRemoteUrls) {
      return NextResponse.json({ error: "解析対象が必要です。" }, { status: 400 });
    }

    if (hasRemoteUrls && files && files.length > 0) {
      return NextResponse.json(
        { error: "instagramGraphMediaUrls と files は同時に指定できません。" },
        { status: 400 }
      );
    }

    const promptPath = path.join(process.cwd(), "prompts", PROMPT_FILE[checkType]);
    const promptBase = fs.readFileSync(promptPath, "utf-8");

    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL_ID,
      systemInstruction: promptBase,
    });

    const now = new Date();
    const jstNow = new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Tokyo",
    }).format(now);

    let inputDescription = `## 解析コンテキスト\n- 解析実行日時 (JST): ${jstNow}`;
    let caption = "";
    let imageCount = 0;

    const messageParts: Part[] = [];

    if (checkType === "internal") {
      const rulesText = await fetchInternalRulesDocumentText();
      messageParts.push({
        text:
          "## 社内ルール（参照文書・Google ドキュメントから取得）\n以下を唯一のルールソースとして適用してください。\n\n" +
          rulesText,
      });
    } else {
      const knowledgeParts = getKnowledgePdfParts(checkType);
      if (knowledgeParts.length > 0) {
        const label =
          checkType === "yakki"
            ? "薬機法関連ガイドライン"
            : "特定商取引法関連ガイドライン";
        messageParts.push({
          text: `## 参照資料（${label}・PDF ${knowledgeParts.length} 件）\n解析の根拠として使用してください。`,
        });
        messageParts.push(...knowledgeParts);
      } else {
        messageParts.push({
          text:
            "## 参照資料\n" +
            (checkType === "yakki"
              ? "knowledge/薬機法（または knowledge 直下）に PDF がありません。一般的知識のみでの解析になります。"
              : "knowledge/特商法 に PDF がありません。一般的知識のみでの解析になります。"),
        });
      }
    }

    const previewUrls: { url: string; type: "IMAGE" | "VIDEO" }[] = [];

    if (text) {
      inputDescription += `\n\n## 入力テキスト（キャプション）:\n${text}`;
      caption = text;
    }

    if (hasRemoteUrls) {
      const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
      if (!accessToken || accessToken.startsWith("your_")) {
        return NextResponse.json(
          { error: "Instagram のメディアをサーバーで取得するには INSTAGRAM_ACCESS_TOKEN が必要です。" },
          { status: 400 }
        );
      }

      messageParts.push({
        text: `\n## 解析対象の Instagram メディア（全 ${instagramGraphMediaUrls!.length} 件・サーバー取得）`,
      });

      for (let i = 0; i < instagramGraphMediaUrls!.length; i++) {
        const graphUrl = instagramGraphMediaUrls![i];
        const mediaType = instagramGraphMediaTypes?.[i] ?? "IMAGE";
        if (!graphUrl || typeof graphUrl !== "string") continue;

        if (mediaType === "VIDEO" || mediaType === "REELS") {
          const { base64, mimeType: fetchedMime } = await fetchInstagramGraphMediaAsBase64(
            graphUrl,
            accessToken,
            { fallbackMimeType: "video/mp4", maxBytes: MAX_INSTAGRAM_VIDEO_BYTES }
          );
          let mimeType = fetchedMime;
          if (!mimeType.startsWith("video/")) {
            mimeType = "video/mp4";
          }

          messageParts.push({
            text: `\n【mediaIndex: ${imageCount} ／ ${imageCount + 1}番目のメディア（Instagram 動画・リール）】`,
          });
          messageParts.push({
            inlineData: {
              data: base64,
              mimeType,
            },
          });
          previewUrls.push({ url: graphUrl, type: "VIDEO" });
          imageCount++;
          continue;
        }

        const { base64, mimeType } = await fetchInstagramGraphMediaAsBase64(graphUrl, accessToken, {
          maxBytes: MAX_INSTAGRAM_IMAGE_BYTES,
        });
        if (!mimeType.startsWith("image/")) {
          return NextResponse.json(
            {
              error: `想定外のメディア形式です（${mimeType}）。画像の Instagram 投稿を指定してください。`,
            },
            { status: 400 }
          );
        }

        messageParts.push({
          text: `\n【mediaIndex: ${imageCount} ／ ${imageCount + 1}番目のメディア（Instagram 画像）】`,
        });
        messageParts.push({
          inlineData: {
            data: base64,
            mimeType,
          },
        });
        previewUrls.push({ url: graphUrl, type: "IMAGE" });
        imageCount++;
      }
    }

    if (files && files.length > 0) {
      messageParts.push({ text: `\n## 解析対象のアップロードメディア（全 ${files.length} 件）` });

      for (const file of files as Array<{
        data: string;
        type: string;
        frames?: { data: string; timeSec: number }[];
        duration?: number;
      }>) {
        const base64Data = file.data.split(",")[1];

        if (file.type.startsWith("video/") && file.frames && file.frames.length > 0) {
          messageParts.push({
            text: `\n【mediaIndex: ${imageCount} ／ ${imageCount + 1}番目のメディア（動画・全長${Math.round(file.duration || 0)}秒）】`,
          });
          messageParts.push({
            inlineData: {
              data: base64Data,
              mimeType: file.type,
            },
          });

          messageParts.push({
            text: `\n### 動画タイムライン参照フレーム（${file.frames.length}枚）\n以下は動画のスクリーンショットです。出力 JSON の timestamp には、**各画像の直前に記載した【N秒目】の N だけ**を使用してください。動画ファイルの再生時間や推測による秒は使わないでください。N と M の両方がこのセクションに現れるラベル秒である場合のみ「N-M」の範囲表記可。どのラベルとも対応できない場合は timestamp を省略してください。`,
          });
          for (const frame of file.frames) {
            const frameBase64 = frame.data.split(",")[1];
            messageParts.push({ text: `\n【${frame.timeSec}秒目】` });
            messageParts.push({
              inlineData: {
                data: frameBase64,
                mimeType: "image/jpeg",
              },
            });
          }
          messageParts.push({
            text: `\n### 参照フレームここまで\n動画指摘の timestamp は、上記【N秒目】のラベル数値のみを根拠に記載すること（動画本体からの時間読取・ラベルにない秒は禁止）。特定できない場合は省略。`,
          });

          previewUrls.push({ url: file.data, type: "VIDEO" });
          imageCount++;
        } else {
          messageParts.push({
            text: `\n【mediaIndex: ${imageCount} ／ ${imageCount + 1}番目のメディア】`,
          });
          messageParts.push({
            inlineData: {
              data: base64Data,
              mimeType: file.type,
            },
          });
          previewUrls.push({
            url: file.data,
            type: file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
          });
          imageCount++;
        }
      }
    }

    const extractRule =
      checkType === "yakki"
        ? "CRITICAL と判定された項目のみを results に含めてください（プロンプトの出力規則に従うこと）。"
        : "CRITICAL および WARNING と判定された項目を results に含めてください。SAFE は results に含めないでください。";

    messageParts.push({
      text: `\n\n## 解析指示:\n${inputDescription}\n\nメディアの総数: ${imageCount} 件。各メディア内のテキストや動画内容を詳細にスキャンしてください。\n${extractRule}\nメディア内の日付（受賞歴など）を判定する際は、上記の「解析コンテキスト」にある解析実行日時および Instagram 投稿日時を基準に、未来か過去かを正しく判断してください。`,
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: messageParts }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    let responseText = result.response.text().trim();

    if (responseText.startsWith("```json")) {
      responseText = responseText.replace(/^```json\n?/, "").replace(/\n?```$/, "");
    } else if (responseText.startsWith("```")) {
      responseText = responseText.replace(/^```\n?/, "").replace(/\n?```$/, "");
    }

    const object = JSON.parse(responseText);

    const payload: Record<string, unknown> = { ...object, caption, checkType };
    if (hasRemoteUrls && previewUrls.length > 0) {
      payload.previewUrls = previewUrls;
    }

    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "エラーが発生しました。";
    console.error("API error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
