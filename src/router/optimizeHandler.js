import {
  listAllMovies,
  getRadarrQualityProfiles,
  editMoviesQualityProfile,
  searchMovies
} from "../tools/radarr.js";
import {
  listAllSeries,
  getSonarrQualityProfiles,
  updateSeries,
  runSeriesSearch
} from "../tools/sonarr.js";
import { pending } from "../state/pending.js";
import { formatBytes } from "../tools/format.js";
import { logError } from "../logger.js";
import { safeEditMessage } from "../telegram/safeEdit.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(n) {
  if (!n || Number.isNaN(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, n));
}

function parseLimit(reference) {
  const match = reference?.match(/(\d{1,2})/);
  return clampLimit(match ? Number(match[1]) : DEFAULT_LIMIT);
}

function extractProfileRequest(reference = "") {
  if (!reference) return { cleaned: "", requested: "" };
  const regex = /\b(?:profile|to)\s+([a-z0-9][a-z0-9 \-+]{1,})$/i;
  const match = reference.match(regex);
  if (!match) return { cleaned: reference.trim(), requested: "" };
  return {
    cleaned: reference.replace(regex, "").trim(),
    requested: match[1].trim()
  };
}

function estimateSavings(bytes) {
  // assume ~35% of current size when downgrading UHD->HD
  return Math.max(0, Math.round(bytes * 0.65));
}

function pickTargetProfile(profiles, targetName) {
  if (!profiles?.length) return null;
  const byId = profiles.find((p) => p.id === Number(targetName));
  if (byId) return byId;
  if (targetName) {
    const byName = profiles.find(
      (p) => p.name?.toLowerCase() === targetName.toLowerCase()
    );
    if (byName) return byName;
  }
  return profiles[0];
}

function getMinSizeBytes(kind) {
  const fallback = Number(process.env.OPTIMIZE_MIN_SIZE_GB || 40);
  const raw =
    kind === "tv"
      ? Number(process.env.OPTIMIZE_TV_MIN_SIZE_GB || process.env.OPTIMIZE_MIN_SIZE_GB || fallback)
      : Number(process.env.OPTIMIZE_MIN_SIZE_GB || 40);
  const gb = Number.isFinite(raw) && raw > 0 ? raw : 40;
  return gb * 1024 * 1024 * 1024;
}

function getTargetProfileName(kind) {
  if (kind === "tv") {
    return process.env.OPTIMIZE_TV_TARGET_PROFILE || process.env.OPTIMIZE_TARGET_PROFILE || "";
  }
  return process.env.OPTIMIZE_TARGET_PROFILE || "";
}

function getSeriesProfileId(series) {
  return (
    Number(series.qualityProfileId) ||
    Number(series.qualityProfile?.id) ||
    0
  );
}

function buildMovieSummary(candidates, targetProfile) {
  const lines = [];
  const totalSavings = candidates.reduce(
    (sum, c) => sum + estimateSavings(c.sizeOnDisk || 0),
    0
  );
  lines.push(
    `🧠 *Optimization candidates* — target profile: *${targetProfile?.name || targetProfile?.id || "unknown"}*`
  );
  lines.push(
    `Showing ${candidates.length} largest movies (size ≥ filter, sorted by size).`
  );
  lines.push(`Potential reclaim: ~${formatBytes(totalSavings)}`);
  lines.push("");

  candidates.forEach((m, idx) => {
    const quality = m.movieFile?.quality?.quality?.name || m.movieFile?.quality?.quality?.name;
    const size = formatBytes(m.sizeOnDisk || 0);
    const estSave = formatBytes(estimateSavings(m.sizeOnDisk || 0));
    lines.push(
      `${idx + 1}. ${m.title}${
        m.year ? ` (${m.year})` : ""
      } — ${size} — ${quality || "unknown"} — est save ${estSave}`
    );
  });

  return lines.join("\n");
}

