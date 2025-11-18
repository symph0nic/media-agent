import { pending } from "../state/pending.js";
import {
  getEpisodes,
  findEpisode,
  deleteEpisodeFile,
  runEpisodeSearch,
  getSeriesById,
  updateSeries
} from "../tools/sonarr.js";
import {
  yesNoPickKeyboard,
  seriesSelectionKeyboard,
  yesNoPickTidyKeyboard,
  seriesSelectionTidyKeyboard
} from "../telegram/reply.js";
import { safeEditMessage } from "../telegram/safeEdit.js";
import { buildTidyConfirmation } from "../router/tvHandler.js";
import { loadConfig } from "../config.js";

function formatGb(bytes) {
  if (!bytes || bytes <= 0) return "0Gb";
  const gb = bytes / 1_000_000_000;
  const roundedInt = Math.round(gb);
  if (Math.abs(gb - roundedInt) < 0.05) {
    return `${roundedInt}Gb`;
  }
  return `${gb.toFixed(1)}Gb`;
}

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
// 🔹 USER CONFIRMS: TIDY SEASON
//
if (action === "tidy_yes") {
  const { fileIds, title, season, seriesId, sizeOnDisk } = state;

  try {
    await bot.sendChatAction(chatId, "typing");

    // 1️⃣ Delete episode files
    let deletedCount = 0;
    for (const id of fileIds) {
      try {
        await deleteEpisodeFile(id);
        deletedCount++;
      } catch (err) {
        console.error("Failed to delete file:", id, err);
      }
    }

    // 2️⃣ Fetch full series object (like the n8n GET /series/{id})
    const series = await getSeriesById(seriesId);

    if (!series || !Array.isArray(series.seasons)) {
      throw new Error("Invalid Sonarr series structure");
    }

    // 3️⃣ Modify seasons → set monitored=false for the tidy season
    series.seasons = series.seasons.map(s => {
      if (Number(s.seasonNumber) === Number(season)) {
        s.monitored = false;
      }
      return s;
    });

    // n8n logic: keep overall series monitored = true
    series.monitored = true;

    // 4️⃣ PUT /series/{id} with updated season array
    await updateSeries(seriesId, series);

    // 5️⃣ Success message
    const sizeStr = formatGb(sizeOnDisk);

    const msg =
      `🧹 *Tidy-up complete!*\n\n` +
      `Show: *${title}*\n` +
      `Season: *${season}*\n` +
      `Deleted files: ${deletedCount}\n` +
      `Freed space: *${sizeStr}*\n` +
      `Season is now unmonitored in Sonarr.`;

    await safeEditMessage(
      bot,
      chatId,
      query.message.message_id,
      msg,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("Tidy-up failed:", err);

    await safeEditMessage(
      bot,
      chatId,
      query.message.message_id,
      "❌ Tidy-up failed. Some files or monitoring settings may not have updated."
    );
  }

  delete pending[chatId];
  await bot.answerCallbackQuery(query.id);
  return;
}


  //
  // 🔹 USER CANCELS TIDY SEASON
  //
  if (action === "tidy_no") {
    delete pending[chatId];

    await safeEditMessage(
      bot,
      chatId,
      query.message.message_id,
      "❌ Tidy-up cancelled."
    );

    await bot.answerCallbackQuery(query.id);
    return;
  }

//
// 🔹 USER WANTS TO PICK A DIFFERENT SERIES (TIDY)
//
if (action === "tidy_pick") {
  await safeEditMessage(
    bot,
    chatId,
    query.message.message_id,
    "Select the correct show:",
    seriesSelectionTidyKeyboard(state.seriesList)
  );
  await bot.answerCallbackQuery(query.id);
  return;
}

//
// 🔹 USER SELECTED A SPECIFIC SERIES FOR TIDY
//
if (action === "tidy_select") {
  const seriesId = Number(param);
  const selected = state.seriesList.find((s) => s.id === seriesId);

  if (!selected) {
    await bot.answerCallbackQuery(query.id, { text: "Invalid series." });
    return;
  }

  try {
    const config = loadConfig();
    const { msg, fileIds, sizeOnDisk } = await buildTidyConfirmation(
      selected,
      state.season,
      config
    );

    pending[chatId] = {
      mode: "tidy",
      seriesList: state.seriesList,
      selectedSeries: selected,
      seriesId,
      title: selected.title,
      season: state.season,
      fileIds,
      sizeOnDisk
    };

    await safeEditMessage(
      bot,
      chatId,
      query.message.message_id,
      msg,
      { parse_mode: "Markdown", ...yesNoPickTidyKeyboard(state.seriesList) }
    );
  } catch (err) {
    console.error("Tidy select failed:", err);
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
// 🔹 USER CONFIRMS: TIDY SEASON
//
if (action === "tidy_yes") {
  const { fileIds, title, seriesId, season, sizeOnDisk } = state;

  try {
    await bot.sendChatAction(chatId, "typing");

    // 1️⃣ delete episode files
    let deletedCount = 0;
    for (const id of fileIds) {
      try {
        await deleteEpisodeFile(id);
        deletedCount++;
      } catch (err) {
        console.error("Failed to delete file:", id, err);
      }
    }

    // 2️⃣ unmonitor season
    const series = await getSeriesById(seriesId);

    series.seasons = series.seasons.map((s) => {
      if (Number(s.seasonNumber) === Number(season)) {
        s.monitored = false;
      }
      return s;
    });
    series.monitored = true;

    await updateSeries(seriesId, series);

    const freed = formatGb(sizeOnDisk);

    await safeEditMessage(
      bot,
      chatId,
      query.message.message_id,
      `🧹 *Tidy-up complete!*\n\n` +
        `Show: *${title}*\n` +
        `Season: *${season}*\n` +
        `Deleted files: ${deletedCount}\n` +
        `Freed space: *${freed}*\n` +
        `Season is now unmonitored.`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("Tidy-up failed:", err);
    await safeEditMessage(
      bot,
      chatId,
      query.message.message_id,
      "❌ Tidy-up failed. Some files or monitoring settings may not have updated."
    );
  }

  delete pending[chatId];
  await bot.answerCallbackQuery(query.id);
  return;
}

//
// 🔹 USER CANCELS TIDY
//
if (action === "tidy_no") {
  delete pending[chatId];
  await safeEditMessage(
    bot,
    chatId,
    query.message.message_id,
    "❌ Tidy-up cancelled."
  );
  await bot.answerCallbackQuery(query.id);
  return;
}

//
// 🔹 USER CANCELS PICK ANOTHER SERIES (TIDY)
//
if (action === "tidy_cancelpick") {

  delete pending[chatId];

  await safeEditMessage(
    bot,
    chatId,
    query.message.message_id,
    "❌ Selection cancelled."
  );

  await bot.answerCallbackQuery(query.id);
  return;
}


  //
  // 🔹 DEFAULT FALLBACK
  //
  await bot.answerCallbackQuery(query.id, { text: "Unknown action." });
}
