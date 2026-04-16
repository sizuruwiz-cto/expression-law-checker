import "dotenv/config";
import path from "path";
import dotenv from "dotenv";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import fs from "fs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function testSDKWithGenerateText() {
  console.log("--- Testing with generateText (Supports PDF) ---");
  
  const content: any[] = [
    { type: "text", text: "添付されたPDF資料を元に、薬機法チェックの結果をJSON形式で返してください。" }
  ];

  const knowledgeDir = path.resolve(process.cwd(), "knowledge");
  if (fs.existsSync(knowledgeDir)) {
    const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith(".pdf"));
    if (files.length > 0) {
      console.log(`Adding ${files[0]} as a file part...`);
      const data = fs.readFileSync(path.join(knowledgeDir, files[0]));
      content.push({
        type: "file",
        data: data,
        mimeType: "application/pdf"
      });
    }
  }

  try {
    console.log("Calling generateText...");
    const { text } = await generateText({
      model: google("gemini-2.0-flash"),
      messages: [{ role: "user", content: content }]
    });
    console.log("✅ SUCCESS! AI Response (snippet):", text.substring(0, 100));
  } catch (err: any) {
    console.error("❌ FAILED EVEN WITH generateText:");
    console.error(err.message);
  }
}

testSDKWithGenerateText();
