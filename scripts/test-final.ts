import "dotenv/config";
import path from "path";
import dotenv from "dotenv";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import fs from "fs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function testSDKFinal() {
  console.log("--- Vercel AI SDK Final Validation Test ---");
  
  const content: any[] = [
    { type: "text", text: "添付された資料を元に挨拶してください。" }
  ];

  // 1. PDF ファイル（Base64 形式で渡すのが最も安全な場合がある）
  const knowledgeDir = path.resolve(process.cwd(), "knowledge");
  if (fs.existsSync(knowledgeDir)) {
    const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith(".pdf"));
    if (files.length > 0) {
      console.log(`Adding ${files[0]} as Base64 file...`);
      const data = fs.readFileSync(path.join(knowledgeDir, files[0]));
      content.push({
        type: "file",
        data: data.toString("base64"), // Base64 文字列として渡す
        mimeType: "application/pdf"
      });
    }
  }

  try {
    console.log("Calling generateObject with model: gemini-2.0-flash...");
    const { object } = await generateObject({
      model: google("gemini-2.0-flash"),
      schema: z.object({
        message: z.string()
      }),
      messages: [{ role: "user", content: content }]
    });
    console.log("✅ SUCCESS! AI Response:", object.message);
  } catch (err: any) {
    console.error("❌ STILL FAILING:");
    console.error(err.message);
    if (err.errors) console.error(JSON.stringify(err.errors, null, 2));
  }
}

testSDKFinal();
