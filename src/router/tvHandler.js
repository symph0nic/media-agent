// src/router/tvHandler.js

import {
  getEpisodes,
  findEpisode,
  getSeriesById
} from "../tools/sonarr.js";

import {
  getCurrentlyWatchingShows,
  getAllPlexShows,
  getPlexSeasons,
  fuzzyMatchCW
} from "../tools/plex.js";

import {
  updateStatus,
  clearStatus
} from "../telegram/statusMessage.js";

import {
  yesNoPickKeyboard,
  yesNoPickTidyKeyboard
} from "../telegram/reply.js";

import { pending } from "../state/pending.js";
import { findSeriesInCache } from "../cache/sonarrCache.js";
import { loadConfig } from "../config.js";
import { resolveCWAmbiguous } from "../llm/classify.js";

const config = loadConfig();

async function clearPendingPrompt(bot, chatId) {
  const prev = pending[chatId];
  if (prev?.messageId) {
    try {
      await bot.deleteMessage(chatId, prev.messageId);
    } catch (_) {
      // ignore
    }
  }
  delete pending[chatId];
}

//
// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
//

function formatGb(bytes) {
  if (!bytes || bytes <= 0) return "0Gb";
  const gb = bytes / 1_000_000_000;
  const roundedInt = Math.round(gb);
  if (Math.abs(gb - roundedInt) < 0.05) return `${roundedInt}Gb`;
  return `${gb.toFixed(1)}Gb`;
}

//
// ─────────────────────────────────────────────
//  REDOWNLOAD — ENTRY POINT
// ─────────────────────────────────────────────
//

export async function handleRedownload(bot, chatId, entities, statusId) {
  const title = entities.title;
  const season = Number(entities.seasonNumber);
  const episode = Number(entities.episodeNumber);
  const reference = entities.reference || "";

  console.log("───────────── REDOWNLOAD DEBUG ─────────────");
  console.log("[DEBUG] Incoming:", { title, season, episode, reference });

  // Explicit = full title + S + E
  const hasExplicitTitle = title && title.trim().length > 0;
  const hasExplicitEpisode = season > 0 && episode > 0;

  if (hasExplicitTitle && hasExplicitEpisode) {
    console.log("[resolver] Explicit request → Sonarr flow");
    return _explicitRedownload(bot, chatId, title, season, episode, statusId);
  }

  // Ambiguous fallback
  if (reference.trim().length > 0) {
    console.log("[resolver] Ambiguous request → resolver");
    const resolved = await _ambiguousRedownload(bot, chatId, reference, statusId);

    if (resolved === "fallback") {
      console.log("[resolver] Ambiguous fallback → explicit attempt using reference");
      return await _explicitRedownload(bot, chatId, reference, 0, 0, statusId);
    }
    return;
  }

  // Final fallback
  await bot.sendMessage(chatId, "I couldn’t understand what you want to redownload.");
  console.log("───────────── END DEBUG ─────────────\n");
}

//
// ─────────────────────────────────────────────
//  AMBIGUOUS RESOLVER
// ─────────────────────────────────────────────
//

async function _ambiguousRedownload(bot, chatId, reference, statusId) {
  const config = loadConfig();

  console.log("[resolver] reference =", reference);

  const cw = await getCurrentlyWatchingShows(config);
  console.log("[resolver] Continue Watching count:", cw.length);

  // Literal fuzzy first
  const matches = fuzzyMatchCW(cw, reference.toLowerCase());
  console.log("[resolver] CW fuzzy matches:", matches);

  if (matches.length > 0) {
    console.log("[resolver] Literal fuzzy match hit");
    return await sendResolvedRedownload(bot, chatId, matches[0], matches.slice(1));
  }

  // Call LLM resolver
  console.log("[resolver] No literal matches → invoking LLM");
  const cwOptions = cw.map(item => ({
    title: item.title,
    season: item.seasonNumber,
    episode: item.episodeNumber
  }));

  const llmResult = await resolveCWAmbiguous(config, reference, cwOptions);
  console.log("[resolver] LLM result:", llmResult);

  if (!llmResult || llmResult.best === "none") {
    console.log("[resolver] LLM returned none → fallback");
    return "fallback";
  }

  const best = cw.find(
    x =>
      x.title === llmResult.best.title &&
      x.seasonNumber === llmResult.best.season &&
      x.episodeNumber === llmResult.best.episode
  );

  if (!best) {
    console.log("[resolver] LLM matched nothing in CW list → fallback");
    return "fallback";
  }

  // LLM path = no alternatives
  return await sendResolvedRedownload(bot, chatId, best, []);
}

