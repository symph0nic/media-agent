import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { CLASSIFIER_SYSTEM_PROMPT, CW_RESOLVE_PROMPT, TIDY_RESOLVE_PROMPT } from "./prompts.js";

// Once OpenAI quota is exhausted, all subsequent calls go to Claude for this process lifetime
let openaiExhausted = false;

function isQuotaError(err) {
  return err.status === 429 && (
    err.code === "insufficient_quota" ||
    err.error?.code === "insufficient_quota"
  );
}

export async function classifyMessage(config, userText) {
  if (!openaiExhausted) {
    try {
      const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
      const input = `SYSTEM:\n${CLASSIFIER_SYSTEM_PROMPT}\n\nUSER:\n${userText}`.trim();
      const response = await client.responses.create({
        model: config.MODEL,
        input,
        text: { format: { type: "json_object" } }
      });
      const jsonText = response.output_text;
      if (!jsonText) throw new Error("Model did not return output_text");
      console.log("CLASSIFIER RAW OUTPUT:", jsonText);
      return JSON.parse(jsonText);
    } catch (err) {
      if (isQuotaError(err)) {
        console.warn("[LLM] OpenAI quota exhausted — switching to Claude for all remaining calls");
        openaiExhausted = true;
      } else {
        throw err;
      }
    }
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 512,
    system: CLASSIFIER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userText }]
  });
  const jsonText = response.content[0].text;
  console.log("CLASSIFIER (Claude) RAW OUTPUT:", jsonText);
  return JSON.parse(jsonText);
}

export async function resolveCWAmbiguous(config, reference, cwOptions) {
  const filledPrompt = CW_RESOLVE_PROMPT
    .replace("{{REFERENCE}}", reference)
    .replace("{{OPTIONS}}", JSON.stringify(cwOptions, null, 2));

  if (!openaiExhausted) {
    try {
      const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
      const response = await client.responses.create({
        model: config.MODEL,
        input: filledPrompt,
        text: { format: { type: "json_object" } }
      });
      const raw = response.output_text;
      console.log("RESOLVE LLM RAW:", raw);
      try {
        return JSON.parse(raw);
      } catch {
        console.error("[resolveCWAmbiguous] ERROR parsing:", raw);
        return { best: "none" };
      }
    } catch (err) {
      if (isQuotaError(err)) {
        console.warn("[LLM] OpenAI quota exhausted — switching to Claude for all remaining calls");
        openaiExhausted = true;
      } else {
        throw err;
      }
    }
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 512,
    messages: [{ role: "user", content: filledPrompt }]
  });
  const raw = response.content[0].text;
  console.log("RESOLVE (Claude) RAW:", raw);
  try {
    return JSON.parse(raw);
  } catch {
    console.error("[resolveCWAmbiguous] ERROR parsing:", raw);
    return { best: "none" };
  }
}

export async function resolveTidyAmbiguous(config, reference, seasonOptions) {
  const filledPrompt = TIDY_RESOLVE_PROMPT
    .replace("{{REFERENCE}}", reference)
    .replace("{{OPTIONS}}", JSON.stringify(seasonOptions, null, 2));

  if (!openaiExhausted) {
    try {
      const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
      const response = await client.responses.create({
        model: config.MODEL,
        input: filledPrompt,
        text: { format: { type: "json_object" } }
      });
      const raw = response.output_text;
      console.log("RESOLVE TIDY RAW:", raw);
      try {
        return JSON.parse(raw);
      } catch {
        console.error("[resolveTidyAmbiguous] ERROR parsing:", raw);
        return { best: "none" };
      }
    } catch (err) {
      if (isQuotaError(err)) {
        console.warn("[LLM] OpenAI quota exhausted — switching to Claude for all remaining calls");
        openaiExhausted = true;
      } else {
        throw err;
      }
    }
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 512,
    messages: [{ role: "user", content: filledPrompt }]
  });
  const raw = response.content[0].text;
  console.log("RESOLVE TIDY (Claude) RAW:", raw);
  try {
    return JSON.parse(raw);
  } catch {
    console.error("[resolveTidyAmbiguous] ERROR parsing:", raw);
    return { best: "none" };
  }
}
