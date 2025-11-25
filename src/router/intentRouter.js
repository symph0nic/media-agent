// src/router/intentRouter.js
import {
  handleRedownload,
  handleListFullyWatched,
  handleTidySeason
} from "./tvHandler.js";
import { handleNasRecycleBin, handleNasFreeSpace } from "./nasHandler.js";
import { handleQbUnregistered } from "./qbittorrentHandler.js";
import { handleAddMedia } from "./addMediaHandler.js";
import { handleShowTop } from "./topHandler.js";

export async function routeIntent(bot, chatId, intentResult, statusId) {
  const { intent, entities,reference } = intentResult;

  entities.reference = reference;

  switch (intent) {
    case "add_media":
    case "add_movie":
    case "add_tv":
      entities.type =
        intent === "add_movie" ? "movie" : intent === "add_tv" ? "tv" : entities.type || "auto";
      return handleAddMedia(bot, chatId, entities);

    case "tidy_tv":
      return handleTidySeason(bot, chatId, entities, statusId);
;

    case "redownload_tv":
      // pass statusId if you’re already using it in bot.js; if not, just drop statusId
      return handleRedownload(bot, chatId, entities, statusId);

    case "nas_empty_recycle_bin":
      return handleNasRecycleBin(bot, chatId);

    case "nas_check_free_space":
      return handleNasFreeSpace(bot, chatId);

    case "qb_delete_unregistered":
      return handleQbUnregistered(bot, chatId, "all");

    case "qb_delete_unregistered_tv":
      return handleQbUnregistered(bot, chatId, "tv");

    case "qb_delete_unregistered_movies":
      return handleQbUnregistered(bot, chatId, "movies");

    case "show_largest_tv":
      return handleShowTop(bot, chatId, { scope: "tv", metric: "size", reference });
    case "show_largest_movies":
      return handleShowTop(bot, chatId, { scope: "movie", metric: "size", reference });
    case "show_top_rated_tv":
      return handleShowTop(bot, chatId, { scope: "tv", metric: "rating", reference });
    case "show_top_rated_movies":
      return handleShowTop(bot, chatId, { scope: "movie", metric: "rating", reference });

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
