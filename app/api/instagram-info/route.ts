import { NextResponse } from "next/server";

// Vercel のタイムアウト設定（Pro/Enterprise用、Hobbyは10s固定）
export const maxDuration = 60;

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
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: "URLが必要です。" }, { status: 400 });

    const diag = await fetchInstagramBusinessMediaDirect(url);
    if ((diag as any).error) {
      return NextResponse.json({ error: (diag as any).error }, { status: 400 });
    }

    return NextResponse.json(diag);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
