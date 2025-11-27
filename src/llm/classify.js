import OpenAI from "openai";
import { CLASSIFIER_SYSTEM_PROMPT, CW_RESOLVE_PROMPT, TIDY_RESOLVE_PROMPT } from "./prompts.js";

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
    console.log("CLASSIFIER RAW OUTPUT:", jsonText);
    return JSON.parse(jsonText);
  } catch (err) {
    console.error("Failed to parse JSON:", jsonText);
    throw err;
  }
}

export async function resolveCWAmbiguous(config, reference, cwOptions) {
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const filledPrompt = CW_RESOLVE_PROMPT
    .replace("{{REFERENCE}}", reference)
    .replace("{{OPTIONS}}", JSON.stringify(cwOptions, null, 2));

  const response = await client.responses.create({
    model: config.MODEL,
    input: filledPrompt,
    text: {
      format: { type: "json_object" }
    }
  });

  const raw = response.output_text;
  console.log("RESOLVE LLM RAW:", raw);

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("[resolveCWAmbiguous] ERROR parsing:", raw);
    return { best: "none" };
  }
}

export async function resolveTidyAmbiguous(config, reference, seasonOptions) {
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const filledPrompt = TIDY_RESOLVE_PROMPT
    .replace("{{REFERENCE}}", reference)
    .replace("{{OPTIONS}}", JSON.stringify(seasonOptions, null, 2));

  const response = await client.responses.create({
    model: config.MODEL,
    input: filledPrompt,
    text: {
      format: { type: "json_object" }
    }
  });

  const raw = response.output_text;
  console.log("RESOLVE TIDY RAW:", raw);

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("[resolveTidyAmbiguous] ERROR parsing:", raw);
    return { best: "none" };
  }
}
