import "dotenv/config";
import path from "path";
import dotenv from "dotenv";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import fs from "fs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function testSDKValidation() {
  console.log("--- Vercel AI SDK Validation Test ---");
  
  const content: any[] = [
    { type: "text", text: "薬機法チェックをしてください。" }
  ];

  // 1. PDF ファイルのシミュレーション
  const knowledgeDir = path.resolve(process.cwd(), "knowledge");
  if (fs.existsSync(knowledgeDir)) {
    const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith(".pdf"));
    if (files.length > 0) {
      console.log(`Adding ${files[0]} as a file part...`);
      const data = fs.readFileSync(path.join(knowledgeDir, files[0]));
      // Buffer を直接渡す（これが推奨される形式）
      content.push({
        type: "file",
        data: data, 
        mimeType: "application/pdf"
      });
    }
  }

  // 2. URL (Instagram) のシミュレーション
  // SDK は外部 URL の場合、明示的に URL オブジェクトにする必要がある場合がある
  const testUrl = "https://www.instagram.com/static/images/ico/favicon-192.png/bdfa1345a511.png";
  console.log("Adding image URL part...");
  content.push({
    type: "image",
    image: new URL(testUrl)
  });

  try {
    console.log("Calling generateObject...");
    const { object } = await generateObject({
      model: google("gemini-2.5-pro"),
      schema: z.object({
        summary: z.string()
      }),
      messages: [{ role: "user", content: content }]
    });
    console.log("✅ Success! Response:", object.summary);
  } catch (err: any) {
    console.error("❌ SDK Error Detected:");
    console.error(err.message);
    if (err.errors) {
      console.error(JSON.stringify(err.errors, null, 2));
    }
  }
}

testSDKValidation();
