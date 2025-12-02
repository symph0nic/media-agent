import { pending } from "../state/pending.js";
import {
  getEpisodes,
  findEpisode,
  deleteEpisodeFile,
  runEpisodeSearch,
  getSeriesById,
  updateSeries
} from "../tools/sonarr.js";
import { emptyRecycleBin } from "../tools/nas.js";
import {
  yesNoPickKeyboard,
  seriesSelectionKeyboard,
  yesNoPickTidyKeyboard,
  seriesSelectionTidyKeyboard,
  nasSelectionKeyboard,
  nasPrimaryKeyboard
} from "../telegram/reply.js";
import { safeEditMessage } from "../telegram/safeEdit.js";
import { buildTidyConfirmation, handleRedownload } from "../router/tvHandler.js";
import { loadConfig } from "../config.js";
import { formatBytes } from "../tools/format.js";
import { handleQbUnregisteredConfirm } from "./qbittorrentHandler.js";
import { findSeriesInCache } from "../cache/sonarrCache.js";
import { handleAddMedia, handleAddMediaCallback } from "./addMediaHandler.js";
import { handleOptimizeCallback } from "./optimizeHandler.js";
import { parseAddCallback, HAVE_ADD_CALLBACK_PREFIX } from "./haveMediaHandler.js";
import { logError } from "../logger.js";
import { handleMovieSeriesCallback } from "../router/movieSeriesHandler.js";
import { startRedownloadMonitor } from "../redownload/redownloadMonitor.js";

function formatGb(bytes) {
  if (!bytes || bytes <= 0) return "0Gb";
  const gb = bytes / 1_000_000_000;
  const roundedInt = Math.round(gb);
  if (Math.abs(gb - roundedInt) < 0.05) {
    return `${roundedInt}Gb`;
  }
  return `${gb.toFixed(1)}Gb`;
}

async function deleteSelectionMessage(bot, chatId, state) {
  if (!state?.selectionMessageId) return;
  try {
    await bot.deleteMessage(chatId, state.selectionMessageId);
  } catch (_) {
    // ignore errors (already removed, etc.)
  }
  delete state.selectionMessageId;
}

async function updateSummaryMessage(bot, chatId, state, text) {
  if (state?.summaryMessageId) {
    await safeEditMessage(
      bot,
      chatId,
      state.summaryMessageId,
      text,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [] }
      }
    );
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  }
}