//
// ─────────────────────────────────────────────
//  SEND RESOLVED CONFIRMATION
// ─────────────────────────────────────────────
//

async function sendResolvedRedownload(bot, chatId, best, alternatives) {
  const msg = `Found *${best.title}* — S${best.seasonNumber}E${best.episodeNumber}
“${best.episodeTitle}”

Redownload this episode?`;

  const buttons = [
    [
      { text: "Yes", callback_data: "redl_yes_resolved" },
      { text: "No", callback_data: "redl_no_resolved" }
    ]
  ];

  if (alternatives.length > 0) {
    buttons.push([{ text: "Pick another", callback_data: "redl_pick_resolved" }]);
  }

  await clearPendingPrompt(bot, chatId);

  const sent = await bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons }
  });

  pending[chatId] = {
    mode: "redownload_resolved",
    best,
    alternatives,
    messageId: sent?.message_id
  };
}

//
// ─────────────────────────────────────────────
//  EXPLICIT REDOWNLOAD WRAPPER
// ─────────────────────────────────────────────
//

async function _explicitRedownload(bot, chatId, title, season, episode, statusId) {
  console.log("[resolver] explicit → full Sonarr flow");
  return await _runFullExplicitRedownload(bot, chatId, title, season, episode, statusId);
}

//
// ─────────────────────────────────────────────
//  FULL EXPLICIT REDOWNLOAD (Sonarr)
// ─────────────────────────────────────────────
//

async function _runFullExplicitRedownload(bot, chatId, title, season, episode, statusId) {
  try {
    console.log("───────────── EXPLICIT REDOWNLOAD (Sonarr) ─────────────");
    console.log("[DEBUG] Searching cache for:", title);

    // 1️⃣ SERIES LOOKUP
    const seriesList = findSeriesInCache(global.sonarrCache || [], title);
    if (!seriesList || seriesList.length === 0) {
      await bot.sendMessage(chatId, `No results for ${title}`);
      return;
    }

    const validSeries = seriesList.filter(s => s.id);
    const selected = validSeries[0];

    if (statusId) {
      await updateStatus(bot, chatId, statusId, `Selected: ${selected.title}\nFetching episodes…`);
    }

    // 2️⃣ EPISODES
    const episodes = await getEpisodes(selected.id);
    if (!episodes || episodes.length === 0) {
      await bot.sendMessage(chatId, `No episodes found for ${selected.title}`);
      return;
    }

    // 3️⃣ MATCH EPISODE
    let matches = [];

    if (season === 0 && episode === 0) {
      console.log("[explicit] No season/episode supplied → skip matching");
    } else {
      matches = findEpisode(episodes, season, episode);
    }

    if (statusId) {
      await updateStatus(bot, chatId, statusId, `Matching episode S${season}E${episode}…`);
    }

    if (matches.length === 0) {
      if (statusId) await clearStatus(bot, chatId, statusId);

      pending[chatId] = {
        mode: "redownload",
        selectedSeries: selected,
        seriesList: validSeries,
        season,
        episode,
        episodeId: 0,
        episodeFileId: 0
      };

      await bot.sendMessage(
        chatId,
        `Warning: Could not find episode S${season}E${episode} for ${selected.title}.`
      );

      return;
    }

    const ep = matches[0];

    // 4️⃣ CONFIRMATION
    if (statusId) {
      await updateStatus(bot, chatId, statusId, "Preparing confirmation…");
      await clearStatus(bot, chatId, statusId);
    }

    await clearPendingPrompt(bot, chatId);

    pending[chatId] = {
      mode: "redownload",
      selectedSeries: selected,
      seriesList: validSeries,
      season,
      episode,
      episodeId: ep.id,
      episodeFileId: ep.episodeFileId || 0
    };

    const sent = await bot.sendMessage(
      chatId,
      `Found ${selected.title} — Season ${season}, Episode ${episode}.\nRedownload this episode?`,
      yesNoPickKeyboard(validSeries)
    );

    pending[chatId].messageId = sent?.message_id;

  } catch (err) {
    console.error("[tvHandler] ERROR (explicit redownload):", err);
    await bot.sendMessage(chatId, "Error during redownload.");
  }

  console.log("───────────── END EXPLICIT REDOWNLOAD ─────────────\n");
}

