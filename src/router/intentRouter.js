// src/router/intentRouter.js
import { handleRedownload, handleListFullyWatched, handleTidySeason } from "./tvHandler.js";

export async function routeIntent(bot, chatId, intentResult, statusId) {
  const { intent, entities } = intentResult;

  switch (intent) {
    case "add_movie":
      return bot.sendMessage(
        chatId,
        `Add movie: ${entities.title} (${entities.year ?? "year unknown"})`
      );

    case "add_tv":
      return bot.sendMessage(
        chatId,
        `Add TV show: ${entities.title}`
      );

    case "tidy_tv":
      return handleTidySeason(bot, chatId, entities, statusId);
;

    case "redownload_tv":
      // pass statusId if you’re already using it in bot.js; if not, just drop statusId
      return handleRedownload(bot, chatId, entities, statusId);

    case "nas_empty_recycle_bin":
      return bot.sendMessage(chatId, "Empty NAS recycle bin? (not implemented yet)");

    case "list_fully_watched_tv":
      return handleListFullyWatched(bot, chatId);

    case "help":
      return bot.sendMessage(
        chatId,
        "Available commands: add tv, add movie, tidy, redownload, list fully watched…"
      );

    default:
      return bot.sendMessage(chatId, "Sorry, I didn’t understand that.");
  }
}