export async function handleOptimizeMovies(bot, chatId, entities) {
  try {
    const { cleaned, requested } = extractProfileRequest(entities.reference || "");
    const limit = parseLimit(cleaned);
    const minBytes = getMinSizeBytes("movie");

    const [movies, profiles] = await Promise.all([
      listAllMovies(),
      getRadarrQualityProfiles()
    ]);

    const targetProfile = pickTargetProfile(
      profiles,
      requested || getTargetProfileName("movie")
    );

    if (!targetProfile) {
      await bot.sendMessage(
        chatId,
        "No Radarr quality profiles found. Set OPTIMIZE_TARGET_PROFILE or ensure Radarr is reachable."
      );
      return;
    }

    const candidates = movies
      .filter((m) => {
        const size = m.sizeOnDisk || 0;
        const currentProfile =
          Number(m.qualityProfileId) ||
          Number(m.qualityProfile?.id) ||
          0;
        const sameProfile =
          targetProfile && currentProfile === Number(targetProfile.id);
        return size >= minBytes && m.hasFile && !sameProfile;
      })
      .sort((a, b) => (b.sizeOnDisk || 0) - (a.sizeOnDisk || 0))
      .slice(0, limit);

    if (!candidates.length) {
      await bot.sendMessage(chatId, "No movie results available for that query.");
      return;
    }

    const summary = buildMovieSummary(candidates, targetProfile);
    const msg = await bot.sendMessage(chatId, summary, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Optimize all", callback_data: "optm_all" }],
          [{ text: "🗂 Pick titles", callback_data: "optm_pick" }],
          [{ text: "❌ Cancel", callback_data: "optm_cancel" }]
        ]
      }
    });

    pending[chatId] = {
      mode: "optimize_movies",
      kind: "movie",
      candidates,
      selected: [],
      targetProfileId: targetProfile.id,
      summaryMessageId: msg.message_id
    };
  } catch (err) {
    logError(`[optimize] failed: ${err.message}`);
    await bot.sendMessage(chatId, "Unable to prepare optimization right now.");
  }
}

export async function handleOptimizeShows(bot, chatId, entities) {
  try {
    const { cleaned, requested } = extractProfileRequest(entities.reference || "");
    const limit = parseLimit(cleaned);
    const minBytes = getMinSizeBytes("tv");

    const [seriesList, profiles] = await Promise.all([
      listAllSeries(),
      getSonarrQualityProfiles()
    ]);

    const targetProfile = pickTargetProfile(
      profiles,
      requested || getTargetProfileName("tv")
    );

    if (!targetProfile) {
      await bot.sendMessage(
        chatId,
        "No Sonarr quality profiles found. Set OPTIMIZE_TV_TARGET_PROFILE or ensure Sonarr is reachable."
      );
      return;
    }

    const candidates = seriesList
      .filter((s) => {
        const stats = s.statistics || {};
        const size = stats.sizeOnDisk || s.sizeOnDisk || 0;
        const files = stats.episodeFileCount || 0;
        const sameProfile =
          targetProfile && getSeriesProfileId(s) === Number(targetProfile.id);
        return size >= minBytes && files > 0 && !sameProfile;
      })
      .sort(
        (a, b) =>
          (b.statistics?.sizeOnDisk || b.sizeOnDisk || 0) -
          (a.statistics?.sizeOnDisk || a.sizeOnDisk || 0)
      )
      .slice(0, limit);

    if (!candidates.length) {
      await bot.sendMessage(chatId, "No TV results available for that query.");
      return;
    }

    const profileNames = new Map(
      (profiles || []).map((p) => [p.id, p.name || `profile ${p.id}`])
    );

    const summary = buildTvSummary(candidates, targetProfile, profileNames);
    const msg = await bot.sendMessage(chatId, summary, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Optimize all", callback_data: "optm_all" }],
          [{ text: "🗂 Pick titles", callback_data: "optm_pick" }],
          [{ text: "❌ Cancel", callback_data: "optm_cancel" }]
        ]
      }
    });

    pending[chatId] = {
      mode: "optimize_tv",
      kind: "tv",
      candidates,
      selected: [],
      targetProfileId: targetProfile.id,
      summaryMessageId: msg.message_id
    };
  } catch (err) {
    logError(`[optimize_tv] failed: ${err.message}`);
    await bot.sendMessage(chatId, "Unable to prepare TV optimization right now.");
  }
}