// ─────────────────────────────────────────────
//  FULLY WATCHED SEASONS WORKFLOW
// ─────────────────────────────────────────────

export async function handleListFullyWatched(bot, chatId) {
  console.log("───────────── FULLY WATCHED DEBUG ─────────────");
  console.log("DEBUG CONFIG:", {
    PLEX_URL: config.PLEX_URL,
    PLEX_TOKEN: !!config.PLEX_TOKEN,
    PLEX_TV_SECTION: config.PLEX_TV_SECTION
  });

  try {
    await bot.sendMessage(
      chatId,
      "Checking Plex and Sonarr for fully watched, fully aired seasons. This may take a few seconds…"
    );

    // 1️⃣ PLEX: get all shows and their fully watched seasons
    const plexShows = await getAllPlexShows(config);
    console.log(`[fw] Plex shows: ${plexShows.length}`);

    const plexShowSeasons = [];

    for (const show of plexShows) {
      const seasons = await getPlexSeasons(config, show.ratingKey);
      if (!seasons || seasons.length === 0) continue;

      const fullyWatched = seasons.filter(
        (s) =>
          s.seasonNumber !== 0 &&
          s.leafCount > 0 &&
          s.viewedLeafCount === s.leafCount
      );

      if (fullyWatched.length > 0) {
        plexShowSeasons.push({
          plexTitle: show.title,
          ratingKey: show.ratingKey,
          seasons: fullyWatched
        });
      }
    }

    console.log(`[fw] Shows with at least one fully watched Plex season: ${plexShowSeasons.length}`);

    if (plexShowSeasons.length === 0) {
      await bot.sendMessage(chatId, "No fully watched seasons found in Plex.");
      console.log("───────────── END FULLY WATCHED DEBUG ─────────────\n");
      return;
    }

    // 2️⃣ SONARR CROSS-REF
    const aggregate = new Map();

    for (const item of plexShowSeasons) {
      const { plexTitle, seasons: plexSeasons } = item;

      const matches = findSeriesInCache(global.sonarrCache || [], plexTitle);
      if (!matches || matches.length === 0) {
        console.log(`[fw] No Sonarr match for Plex show: ${plexTitle}`);
        continue;
      }

      const series = matches[0];
      console.log(`[fw] Plex "${plexTitle}" → Sonarr "${series.title}" (id=${series.id})`);

      const seriesData = await getSeriesById(series.id);
      if (!seriesData || !Array.isArray(seriesData.seasons)) {
        console.log(`[fw] No seasons from Sonarr for id=${series.id}`);
        continue;
      }

      const sonarrSeasons = seriesData.seasons;

      for (const plexSeason of plexSeasons) {
        const sonarrSeason = sonarrSeasons.find(
          (s) => s.seasonNumber === plexSeason.seasonNumber
        );
        if (!sonarrSeason) {
          console.log(
            `[fw] No Sonarr season match for "${series.title}" S${plexSeason.seasonNumber}`
          );
          continue;
        }

        const stats = sonarrSeason.statistics || {};

        // Fully aired? episodeCount == totalEpisodeCount
        if (stats.episodeCount !== stats.totalEpisodeCount) {
          console.log(
            `[fw] Skipping ${series.title} S${sonarrSeason.seasonNumber} – not fully aired (episodeCount=${stats.episodeCount}, total=${stats.totalEpisodeCount})`
          );
          continue;
        }

        // Has files?
        if (!stats.sizeOnDisk || stats.sizeOnDisk <= 0) {
          console.log(
            `[fw] Skipping ${series.title} S${sonarrSeason.seasonNumber} – no sizeOnDisk`
          );
          continue;
        }

        const seriesId = series.id;
        let entry = aggregate.get(seriesId);
        if (!entry) {
          entry = {
            title: series.title,
            seasons: []
          };
          aggregate.set(seriesId, entry);
        }

        entry.seasons.push({
            seasonNumber: sonarrSeason.seasonNumber,
            episodeCount: stats.episodeCount,
            sizeOnDisk: stats.sizeOnDisk
          });
      }
    }

    // 3️⃣ BUILD OUTPUT LIST
    const finalEntries = Array.from(aggregate.values())
      .map((entry) => {
        const bySeason = new Map();
        for (const s of entry.seasons) {
          const existing = bySeason.get(s.seasonNumber);
          if (!existing) {
            bySeason.set(s.seasonNumber, { ...s });
          } else {
            existing.episodeCount += s.episodeCount;
            existing.sizeOnDisk += s.sizeOnDisk;
          }
        }

        const seasons = Array.from(bySeason.values()).sort(
          (a, b) => a.seasonNumber - b.seasonNumber
        );

        const totalEpisodes = seasons.reduce(
          (sum, s) => sum + s.episodeCount,
          0
        );
        const totalSize = seasons.reduce(
          (sum, s) => sum + s.sizeOnDisk,
          0
        );

        return {
          title: entry.title,
          seasons,
          totalEpisodes,
          totalSize
        };
      })
      .filter((entry) => entry.seasons.length > 0)
      .sort((a, b) => a.title.localeCompare(b.title));

    if (finalEntries.length === 0) {
      await bot.sendMessage(
        chatId,
        "No fully watched, fully aired seasons with files were found."
      );
      console.log("───────────── END FULLY WATCHED DEBUG ─────────────\n");
      return;
    }

    // 4️⃣ RENDER PLAIN TEXT
    const lines = [];
    lines.push("Fully watched seasons that are safe to tidy:");
    lines.push("");

    for (const show of finalEntries) {
      lines.push(show.title);
      for (const s of show.seasons) {
        lines.push(
          `- S${s.seasonNumber}: ${s.episodeCount} eps (${formatGb(
            s.sizeOnDisk
          )})`
        );
      }
      lines.push(
        `Total: ${show.totalEpisodes} eps, ${formatGb(show.totalSize)}`
      );
      lines.push("");
    }

    if (lines[lines.length - 1] === "") {
      lines.pop();
    }

    const message = lines.join("\n");
    await bot.sendMessage(chatId, message);

    console.log("───────────── END FULLY WATCHED DEBUG ─────────────\n");
  } catch (err) {
    console.error("[tvHandler] ERROR in handleListFullyWatched:", err);
    await bot.sendMessage(
      chatId,
      "Error while checking fully watched seasons."
    );
    console.log("───────────── END FULLY WATCHED DEBUG ─────────────\n");
  }
}