export async function handleCallback(bot, query) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const state = pending[chatId];

  if (data.startsWith(`${HAVE_ADD_CALLBACK_PREFIX}|`)) {
    const payload = parseAddCallback(data);
    if (!payload?.title) {
      await bot.answerCallbackQuery(query.id, { text: "Missing title." });
      return;
    }

    try {
      await bot.answerCallbackQuery(query.id, { text: "Adding…" });
      await handleAddMedia(bot, chatId, {
        title: payload.title,
        reference: payload.title,
        type: payload.kind === "movie" ? "movie" : "tv",
        seasonNumber: 0,
        episodeNumber: 0
      });
    } catch (err) {
      console.error("[haveMedia] Failed to start add flow:", err);
      await bot.sendMessage(chatId, "Couldn't start the add flow right now.");
    }
    return;
  }

  if (!state) {
    await bot.answerCallbackQuery(query.id, { text: "No active request." });
    return;
  }

  if (data.startsWith("ms_")) {
    const handled = await handleMovieSeriesCallback(bot, query);
    if (handled !== false) {
      await bot.answerCallbackQuery(query.id);
      return;
    }
  }

  // Media add flow shortcuts
  if (data.startsWith("addmedia_")) {
    return handleAddMediaCallback(bot, query);
  }

  // Movie optimization flow
  if (data.startsWith("optm_")) {
    return handleOptimizeCallback(bot, query);
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

      const seriesTitle = state.selectedSeries?.title || "Episode";
      const episodeLabel = `S${state.season}E${state.episode}`;

      if (success && result?.id) {
        await safeEditMessage(
          bot,
          chatId,
          query.message.message_id,
          "🔁 Episode deleted. Monitoring Sonarr for the new download…",
          { reply_markup: { inline_keyboard: [] } }
        );

        startRedownloadMonitor({
          bot,
          chatId,
          messageId: query.message.message_id,
          episodeId,
          commandId: result.id,
          previousFileId: epFileId || 0,
          seriesTitle,
          episodeLabel
        });
      } else if (success) {
        await safeEditMessage(
          bot,
          chatId,
          query.message.message_id,
          "🔁 Episode deleted and redownload started!",
          { reply_markup: { inline_keyboard: [] } }
        );
      } else {
        await safeEditMessage(
          bot,
          chatId,
          query.message.message_id,
          "⚠️ Episode deleted but redownload may not have started.",
          { reply_markup: { inline_keyboard: [] } }
        );
      }
    } catch (err) {
      console.error("Redownload failed:", err);
      await safeEditMessage(
        bot,
        chatId,
        query.message.message_id,
        "❌ Episode could not be deleted. File may not exist.",
        { reply_markup: { inline_keyboard: [] } }
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
// AMBIGUOUS RESOLVED – YES
//
if (data === "redl_yes_resolved") {
  console.log("[callback] redl_yes_resolved");

  const st = pending[chatId];
  if (!st || st.mode !== "redownload_resolved") {
    return bot.sendMessage(chatId, "Sorry, I lost track of what we were doing.");
  }

  const { best } = st;

  const title = best.title;
  const season = best.seasonNumber;
  const episode = best.episodeNumber;

  try {
    const cache = global.sonarrCache || [];
    const seriesList = findSeriesInCache(cache, title);
    const selected = seriesList?.[0];

    if (!selected) {
      await safeEditMessage(
        bot,
        chatId,
        query.message.message_id,
        `Couldn't find "${title}" in Sonarr.`
      );
      delete pending[chatId];
      return;
    }

    const episodes = await getEpisodes(selected.id);
    const matches = findEpisode(episodes, season, episode);
    if (!matches || matches.length === 0) {
      await safeEditMessage(
        bot,
        chatId,
        query.message.message_id,
        `Couldn't find S${season}E${episode} for ${selected.title}.`
      );
      delete pending[chatId];
      return;
    }

    const ep = matches[0];

    // Remove existing file if present
    if (ep.episodeFileId) {
      try {
        await deleteEpisodeFile(ep.episodeFileId);
      } catch (err) {
        console.error("Failed to delete episode file:", err.message);
      }
    }

    const result = await runEpisodeSearch(ep.id);
    const success = ["started", "queued"].includes(result?.status);
    const episodeLabel = `S${season}E${episode}`;

    if (success && result?.id) {
      await safeEditMessage(
        bot,
        chatId,
        query.message.message_id,
        "🔁 Episode deleted. Monitoring Sonarr for the new download…",
        { reply_markup: { inline_keyboard: [] } }
      );

      startRedownloadMonitor({
        bot,
        chatId,
        messageId: query.message.message_id,
        episodeId: ep.id,
        commandId: result.id,
        previousFileId: ep.episodeFileId || 0,
        seriesTitle: selected.title,
        episodeLabel
      });
    } else {
      await safeEditMessage(
        bot,
        chatId,
        query.message.message_id,
        success
          ? "🔁 Redownload started for the latest episode."
          : "⚠️ Episode deletion done, but search may not have started.",
        { reply_markup: { inline_keyboard: [] } }
      );
    }
  } catch (err) {
    console.error("[callback] redl_yes_resolved failed:", err);
    await safeEditMessage(
      bot,
      chatId,
      query.message.message_id,
      "❌ Could not start redownload.",
      { reply_markup: { inline_keyboard: [] } }
    );
  }

  delete pending[chatId];
  return;
}

//
// AMBIGUOUS RESOLVED – NO
//
if (data === "redl_no_resolved") {
  console.log("[callback] redl_no_resolved");

  delete pending[chatId];
  return bot.sendMessage(chatId, "Okay, cancelled.");
}

//
// AMBIGUOUS RESOLVED – PICK ANOTHER
//
if (data === "redl_pick_resolved") {
  console.log("[callback] redl_pick_resolved");

  const st = pending[chatId];
  if (!st || st.mode !== "redownload_resolved") {
    return bot.sendMessage(chatId, "Sorry, I lost track of the alternatives.");
  }

  const { alternatives } = st;

  if (!alternatives || alternatives.length === 0) {
    return bot.sendMessage(chatId, "No other matching shows.");
  }

  // Build list of alternative buttons
  const buttons = alternatives.map(alt => ([
    {
      text: `${alt.title} S${alt.seasonNumber}E${alt.episodeNumber}`,
      callback_data: `redl_pick_specific_${alt.ratingKey}`
    }
  ]));

  // Add cancel
  buttons.push([{ text: "Cancel", callback_data: "redl_cancel_resolved" }]);

  return bot.sendMessage(chatId, "Which show did you mean?", {
    reply_markup: { inline_keyboard: buttons }
  });
}

//
// PICK SPECIFIC ALTERNATIVE
//
if (data.startsWith("redl_pick_specific_")) {
  const ratingKey = data.replace("redl_pick_specific_", "");
  console.log("[callback] redl_pick_specific →", ratingKey);

  const st = pending[chatId];
  if (!st || st.mode !== "redownload_resolved") {
    return bot.sendMessage(chatId, "Sorry, I don't have the alternative list anymore.");
  }

  const chosen = st.alternatives.find(a => a.ratingKey === ratingKey);
  if (!chosen) {
    return bot.sendMessage(chatId, "Couldn't find that episode anymore.");
  }

  delete pending[chatId];

  // Now run explicit redownload with the chosen match
  return handleRedownload(bot, chatId, {
    title: chosen.title,
    seasonNumber: chosen.seasonNumber,
    episodeNumber: chosen.episodeNumber,
    reference: chosen.title
  });
}

//
// CANCEL (resolved path)
//
if (data === "redl_cancel_resolved") {
  console.log("[callback] redl_cancel_resolved");

  delete pending[chatId];
  return bot.sendMessage(chatId, "Cancelled.");
}


   //
// 🔹 USER CONFIRMS: TIDY SEASON
//
if (action === "tidy_yes") {
  const { fileIds, title, season, seriesId, sizeOnDisk } = state;

  try {
    try {
      await bot.answerCallbackQuery(query.id, { text: "Tidying season…" });
    } catch (ackErr) {
      console.error("Failed to acknowledge tidy callback:", ackErr?.message || ackErr);
    }

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
    const targetSeason = Number(season);
    series.seasons = series.seasons.map((s) => ({
      ...s,
      monitored: Number(s.seasonNumber) === targetSeason ? false : s.monitored
    }));

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
// 🔹 NAS RECYCLE BIN — CLEAR ALL
//
if (action === "nas_clear_all") {
  if (!state || state.mode !== "nas_empty") {
    await bot.answerCallbackQuery(query.id, { text: "No recycle-bin request pending." });
    return;
  }

  await bot.answerCallbackQuery(query.id, { text: "Starting cleanup…" });

  try {
    await bot.sendChatAction(chatId, "typing");
    const config = loadConfig();
    await updateSummaryMessage(
      bot,
      chatId,
      state,
      "🧼 Clearing all NAS recycle bins… please wait."
    );

    const results = [];
    for (const bin of state.bins || []) {
      const deletedEntries = await emptyRecycleBin(bin.recyclePath, config);
      results.push({
        share: bin.share,
        deletedEntries,
        freedBytes: bin.summary?.totalBytes ?? 0
      });
    }

    const totalFreed = results.reduce((sum, r) => sum + r.freedBytes, 0);

    const lines = [];
    lines.push("🧼 *Cleared all NAS recycle bins!*");
    lines.push(`Freed approximately *${formatBytes(totalFreed)}*`);
    lines.push("");
    for (const res of results) {
      lines.push(
        `• ${res.share}: removed ${res.deletedEntries} top-level entries (${formatBytes(
          res.freedBytes
        )})`
      );
    }

    await updateSummaryMessage(bot, chatId, state, lines.join("\n"));
    await deleteSelectionMessage(bot, chatId, state);
  } catch (err) {
    console.error("[callback] Failed to empty NAS recycle bins:", err);
    await updateSummaryMessage(
      bot,
      chatId,
      state,
      "❌ Could not empty the NAS recycle bins. Check NAS access and try again."
    );
  }

  delete pending[chatId];
  return;
}

//
// 🔹 NAS RECYCLE BIN — PICK SHARE
//
if (action === "nas_clear_pick") {
  if (!state || state.mode !== "nas_empty") {
    await bot.answerCallbackQuery(query.id, { text: "No recycle-bin request pending." });
    return;
  }

  await deleteSelectionMessage(bot, chatId, state);

  const pickList = state.filteredBins?.length ? state.filteredBins : state.bins || [];
  if (!pickList.length) {
    await bot.answerCallbackQuery(query.id, { text: "No recycle-bin request pending." });
    return;
  }

  const pickMsg = await bot.sendMessage(chatId, "Select which recycle bin to empty:", {
    ...nasSelectionKeyboard(pickList, state.hasSkipped)
  });
  state.selectionMessageId = pickMsg.message_id;
  await bot.answerCallbackQuery(query.id);
  return;
}

//
// 🔹 NAS RECYCLE BIN — CLEAR SPECIFIC SHARE
//
if (action === "nas_clear_select") {
  if (!state || state.mode !== "nas_empty") {
    await bot.answerCallbackQuery(query.id, { text: "No recycle-bin request pending." });
    return;
  }

  const binIndex = Number(param);
  const pickList = state.filteredBins?.length ? state.filteredBins : state.bins || [];
  const bin = pickList[binIndex];

  if (!bin) {
    await bot.answerCallbackQuery(query.id, { text: "Invalid recycle bin." });
    return;
  }

  await bot.answerCallbackQuery(query.id, { text: "Deleting…" });

  try {
    await bot.sendChatAction(chatId, "typing");
    const config = loadConfig();
    await updateSummaryMessage(
      bot,
      chatId,
      state,
      `🧼 Clearing recycle bin for *${bin.share}*… please wait.`
    );
    const deletedEntries = await emptyRecycleBin(bin.recyclePath, config);

    const successText =
      `🧼 *${bin.share}* recycle bin emptied!\n\n` +
      `Removed entries: ${deletedEntries}\n` +
      `Approx. freed space: *${formatBytes(bin.summary?.totalBytes ?? 0)}*`;

    await updateSummaryMessage(bot, chatId, state, successText);
    await deleteSelectionMessage(bot, chatId, state);
  } catch (err) {
    console.error("[callback] Failed to empty NAS recycle bin:", err);
    await updateSummaryMessage(
      bot,
      chatId,
      state,
      `❌ Could not empty the recycle bin for ${bin.share}.`
    );
  }

  delete pending[chatId];
  return;
}

//
// 🔹 NAS RECYCLE BIN — CANCEL PICK FLOW
//
if (action === "nas_clear_pick_cancel") {
  await deleteSelectionMessage(bot, chatId, state);
  await bot.answerCallbackQuery(query.id, { text: "Cancelled." });
  return;
}

//
// 🔹 NAS RECYCLE BIN — CANCEL ALL
//
if (action === "nas_clear_cancel") {
  delete pending[chatId];
  await safeEditMessage(bot, chatId, query.message.message_id, "❌ Recycle-bin cleanup cancelled.");
  await deleteSelectionMessage(bot, chatId, state);
  await bot.answerCallbackQuery(query.id);
  return;
}

//
// 🔹 NAS RECYCLE BIN — SHOW ALL (include skipped tiny bins)
//
if (action === "nas_show_all") {
  const st = pending[chatId];
  if (!st || st.mode !== "nas_empty") {
    await bot.answerCallbackQuery(query.id, { text: "No recycle-bin request pending." });
    return;
  }

  const bins = st.bins || [];
  const lines = [];
  lines.push("🗑 *NAS Recycle Bins (all)*");
  lines.push(`Detected bins: ${bins.length}`);
  const totalBytes = bins.reduce((sum, b) => sum + (b.summary?.totalBytes || 0), 0);
  const totalFiles = bins.reduce((sum, b) => sum + (b.summary?.totalFiles || 0), 0);
  lines.push(`Total files: ${totalFiles}`);
  lines.push(`Approximate size: *${formatBytes(totalBytes)}*`);
  lines.push("");

  bins.forEach((bin, idx) => {
    lines.push(`${idx + 1}. *${bin.share}*`);
    lines.push(`   Path: \`${bin.recyclePath}\``);
    lines.push(`   Entries: ${bin.summary.entryCount} (${bin.summary.totalFiles} files)`);
    lines.push(`   Size: *${formatBytes(bin.summary.totalBytes)}*`);
    const preview = (bin.summary.preview || [])
      .slice(0, 3)
      .map((entry) => `${entry.name} (${formatBytes(entry.sizeBytes)})`);
    if (preview.length) {
      lines.push(`   Examples: ${preview.join(", ")}`);
    }
    lines.push("");
  });

  lines.push("Clear everything, pick a specific bin, or cancel. Deletions cannot be undone.");

  await safeEditMessage(bot, chatId, query.message.message_id, lines.join("\n"), {
    parse_mode: "Markdown",
    ...nasPrimaryKeyboard(false)
  });

  pending[chatId] = {
    ...st,
    filteredBins: bins,
    autoSkipped: [],
    summaryMessageId: query.message.message_id
  };

  await bot.answerCallbackQuery(query.id);
  return;
}

//
// 🔹 QBittorrent — delete unregistered
//
if (data === "qb_unreg_yes") {
  if (!state || state.mode !== "qb_unregistered") {
    await bot.answerCallbackQuery(query.id, { text: "No pending qBittorrent cleanup." });
    return;
  }

  await bot.answerCallbackQuery(query.id, { text: "Deleting…" });

  if (state.summaryMessageId) {
    await safeEditMessage(
      bot,
      chatId,
      state.summaryMessageId,
      "♻️ Deleting unregistered torrents…",
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [] } }
    );
  }

  await handleQbUnregisteredConfirm(bot, chatId, state);
  return;
}

if (data === "qb_unreg_no") {
  delete pending[chatId];
  await safeEditMessage(bot, chatId, query.message.message_id, "❌ qBittorrent cleanup cancelled.");
  await bot.answerCallbackQuery(query.id);
  return;
}


  //
  // 🔹 DEFAULT FALLBACK
  //
  await bot.answerCallbackQuery(query.id, { text: "Unknown action." });
}