function buildPickKeyboard(candidates, selectedIds = []) {
  const rows = candidates.map((c, idx) => [
    {
      text: `${selectedIds.includes(c.id) ? "✅" : "⬜️"} ${idx + 1}. ${c.title}`,
      callback_data: `optm_select|${idx}`
    }
  ]);

  rows.push([
    { text: "▶️ Optimize selected", callback_data: "optm_confirm" },
    { text: "⬅️ Back", callback_data: "optm_pick_cancel" }
  ]);

  rows.push([{ text: "🏁 Optimize all", callback_data: "optm_all" }]);

  return { reply_markup: { inline_keyboard: rows } };
}

function extractSeriesSize(series) {
  return series.statistics?.sizeOnDisk || series.sizeOnDisk || 0;
}

function buildTvSummary(candidates, targetProfile, profileNames = new Map()) {
  const totalSavings = candidates.reduce(
    (sum, c) => sum + estimateSavings(extractSeriesSize(c)),
    0
  );
  const lines = [];
  lines.push(
    `🧠 *TV optimization candidates* — target profile: *${targetProfile?.name || targetProfile?.id || "unknown"}*`
  );
  lines.push(`Showing ${candidates.length} largest series (size ≥ filter, sorted by size).`);
  lines.push(`Potential reclaim: ~${formatBytes(totalSavings)}`);
  lines.push("");

  candidates.forEach((series, idx) => {
    const stats = series.statistics || {};
    const size = formatBytes(extractSeriesSize(series));
    const estSave = formatBytes(estimateSavings(extractSeriesSize(series)));
    const episodes = stats.episodeFileCount || 0;
    const profile =
      series.qualityProfile?.name ||
      profileNames.get(series.qualityProfileId) ||
      series.qualityProfileId ||
      "unknown profile";
    lines.push(
      `${idx + 1}. ${series.title} — ${size} — ${episodes} files — current profile ${profile} — est save ${estSave}`
    );
  });

  return lines.join("\n");
}

export async function handleOptimizeCallback(bot, query) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const state = pending[chatId];

  if (
    !state ||
    (state.mode !== "optimize_movies" && state.mode !== "optimize_tv")
  ) {
    await bot.answerCallbackQuery(query.id, { text: "No optimization pending." });
    return;
  }
  const kind = state.kind || (state.mode === "optimize_tv" ? "tv" : "movie");

  if (data === "optm_cancel") {
    await deleteSelectionMessage(bot, chatId, state);
    await replaceSummaryMessage(
      bot,
      chatId,
      state,
      "❌ Optimization cancelled."
    );
    delete pending[chatId];
    await bot.answerCallbackQuery(query.id, { text: "Cancelled." });
    return;
  }

  if (data === "optm_pick") {
    const label = kind === "tv" ? "series" : "movies";
    const pickMsg = await bot.sendMessage(chatId, `Select ${label} to optimize:`, {
      ...buildPickKeyboard(state.candidates, state.selected)
    });
    state.selectionMessageId = pickMsg.message_id;
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "optm_pick_cancel") {
    if (state.selectionMessageId) {
      try {
        await bot.deleteMessage(chatId, state.selectionMessageId);
      } catch (_) {}
      delete state.selectionMessageId;
    }
    await bot.answerCallbackQuery(query.id, { text: "Back." });
    return;
  }

  if (data.startsWith("optm_select")) {
    const idx = Number(data.split("|")[1]);
    const movie = state.candidates[idx];
    if (!movie) {
      await bot.answerCallbackQuery(query.id, { text: "Invalid movie." });
      return;
    }
    const selected = state.selected || [];
    const pos = selected.indexOf(movie.id);
    if (pos >= 0) {
      selected.splice(pos, 1);
    } else {
      selected.push(movie.id);
    }
    state.selected = selected;
    pending[chatId] = state;
    // Refresh picker keyboard to reflect selection state
    if (state.selectionMessageId) {
      try {
        await bot.editMessageReplyMarkup(
          buildPickKeyboard(state.candidates, selected).reply_markup,
          { chat_id: chatId, message_id: state.selectionMessageId }
        );
      } catch (_) {}
    }
    await bot.answerCallbackQuery(query.id, {
      text: `${selected.length} selected`
    });
    return;
  }

  if (data === "optm_all" || data === "optm_confirm") {
    const ids =
      data === "optm_all" || (state.selected || []).length === 0
        ? state.candidates.map((c) => c.id)
        : state.selected;
    if (!ids.length) {
      await bot.answerCallbackQuery(query.id, { text: "Nothing selected." });
      return;
    }

    await deleteSelectionMessage(bot, chatId, state);

    await bot.answerCallbackQuery(query.id, { text: "Optimizing…" });
    try {
      if (kind === "movie") {
        await editMoviesQualityProfile(ids, state.targetProfileId);
        await searchMovies(ids);
        await replaceSummaryMessage(
          bot,
          chatId,
          state,
          `✅ Optimization started for ${ids.length} movie(s). Radarr will grab smaller releases if available.`
        );
      } else {
        const chosen = ids
          .map((id) => state.candidates.find((c) => c.id === id))
          .filter(Boolean);
        await applyTvQualityProfile(chosen, state.targetProfileId);
        await runSeriesSearch(ids);
        await replaceSummaryMessage(
          bot,
          chatId,
          state,
          `✅ Optimization started for ${ids.length} series. Sonarr will grab smaller releases if available.`
        );
      }
    } catch (err) {
      const detail = err.response?.data
        ? JSON.stringify(err.response.data)
        : err.message;
      logError(`[optimize] apply failed: ${detail}`);
      const serviceName = kind === "movie" ? "Radarr" : "Sonarr";
      await replaceSummaryMessage(
        bot,
        chatId,
        state,
        `❌ Could not start optimization. Check ${serviceName} connectivity and quality profile.`
      );
    }

    delete pending[chatId];
    return;
  }

  await bot.answerCallbackQuery(query.id);
}

