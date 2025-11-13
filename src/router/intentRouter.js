import { handleRedownload } from "./tvHandler.js";
import { clearStatus } from "../telegram/statusMessage.js";


export async function routeIntent(bot, chatId, intentResult, statusId) {
  const { intent, entities } = intentResult;

  switch (intent) {

    case "add_movie":
      await bot.sendMessage(
        chatId,
        `🎬 Add movie: *${entities.title}* (${entities.year ?? "unknown"})`,
        { parse_mode: "Markdown" }
      );
      break;

    case "add_tv":
      await bot.sendMessage(
        chatId,
        `📺 Add TV show: *${entities.title}*`,
        { parse_mode: "Markdown" }
      );
      break;

    case "tidy_tv":
      await bot.sendMessage(
        chatId,
        `🧹 Tidy TV: *${entities.title}* (season ${entities.seasonNumber})`,
        { parse_mode: "Markdown" }
      );
      break;

    case "redownload_tv":
      return handleRedownload(bot, chatId, entities, statusId);

    case "nas_empty_recycle_bin":
      await bot.sendMessage(chatId, "🗑 Recycle bin empty pending implementation.");
      break;

    case "list_fully_watched_tv":
      await bot.sendMessage(chatId, "👀 Checking fully watched TV seasons (not implemented).");
      break;

    case "help":
      await bot.sendMessage(chatId, "ℹ️ Commands: redownload, add tv, add movie, tidy…");
      break;

    default:
      await bot.sendMessage(chatId, "🤖 I didn't understand that.");
      break;
  }

  // Cleanup status for simple commands
  if (statusId) {
    await clearStatus(bot, chatId, statusId);
  }
}
