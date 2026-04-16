import "dotenv/config";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function runTest() {
  const url = "https://www.instagram.com/neon_beautytimes/p/DWQ1fkACQwc/";
  const username = "neon_beautytimes";
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const businessAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  console.log("--- Final Field Test (Target: @neon_beautytimes) ---");

  try {
    const discoveryUrl = `https://graph.facebook.com/v18.0/${businessAccountId}?fields=business_discovery.username(${username}){media{id,media_url,media_type,caption,permalink,timestamp}}&access_token=${accessToken}`;
    const res = await fetch(discoveryUrl);
    const data = await res.json() as any;
    if (res.ok) {
      console.log("✅ Full Discovery Success!");
      console.log("Media Count:", data.business_discovery?.media?.data?.length);
      const target = data.business_discovery?.media?.data?.find((m: any) => m.permalink && m.permalink.includes("DWQ1fkACQwc"));
      if (target) {
        console.log("✅ Found target media!");
      } else {
        console.log("❌ Target media not in current list (last 25).");
      }
    } else {
      console.error("❌ Discovery Failed:", data.error.message);
    }
  } catch (err) {
    console.error("❌ Network Error:", err);
  }
}

runTest();
