import { NextResponse } from "next/server";

// Vercel のタイムアウト設定（Pro/Enterprise用、Hobbyは10s固定）
export const maxDuration = 60;

function normalizeInstagramUsername(raw: string): string {
  return raw.trim().replace(/^@+/u, "");
}

/** URL またはショートコードのみから投稿 ID（ショートコード）を抽出 */
function extractInstagramShortcode(input: string): string | null {
  const s = input.trim();
  const fromPath = s.match(/(?:\/p\/|\/reels\/|\/reel\/)([A-Za-z0-9_-]+)/);
  if (fromPath) return fromPath[1];
  if (/^[A-Za-z0-9_-]{5,}$/.test(s)) return s;
  return null;
}

/** ユーザー名と投稿参照から、oembed・パス解析用の正規 URL を組み立てる */
function buildInstagramUrlFromUsernameAndPostRef(
  usernameRaw: string,
  postUrlOrShortcode: string
): { url: string; error?: string } {
  const username = normalizeInstagramUsername(usernameRaw);
  if (!username) {
    return { url: "", error: "ユーザー名を入力してください。" };
  }
  const shortcode = extractInstagramPostOrReelShortcode(postUrlOrShortcode);
  if (!shortcode) {
    return {
      url: "",
      error:
        "投稿 URL または投稿 ID（ショートコード）を認識できませんでした。`/p/...` 付きの URL、または ID だけでも入力できます。",
    };
  }
  const isReel = /\/reel[s]?\//i.test(postUrlOrShortcode.trim());
  const path = isReel ? `/reel/${shortcode}/` : `/p/${shortcode}/`;
  return { url: `https://www.instagram.com/${username}${path}` };
}

/** リール URL では `reel` パス、`/p/` では `p` パスのショートコードを取る（混在に対応） */
function extractInstagramPostOrReelShortcode(input: string): string | null {
  const s = input.trim();
  const reelFirst = s.match(/\/reel[s]?\/([A-Za-z0-9_-]+)/i);
  if (reelFirst) return reelFirst[1];
  const postFirst = s.match(/\/p\/([A-Za-z0-9_-]+)/i);
  if (postFirst) return postFirst[1];
  return extractInstagramShortcode(s);
}

async function fetchInstagramBusinessMediaDirect(url: string) {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const businessAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  if (!accessToken || accessToken.startsWith("your_")) return { error: "Access Token が未設定です。" };
  if (!businessAccountId || businessAccountId.startsWith("your_")) return { error: "Business Account ID が未設定です。" };

  try {
    const shortcodeMatch = url.match(/(?:\/p\/|\/reels\/|\/reel\/)([A-Za-z0-9_-]+)/);
    const shortcode = shortcodeMatch ? shortcodeMatch[1] : null;

    const usernameMatch = url.match(/instagram\.com\/([^/?#&]+)/);
    let username = usernameMatch ? usernameMatch[1] : null;
    
    if (username === "p" || username === "reels" || username === "reel") {
      username = null;
    }

    if (!shortcode) return { error: "URL から投稿IDを抽出できませんでした。" };

    if (!username) {
      const oembedUrl = `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${accessToken}`;
      const oembedRes = await fetch(oembedUrl);
      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        const authorUrl = oembedData.author_url;
        const uMatch = authorUrl?.match(/instagram\.com\/([^/?#&]+)/);
        username = uMatch ? uMatch[1] : null;
      }
    }

    if (!username) {
      return { error: "ユーザー名が特定できませんでした。URLにユーザー名を含めてください。" };
    }

    const discoveryUrl = `https://graph.facebook.com/v18.0/${businessAccountId}?fields=business_discovery.username(${username}){media{id,media_url,media_type,caption,permalink,timestamp,children{media_url,media_type}}}&access_token=${accessToken}`;
    const discoveryRes = await fetch(discoveryUrl);
    
    if (!discoveryRes.ok) {
      const err = await discoveryRes.json();
      return { error: `Instagramアカウント @${username} の情報にアクセスできませんでした。（エラー: ${err.error?.message || "不明"}）` };
    }

    const discoveryData = await discoveryRes.json();
    const mediaList = discoveryData.business_discovery?.media?.data || [];
    const targetMedia = mediaList.find((m: any) => m.permalink && m.permalink.includes(shortcode));

    if (targetMedia) {
      const mediaItems = targetMedia.children?.data || [
        { media_url: targetMedia.media_url, media_type: targetMedia.media_type }
      ];

      return {
        caption: targetMedia.caption || "",
        author: username,
        media_items: mediaItems,
        timestamp: targetMedia.timestamp,
        success: true
      };
    }

    return { error: `アカウント @${username} の直近の投稿の中に、指定の投稿が見つかりませんでした。` };
  } catch (err: any) {
    return { error: `システムエラー: ${err.message}` };
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const urlRaw = typeof body.url === "string" ? body.url.trim() : "";
    const usernameRaw = typeof body.username === "string" ? body.username : "";
    const postUrlOrShortcode =
      typeof body.postUrlOrShortcode === "string" ? body.postUrlOrShortcode.trim() : "";

    const useSplit = Boolean(normalizeInstagramUsername(usernameRaw)) && Boolean(postUrlOrShortcode);

    let resolvedUrl = urlRaw;
    if (useSplit) {
      const built = buildInstagramUrlFromUsernameAndPostRef(usernameRaw, postUrlOrShortcode);
      if (built.error) {
        return NextResponse.json({ error: built.error }, { status: 400 });
      }
      resolvedUrl = built.url;
    }

    if (!resolvedUrl) {
      return NextResponse.json(
        {
          error:
            "入力が不足しています。投稿 URL を1件入力するか、ユーザー名と投稿 URL（または投稿 ID）の両方を入力してください。",
        },
        { status: 400 }
      );
    }

    const diag = await fetchInstagramBusinessMediaDirect(resolvedUrl);
    if ((diag as any).error) {
      return NextResponse.json({ error: (diag as any).error }, { status: 400 });
    }

    return NextResponse.json(diag);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