// ─────────────────────────────────────────────
//  TIDY SEASON WORKFLOW
// ─────────────────────────────────────────────

export async function buildTidyConfirmation(selected, season, config) {
  const seriesId = selected.id;

  // 1️⃣ Get Sonarr episodes
  const episodes = await getEpisodes(seriesId);
  const seasonEps = episodes.filter((e) => e.seasonNumber === season);

  const fileIds = seasonEps
    .filter((e) => e.episodeFileId)
    .map((e) => e.episodeFileId);

  // 2️⃣ Sonarr stats
  const seriesData = await getSeriesById(seriesId);
  const sonarrSeason = seriesData.seasons.find(s => s.seasonNumber === season);

  const sizeOnDisk = sonarrSeason?.statistics?.sizeOnDisk || 0;
  const episodeCount = seasonEps.length;

  // 3️⃣ Plex watched stats
  const plexShows = await getAllPlexShows(config);
  const plexMatch = plexShows.find(
    (p) => p.title.toLowerCase() === selected.title.toLowerCase()
  );

  let watched = 0;
  let total = episodeCount;
  let unwatched = episodeCount;

  if (plexMatch) {
    const plexSeasons = await getPlexSeasons(config, plexMatch.ratingKey);
    const plexSeason = plexSeasons.find((s) => s.seasonNumber === season);

    if (plexSeason) {
      watched = plexSeason.viewedLeafCount;
      total = plexSeason.leafCount;
      unwatched = total - watched;
    }
  }

  const sizeStr = formatGb(sizeOnDisk);

  let msg = `🧹 *Confirm Tidy-Up*\n\n`;
  msg += `Show: *${selected.title}*\n`;
  msg += `Season: *${season}*\n`;
  msg += `Episodes: ${episodeCount}\n`;
  msg += `Watched: ${watched}\n`;
  msg += `Unwatched: ${unwatched}\n`;
  msg += `Size on disk: *${sizeStr}*\n\n`;

  if (unwatched > 0) {
    msg += `⚠️ Some episodes are *not watched*.\n\n`;
  }

  msg += `Delete *all* downloaded files for this season?`;

  return { msg, fileIds, sizeOnDisk };
}

