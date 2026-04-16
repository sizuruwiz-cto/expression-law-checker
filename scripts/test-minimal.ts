import "dotenv/config";
import path from "path";
import dotenv from "dotenv";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function testSDKMinimal() {
  console.log("--- Testing Minimal Message Schema ---");
  
  try {
    const { text } = await generateText({
      model: google("gemini-2.0-flash"),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Hello" }
          ]
        }
      ]
    });
    console.log("✅ Basic connectivity OK.");

    console.log("Testing with file part (SDK style)...");
    const { text: text2 } = await generateText({
      model: google("gemini-2.0-flash"),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Check this" },
            // SDKのドキュメントによれば、fileではなく
            // 実際には URL か Buffer を直接 text/image 以外として渡す必要がある場合がある
            // または mimeType を持つ特殊なオブジェクト
            {
              type: "file",
              data: Buffer.from("test"),
              mimeType: "text/plain"
            } as any
          ]
        }
      ]
    });
    console.log("✅ File part connectivity OK.");
  } catch (err: any) {
    console.error("❌ FAILED:");
    console.error(err.message);
  }
}

testSDKMinimal();
