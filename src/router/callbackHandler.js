import { pending } from "../state/pending.js";
import {
  getEpisodes,
  findEpisode,
  deleteEpisodeFile,
  runEpisodeSearch
} from "../tools/sonarr.js";
import {
  yesNoPickKeyboard,
  seriesSelectionKeyboard
} from "../telegram/reply.js";
import { safeEditMessage } from "../telegram/safeEdit.js";

export async function handleCallback(bot, query) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const state = pending[chatId];

  if (!state) {
    await bot.answerCallbackQuery(query.id, { text: "No active request." });
    return;
  }

  const [action, param] = data.split("|");

  //
  // 🔹 USER CONFIRMS: REDOWNLOAD
  //
  if (action === "redl_yes") {
    const epFileId = state.episodeFileId;
    const episodeId = state.episodeId;

    try {
      await bot.sendChatAction(chatId, "typing");

      // 1️⃣ Delete existing file (if present)
      if (epFileId) {
        await deleteEpisodeFile(epFileId);
      }

      // 2️⃣ Trigger episode search
      const result = await runEpisodeSearch(episodeId);
      const success = ["started", "queued"].includes(result?.status);

      if (success) {
        await safeEditMessage(
          bot,
          chatId,
          query.message.message_id,
          "🔁 Episode deleted and redownload started!"
        );
      } else {
        await safeEditMessage(
          bot,
          chatId,
          query.message.message_id,
          "⚠️ Episode deleted but redownload may not have started."
        );
      }
    } catch (err) {
      console.error("Redownload failed:", err);
      await safeEditMessage(
        bot,
        chatId,
        query.message.message_id,
        "❌ Episode could not be deleted. File may not exist."
      );
    }

    delete pending[chatId];
    await bot.answerCallbackQuery(query.id);
    return;
  }

  //
  // 🔹 USER CANCELS
  //
  if (action === "redl_no" || action === "redl_cancel") {
    delete pending[chatId];

    await safeEditMessage(
      bot,
      chatId,
      query.message.message_id,
      "❌ Cancelled."
    );

    await bot.answerCallbackQuery(query.id);
    return;
  }

  //
  // 🔹 USER WANTS TO PICK A DIFFERENT SHOW
  //
  if (action === "redl_pick") {
    await safeEditMessage(
      bot,
      chatId,
      query.message.message_id,
      "Select the correct show:",
      seriesSelectionKeyboard(state.seriesList)
    );

    await bot.answerCallbackQuery(query.id);
    return;
  }

  //
  // 🔹 USER SELECTED A SPECIFIC SERIES FROM THE LIST
  //
  if (action === "redl_select") {
    const seriesId = Number(param);
    const selected = state.seriesList.find((s) => s.id === seriesId);

    if (!selected) {
      await bot.answerCallbackQuery(query.id, { text: "Invalid series." });
      return;
    }

    state.selectedSeries = selected;

    try {
      await bot.sendChatAction(chatId, "typing");

      // Re-fetch episodes for this newly chosen series
      const episodes = await getEpisodes(seriesId);
      const matches = findEpisode(
        episodes,
        state.season,
        state.episode
      );

      if (matches.length === 0) {
        // No specific episode found → still fire search
        await runEpisodeSearch(0);
        delete pending[chatId];

        await safeEditMessage(
          bot,
          chatId,
          query.message.message_id,
          "⚠️ Episode not found — search triggered anyway."
        );

        await bot.answerCallbackQuery(query.id);
        return;
      }

      const ep = matches[0];
      state.episodeId = ep.id;
      state.episodeFileId = ep.episodeFileId || 0;

      const text = `Found *${selected.title}* — Season ${state.season}, Episode ${state.episode}.\nRedownload this episode?`;

      await safeEditMessage(
        bot,
        chatId,
        query.message.message_id,
        text,
        {
          parse_mode: "Markdown",
          ...yesNoPickKeyboard(state.seriesList)
        }
      );
    } catch (err) {
      console.error("Series reselect failed:", err);

      await safeEditMessage(
        bot,
        chatId,
        query.message.message_id,
        "❌ Could not load episodes for the selected series."
      );
    }

    await bot.answerCallbackQuery(query.id);
    return;
  }

  //
  // 🔹 DEFAULT FALLBACK
  //
  await bot.answerCallbackQuery(query.id, { text: "Unknown action." });
}