export async function handleTidySeason(bot, chatId, entities, statusId) {
  console.log("───────────── TIDY SEASON DEBUG ─────────────");

  const title = entities.title;
  const season = Number(entities.seasonNumber);

  if (!title) {
    await bot.sendMessage(chatId, "I need a show title to tidy.");
    return;
  }
  if (!season || isNaN(season)) {
    await bot.sendMessage(chatId, "You didn't specify a season number.");
    return;
  }

  try {
    const config = loadConfig();

    if (statusId) {
      await updateStatus(bot, chatId, statusId, "Searching…");
    }

    // Find in cache
    const matches = findSeriesInCache(global.sonarrCache || [], title);

    if (!matches || matches.length === 0) {
      await bot.sendMessage(chatId, `No results for ${title}`);
      return;
    }

    // AUTO-SELECT FIRST MATCH (LIKE REDOWNLOAD)
    const selected = matches[0];
    const validSeries = matches; // for pick-other flow

    // Build tidy confirmation for THIS default selection
    const { msg, fileIds, sizeOnDisk } = await buildTidyConfirmation(
      selected,
      season,
      config
    );

    // Store pending state like redownload
    pending[chatId] = {
      mode: "tidy",
      seriesList: validSeries,
      selectedSeries: selected,
      seriesId: selected.id,
      title: selected.title,
      season,
      fileIds,
      sizeOnDisk
    };

    // Send confirmation with Yes / No / Pick Another
    await bot.sendMessage(chatId, msg, {
      parse_mode: "Markdown",
      ...yesNoPickTidyKeyboard(validSeries)
    });

    if (statusId) await clearStatus(bot, chatId, statusId);
  } catch (err) {
    console.error("[tvHandler] ERROR in handleTidySeason:", err);
    await bot.sendMessage(chatId, "Error preparing tidy-up.");
  }

  console.log("───────────── END TIDY SEASON DEBUG ─────────────\n");
}
