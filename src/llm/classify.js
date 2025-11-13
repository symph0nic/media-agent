import OpenAI from "openai";
import { CLASSIFIER_SYSTEM_PROMPT } from "./prompts.js";

export async function classifyMessage(config, userText) {
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const input = `
SYSTEM:
${CLASSIFIER_SYSTEM_PROMPT}

USER:
${userText}
`.trim();

  const response = await client.responses.create({
    model: config.MODEL,
    input,
    text: {
      format: { type: "json_object" }
    }
  });

  // NEW: use the top-level output_text field
  const jsonText = response.output_text;
  if (!jsonText) {
    throw new Error("Model did not return output_text");
  }

  try {
    return JSON.parse(jsonText);
  } catch (err) {
    console.error("Failed to parse JSON:", jsonText);
    throw err;
  }
}
