import { findSeriesInCache } from "../cache/sonarrCache.js";
import { getSeriesById } from "../tools/sonarr.js";
import { listAllMovies } from "../tools/radarr.js";
import { getAllPlexShows, getPlexSeasons } from "../tools/plex.js";
import { loadConfig } from "../config.js";
import { formatBytes } from "../tools/format.js";

const config = loadConfig();
const HAVE_ADD_PREFIX = "haveadd";

const DEFAULT_SHOW_SEASONS = 5;

function encodeTitle(title = "") {
  const base = Buffer.from(title, "utf8").toString("base64");
  return base.replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeTitle(encoded = "") {
  let str = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64").toString("utf8");
}

export function buildAddKeyboard(kind, title) {
  if (!title) return undefined;
  const payload = `${HAVE_ADD_PREFIX}|${kind}|${encodeTitle(title)}`;
  return {
    inline_keyboard: [
      [
        {
          text: `➕ Add to ${kind === "movie" ? "Radarr" : "Sonarr"}`,
          callback_data: payload
        }
      ]
    ]
  };
}

export function parseAddCallback(data) {
  const parts = data.split("|");
  if (parts.length !== 3) return null;
  const [, kind, encodedTitle] = parts;
  if (!kind || !encodedTitle) return null;
  return {
    kind,
    title: decodeTitle(encodedTitle)
  };
}

function inferKind(entities) {
  const typed = (entities.type || "").toLowerCase();
  if (typed === "tv" || typed === "movie") return typed;
  // Basic fallback: assume TV by default
  return "tv";
}

export async function handleHaveMedia(bot, chatId, entities) {
  const reference = (entities.reference || entities.title || "").trim();
  const title = (entities.title || entities.reference || "").trim();
  if (!reference && !title) {
    await bot.sendMessage(chatId, "I need a show or movie title to check.");
    return;
  }

  const kind = inferKind(entities);

  if (kind === "movie") {
    await respondMovieStatus(bot, chatId, title || reference);
  } else {
    await respondTvStatus(bot, chatId, title || reference, Number(entities.seasonNumber) || 0);
  }
}

async function respondTvStatus(bot, chatId, title, requestedSeason) {
  const cache = global.sonarrCache || [];
  const matches = findSeriesInCache(cache, title);
  if (!matches || matches.length === 0) {
    await bot.sendMessage(
      chatId,
      `I couldn't find *${title}* in Sonarr yet.`,
      {
        parse_mode: "Markdown",
        reply_markup: buildAddKeyboard("tv", title)
      }
    );
    return;
  }

  const selected = matches[0];
  try {
    const [series, plexStats] = await Promise.all([
      getSeriesById(selected.id),
      fetchPlexStats(selected.title)
    ]);
    if (looksCleanedUp(series)) {
      await bot.sendMessage(
        chatId,
        [
          `It looks like we finished watching *${series.title}* and cleaned it up.`,
          "It's still in Sonarr but everything is unmonitored and there are no files left.",
          "Just ask me to add it again if you want it back."
        ].join(" "),
        { parse_mode: "Markdown" }
      );
      return;
    }
    const message = buildTvSummary(series, plexStats, requestedSeason);
    await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("[haveMedia] Failed building TV summary:", err.message);
    await bot.sendMessage(
      chatId,
      "I had trouble checking Sonarr. Try again in a moment."
    );
  }
}

async function respondMovieStatus(bot, chatId, title) {
  try {
    const movies = await listAllMovies();
    if (!Array.isArray(movies) || movies.length === 0) {
      throw new Error("Radarr returned no movies");
    }

    const match = findBestMovieMatch(movies, title);
    if (!match) {
      await bot.sendMessage(
        chatId,
        `Doesn't look like *${title}* is in Radarr yet.`,
        {
          parse_mode: "Markdown",
          reply_markup: buildAddKeyboard("movie", title)
        }
      );
      return;
    }

    const message = buildMovieSummary(match);
    await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("[haveMedia] Failed checking Radarr:", err.message);
    await bot.sendMessage(
      chatId,
      "I couldn't reach Radarr just now. Try again later."
    );
  }
}

function buildTvSummary(series, plexStats, requestedSeason) {
  const lines = [];
  lines.push(`📺 *${series.title}* is already in Sonarr.`);
  if (series.statistics?.sizeOnDisk) {
    lines.push(`On disk: ~${formatBytes(series.statistics.sizeOnDisk)}.`);
  }

  const seasons = (series.seasons || [])
    .filter((s) => Number(s.seasonNumber) > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);

  if (!seasons.length) {
    lines.push("No aired seasons yet.");
    return lines.join("\n");
  }

  let visible = seasons;
  if (requestedSeason > 0) {
    const target = seasons.find((s) => Number(s.seasonNumber) === requestedSeason);
    visible = target ? [target] : seasons.slice(0, DEFAULT_SHOW_SEASONS);
  } else if (seasons.length > DEFAULT_SHOW_SEASONS) {
    visible = seasons.slice(0, DEFAULT_SHOW_SEASONS);
  }

  lines.push("");
  lines.push("Season status:");
  for (const season of visible) {
    lines.push(describeSeasonLine(season, plexStats));
  }

  if (!requestedSeason && seasons.length > visible.length) {
    lines.push(
      `…plus ${seasons.length - visible.length} more seasons ready in Sonarr.`
    );
  } else if (requestedSeason > 0 && !visible.find((s) => s.seasonNumber === requestedSeason)) {
    lines.push(`(Could not find data for season ${requestedSeason} yet.)`);
  }

  return lines.join("\n");
}

function describeSeasonLine(season, plexStats) {
  const stats = season.statistics || {};
  const aired = stats.episodeCount ?? stats.totalEpisodeCount ?? 0;
  const downloaded = stats.episodeFileCount ?? 0;
  const monitored = season.monitored !== false;

  let downloadText = "❌ No episodes downloaded";
  if (downloaded >= aired && aired > 0) {
    downloadText = "✅ Fully downloaded";
  } else if (downloaded > 0) {
    downloadText = `⚠️ ${downloaded}/${aired || "?"} episodes downloaded`;
  } else if (aired === 0) {
    downloadText = "🕓 Waiting for episodes to air";
  }

  const plex = plexStats?.get(Number(season.seasonNumber));
  let watchText = "";
  if (plex) {
    if (plex.total > 0 && plex.watched === plex.total) {
      watchText = " — fully watched";
    } else if (plex.watched > 0) {
      watchText = ` — watched ${plex.watched}/${plex.total}`;
    }
  }

  const monitorText = monitored ? "" : " (not monitored)";

  return `• S${season.seasonNumber}: ${downloadText}${monitorText}${watchText}`;
}

function looksCleanedUp(series) {
  const stats = series?.statistics || {};
  const fileCount = stats.episodeFileCount || 0;
  if (fileCount > 0) return false;

  const seasons = (series?.seasons || []).filter((s) => Number(s.seasonNumber) > 0);
  if (!seasons.length) return false;
  const allUnmonitored = seasons.every((s) => s.monitored === false);
  if (!allUnmonitored) return false;

  const endedFlag = series?.ended === true || String(series?.status || "").toLowerCase() === "ended";
  if (endedFlag) return true;

  const lastAir =
    series?.previousAiring ||
    series?.lastAiring ||
    series?.lastEpisodeAirDate ||
    series?.airTimeUtc;
  if (!lastAir) return false;

  const lastDate = new Date(lastAir);
  if (Number.isNaN(lastDate.getTime())) return false;

  return lastDate.getTime() < Date.now();
}

function buildMovieSummary(movie) {
  const lines = [];
  const year = movie.year ? ` (${movie.year})` : "";
  lines.push(`🎬 *${movie.title}${year}* — yep, that's in Radarr.`);
  const hasFile = movie.hasFile || !!movie.movieFile;
  const monitored = movie.monitored !== false;
  const quality =
    movie.movieFile?.quality?.quality?.name ||
    movie.qualityProfile?.name ||
    "unknown quality";
  const size = movie.movieFile?.size || movie.sizeOnDisk || 0;

  if (hasFile) {
    lines.push(`✅ Downloaded (${quality})`);
    if (size) lines.push(`Size: ${formatBytes(size)}`);
  } else if (monitored) {
    lines.push("📡 It's monitored and waiting for a download to show up.");
  } else {
    lines.push("⚠️ It's in Radarr but not actively monitored.");
  }

  if (movie.isAvailable === false) {
    lines.push("Release not available yet.");
  }

  return lines.join("\n");
}

async function fetchPlexStats(title) {
  try {
    const shows = await getAllPlexShows(config);
    const match = shows.find(
      (s) => s.title?.toLowerCase() === title.toLowerCase()
    );
    if (!match) return new Map();
    const seasons = await getPlexSeasons(config, match.ratingKey);
    const map = new Map();
    for (const season of seasons) {
      if (season.seasonNumber >= 0) {
        map.set(season.seasonNumber, {
          watched: season.viewedLeafCount || 0,
          total: season.leafCount || 0
        });
      }
    }
    return map;
  } catch (err) {
    console.error("[haveMedia] Plex lookup failed:", err.message);
    return new Map();
  }
}

function findBestMovieMatch(movies, query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return null;

  let best = null;
  let bestScore = 0;

  for (const movie of movies) {
    const score = scoreTitle(normalizedQuery, movie.title || "");
    if (score > bestScore) {
      best = movie;
      bestScore = score;
    }
  }

  return bestScore > 0.35 ? best : null;
}

function scoreTitle(query, candidateTitle) {
  const normalized = normalize(candidateTitle);
  if (!normalized) return 0;
  if (normalized === query) return 1.0;
  if (normalized.startsWith(query)) return 0.9;
  if (normalized.includes(query)) return 0.7;

  const qTokens = new Set(query.split(" ").filter(Boolean));
  const cTokens = new Set(normalized.split(" ").filter(Boolean));
  const intersection = [...qTokens].filter((t) => cTokens.has(t)).length;
  const union = new Set([...qTokens, ...cTokens]).size || 1;
  return intersection / union;
}

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const HAVE_ADD_CALLBACK_PREFIX = HAVE_ADD_PREFIX;