async function deleteSelectionMessage(bot, chatId, state) {
  if (state.selectionMessageId) {
    try {
      await bot.deleteMessage(chatId, state.selectionMessageId);
    } catch (_) {}
    delete state.selectionMessageId;
  }
}

async function replaceSummaryMessage(bot, chatId, state, text) {
  if (state.summaryMessageId) {
    try {
      await safeEditMessage(bot, chatId, state.summaryMessageId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [] }
      });
      delete state.summaryMessageId;
      return;
    } catch (err) {
      logError(`[optimize] failed to edit summary message: ${err.message}`);
    }
  }

  await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

async function applyTvQualityProfile(seriesEntries, targetProfileId) {
  for (const series of seriesEntries) {
    if (!series) continue;
    try {
      await updateSeries(series.id, {
        ...series,
        qualityProfileId: targetProfileId
      });
    } catch (err) {
      logError(
        `[optimize_tv] failed to update ${series.title || series.id}: ${err.message}`
      );
    }
  }
}

export async function handleListTvProfiles(bot, chatId) {
  try {
    const profiles = await getSonarrQualityProfiles();
    if (!profiles || profiles.length === 0) {
      await bot.sendMessage(chatId, "No Sonarr quality profiles were found.");
      return;
    }
    const lines = ["📋 *Sonarr quality profiles*"];
    profiles.forEach((p) => {
      lines.push(`• ${p.name || `Profile ${p.id}`} (id ${p.id})`);
    });
    await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    logError(`[optimize_tv] list profiles failed: ${err.message}`);
    await bot.sendMessage(chatId, "Couldn't list Sonarr profiles right now.");
  }
}

export async function handleListMovieProfiles(bot, chatId) {
  try {
    const profiles = await getRadarrQualityProfiles();
    if (!profiles || profiles.length === 0) {
      await bot.sendMessage(chatId, "No Radarr quality profiles were found.");
      return;
    }
    const lines = ["📋 *Radarr quality profiles*"];
    profiles.forEach((p) => {
      lines.push(`• ${p.name || `Profile ${p.id}`} (id ${p.id})`);
    });
    await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    logError(`[optimize_movies] list profiles failed: ${err.message}`);
    await bot.sendMessage(chatId, "Couldn't list Radarr profiles right now.");
  }
}
