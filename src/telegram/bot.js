import TelegramBot from "node-telegram-bot-api";
import { classifyMessage } from "../llm/classify.js";
import { routeIntent } from "../router/intentRouter.js";
import { handleCallback } from "../router/callbackHandler.js";
import {
  createStatus,
  updateStatus,
  clearStatus
} from "../telegram/statusMessage.js";
import { readFileSync } from "fs";
import path from "path";
import url from "url";
import { logInfo, logError } from "../logger.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")
);

export async function startTelegramBot(config) {
  if (!config.TG_BOT_TOKEN) {
    throw new Error("TG_BOT_TOKEN missing.");
  }

  const bot = new TelegramBot(config.TG_BOT_TOKEN, { polling: true });
  logInfo("[telegram] Bot polling started.");
  

  // After bot starts polling
  bot.on("polling_error", (err = {}) => {
    const message =
      err.message || err.description || "Unknown Telegram polling error";
    const code = err.code || err.response?.body?.error_code || "unknown";

    // Network hiccups (ECONNRESET, timeout, etc.) are expected — log succinctly.
    if (code === "ECONNRESET" || message.includes("ECONNRESET") || code === "EFATAL") {
      logError(`[telegram] Polling transient error (${code}): ${message}`);
      return;
    }

    console.error(err);
  });

  // Send startup message with quick examples
  const examples = [
    "add severance",
    "redo latest bake off",
    "tidy up the block s6",
    "free up disk space",
    "how much free disk space?",
    "delete unregistered torrents"
  ];

  const startup = [
    `🤖 *Media Agent v${pkg.version} is online*`,
    `Time: ${new Date().toLocaleString()}`,
    "",
    "*Try:*",
    ...examples.map((e) => `• ${e}`)
  ].join("\n");

  bot.sendMessage(config.ADMIN_CHAT_ID, startup, { parse_mode: "Markdown" });


  //
  // 🔹 Handle normal messages
  //
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();
    if (!text) return;

    const started = Date.now();
    logInfo(`[msg] chat=${chatId} text="${text.replace(/\s+/g, " ")}"`);

    // 🔹 Create unified status placeholder
    const statusId = await createStatus(
      bot,
      chatId,
      "⏳ *Understanding your request…*"
    );

    // 🔹 Keep typing indicator alive
    let typing = true;
    const interval = setInterval(() => {
      if (typing) bot.sendChatAction(chatId, "typing").catch(() => {});
    }, 1500);

    try {
      // Give time for typing to show
      await new Promise((res) => setTimeout(res, 100));

      // Step 1: Classification
      await updateStatus(bot, chatId, statusId, "🤖 *Classifying intent…*");
      const result = await classifyMessage(config, text);
      logInfo(`[intent] chat=${chatId} intent=${result.intent}`);

      // Step 2: Routing
      await updateStatus(bot, chatId, statusId, "📡 *Routing request…*");
      await routeIntent(bot, chatId, result, statusId);
      await updateStatus(bot, chatId, statusId, "✅ *Request complete.*");
      await clearStatus(bot, chatId, statusId);
      logInfo(`[done] chat=${chatId} intent=${result.intent} ms=${Date.now() - started}`);

    } catch (err) {
      logError(`[error] chat=${chatId} err=${err.message}`);
      await updateStatus(bot, chatId, statusId, "❌ *Error processing request.*");
      await clearStatus(bot, chatId, statusId);
    } finally {
      typing = false;
      clearInterval(interval);
    }
  });

  //
  // 🔹 Handle callback buttons
  //
  bot.on("callback_query", async (query) => {
    logInfo(`[cb] chat=${query.message.chat.id} data=${query.data}`);
    try {
      await handleCallback(bot, query);
    } catch (err) {
      logError(`Callback error: ${err.message}`);
    }
  });
   return bot;
}
