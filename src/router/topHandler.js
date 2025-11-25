import { listAllSeries } from "../tools/sonarr.js";
import { listAllMovies } from "../tools/radarr.js";
import { formatBytes } from "../tools/format.js";
import { logError } from "../logger.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

function clampLimit(n) {
  if (!n || Number.isNaN(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, n));
}

function parseLimit(reference) {
  const match = reference?.match(/(\d{1,2})/);
  return clampLimit(match ? Number(match[1]) : DEFAULT_LIMIT);
}

function extractRating(obj) {
  if (!obj?.ratings) return 0;
  // Sonarr: ratings.value
  if (typeof obj.ratings.value === "number") return obj.ratings.value;
  // Radarr v4: ratings.imdb.value / ratings.tmdb.value
  if (typeof obj.ratings.imdb?.value === "number") return obj.ratings.imdb.value;
  if (typeof obj.ratings.tmdb?.value === "number") return obj.ratings.tmdb.value;
  // Radarr older: ratings array
  if (Array.isArray(obj.ratings)) {
    const first = obj.ratings.find((r) => typeof r.value === "number");
    return first?.value || 0;
  }
  return 0;
}

function topSizeSeries(series, limit) {
  return series
    .filter((s) => (s.statistics?.sizeOnDisk ?? 0) > 0)
    .sort((a, b) => (b.statistics?.sizeOnDisk ?? 0) - (a.statistics?.sizeOnDisk ?? 0))
    .slice(0, limit);
}

function topRatingSeries(series, limit) {
  return series
    .map((s) => ({ ...s, __rating: extractRating(s) }))
    .filter((s) => s.__rating > 0)
    .sort((a, b) => b.__rating - a.__rating)
    .slice(0, limit);
}

function topSizeMovies(movies, limit) {
  return movies
    .filter((m) => (m.sizeOnDisk ?? 0) > 0)
    .sort((a, b) => (b.sizeOnDisk ?? 0) - (a.sizeOnDisk ?? 0))
    .slice(0, limit);
}

function topRatingMovies(movies, limit) {
  return movies
    .map((m) => ({ ...m, __rating: extractRating(m) }))
    .filter((m) => m.__rating > 0)
    .sort((a, b) => b.__rating - a.__rating)
    .slice(0, limit);
}

function formatList(kind, metric, items) {
  const title =
    metric === "size"
      ? kind === "tv"
        ? "📦 Largest TV Shows"
        : "📦 Largest Movies"
      : kind === "tv"
        ? "⭐️ Top-rated TV Shows"
        : "⭐️ Top-rated Movies";

  const lines = [];
  lines.push(title);
  lines.push("");

  items.forEach((item, idx) => {
    const year = item.year || item.releaseYear || item.firstAired?.slice(0, 4) || "";
    const name = item.title || item.name || "(unknown)";
    if (metric === "size") {
      const size = formatBytes(
        kind === "tv" ? item.statistics?.sizeOnDisk ?? 0 : item.sizeOnDisk ?? 0
      );
      const count =
        kind === "tv"
          ? `${item.statistics?.episodeFileCount ?? 0} files`
          : `${item.movieFile?.size ?? item.sizeOnDisk ? "downloaded" : "not downloaded"}`;
      lines.push(`${idx + 1}. ${name}${year ? ` (${year})` : ""} — ${size} — ${count}`);
    } else {
      const rating = extractRating(item);
      lines.push(`${idx + 1}. ${name}${year ? ` (${year})` : ""} — ${rating.toFixed(1)}/10`);
    }
  });

  return lines.join("\n");
}

export async function handleShowTop(bot, chatId, { scope, metric, reference }) {
  try {
    const limit = parseLimit(reference);

    if (scope === "tv") {
      const series = await listAllSeries();
      const list = metric === "size" ? topSizeSeries(series, limit) : topRatingSeries(series, limit);
      if (!list.length) {
        await bot.sendMessage(chatId, "No TV results available for that query.");
        return;
      }
      await bot.sendMessage(chatId, formatList("tv", metric, list), { parse_mode: "Markdown" });
      return;
    }

    // movies
    const movies = await listAllMovies();
    const list =
      metric === "size" ? topSizeMovies(movies, limit) : topRatingMovies(movies, limit);
    if (!list.length) {
      await bot.sendMessage(chatId, "No movie results available for that query.");
      return;
    }
    await bot.sendMessage(chatId, formatList("movie", metric, list), { parse_mode: "Markdown" });
  } catch (err) {
    logError(`[top] failed: ${err.message}`);
    await bot.sendMessage(chatId, "Unable to fetch rankings right now.");
  }
}
