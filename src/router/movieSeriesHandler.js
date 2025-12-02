import { loadConfig } from "../config.js";
import { searchCollections, getCollectionDetails } from "../tools/tmdb.js";
import {
  getRadarrRootFolders,
  getRadarrQualityProfiles,
  addMovie,
  listAllMovies
} from "../tools/radarr.js";
import { pending } from "../state/pending.js";
import { safeEditMessage } from "../telegram/safeEdit.js";

const config = loadConfig();
const MAX_CHOICES = 5;

function normalizeTitle(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .trim();
}

function clearPending(chatId) {
  delete pending[chatId];
}

function formatMovieList(movies) {
  if (!movies || movies.length === 0) return "No movies found in this collection.";

  const withYear = [];
  const noYear = [];

  movies.forEach((movie) => {
    if (movie.releaseDate) {
      withYear.push(movie);
    } else {
      noYear.push(movie);
    }
  });

  const sorted = [
    ...withYear,
    ...noYear.sort((a, b) => (a.title || "").localeCompare(b.title || ""))
  ];

  const shown = sorted.slice(0, 10);
  const lines = shown.map((movie, idx) => {
    const year = movie.releaseDate
      ? movie.releaseDate.split("-")[0]
      : "TBC";
    return `${idx + 1}. ${movie.title} (${year})`;
  });

  if (sorted.length > shown.length) {
    lines.push(`…and ${sorted.length - shown.length} more.`);
  }

  return lines.join("\n");
}

async function resolveRadarrDefaults() {
  const [roots, profiles] = await Promise.all([
    getRadarrRootFolders(),
    getRadarrQualityProfiles()
  ]);

  const rootFolder =
    config.RADARR_DEFAULT_ROOT ||
    roots?.[0]?.path ||
    roots?.[0]?.rootFolderPath ||
    "";
  const profileName = config.RADARR_DEFAULT_PROFILE;

  const qualityProfile =
    profiles?.find((p) => p.name === profileName) ||
    profiles?.[0] ||
    null;

  if (!rootFolder || !qualityProfile) {
    throw new Error("Radarr root folder or quality profile is missing.");
  }

  return {
    rootFolderPath: rootFolder,
    qualityProfileId: qualityProfile.id,
    qualityProfileName: qualityProfile.name
  };
}

async function presentConfirmation(bot, chatId, collection) {
  const details = await getCollectionDetails(collection.id);
  if (!details || !Array.isArray(details.parts) || details.parts.length === 0) {
    await bot.sendMessage(chatId, "I couldn't load that collection.");
    return;
  }

  const movies = details.parts.map((part) => ({
    tmdbId: part.tmdbId,
    title: part.title,
    releaseDate: part.releaseDate
  }));

  let existingMovies = [];
  try {
    existingMovies = await listAllMovies();
  } catch (err) {
    console.error("[movieSeries] Failed to check existing movies:", err.message);
  }

  const existingIds = new Set(
    (existingMovies || []).map((movie) => Number(movie.tmdbId))
  );

  const alreadyHave = movies.filter((m) => existingIds.has(Number(m.tmdbId)));
  const missing = movies.filter((m) => !existingIds.has(Number(m.tmdbId)));

  const section = (title, items) => {
    if (!items || items.length === 0) return "";
    return `${title}:\n${formatMovieList(items)}`;
  };

  const alreadySection = section("You already have", alreadyHave);
  const missingSection = section("This will add", missing);

  const body = [
    `🎬 *${details.name}*`,
    alreadySection,
    missingSection || "All movies are already in Radarr.",
    missing.length === 0
      ? "Want me to re-add them anyway?"
      : "Add the missing movies in this series?"
  ]
    .filter((part) => part && part.trim().length > 0)
    .join("\n\n");

  const sent = await bot.sendMessage(chatId, body, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Add All", callback_data: "ms_confirm" },
          { text: "Cancel", callback_data: "ms_cancel" }
        ]
      ]
    }
  });

  clearPending(chatId);
  pending[chatId] = {
    mode: "movie_series_confirm",
    collection: { id: collection.id, name: details.name },
    movies,
    messageId: sent?.message_id
  };
}

export async function handleDownloadMovieSeries(bot, chatId, entities, statusId) {
  if (!config.TMDB_API_KEY) {
    await bot.sendMessage(
      chatId,
      "TMDB_API_KEY is not configured, so I can't search movie collections yet."
    );
    return;
  }

  const reference = (entities.reference || entities.title || "").trim();
  if (!reference) {
    await bot.sendMessage(chatId, "Tell me the movie series name.");
    return;
  }

  try {
    const cleanedReference = reference
      .replace(/\b(movie|movies|films|film|collection|series|franchise)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    const queries = [reference];
    if (cleanedReference && cleanedReference.toLowerCase() !== reference.toLowerCase()) {
      queries.push(cleanedReference);
    }

    let results = [];
    for (const term of queries) {
      results = await searchCollections(term);
      if (results && results.length > 0) break;
    }

    if (!results || results.length === 0) {
      await bot.sendMessage(chatId, `I couldn't find a movie series for "${reference}".`);
      return;
    }

    const normalizedRef = normalizeTitle(reference);
    const exactMatch = results.find(
      (item) => normalizeTitle(item.name) === normalizedRef
    );

    if (exactMatch) {
      return presentConfirmation(bot, chatId, exactMatch);
    }

    const topMatches = results.slice(0, MAX_CHOICES);
    if (topMatches.length === 1) {
      return presentConfirmation(bot, chatId, topMatches[0]);
    }

    const keyboard = topMatches.map((item) => [
      {
        text: `${item.name}`,
        callback_data: `ms_pick_${item.id}`
      }
    ]);
    keyboard.push([{ text: "Cancel", callback_data: "ms_cancel" }]);

    clearPending(chatId);
    pending[chatId] = {
      mode: "movie_series_pick",
      choices: topMatches
    };

    await bot.sendMessage(
      chatId,
      "I found multiple collections. Which one do you want?",
      { reply_markup: { inline_keyboard: keyboard } }
    );
  } catch (err) {
    console.error("[movieSeries] Failed to start download:", err);
    await bot.sendMessage(chatId, "Error searching TMDb collections.");
  }
}

async function addCollection(bot, chatId, state) {
  try {
    const defaults = await resolveRadarrDefaults();
    const existing = await listAllMovies();
    const existingIds = new Set(
      (existing || []).map((movie) => Number(movie.tmdbId))
    );

    let added = 0;
    let skipped = 0;

    for (const movie of state.movies) {
      if (!movie.tmdbId) {
        skipped++;
        continue;
      }
      if (existingIds.has(Number(movie.tmdbId))) {
        skipped++;
        continue;
      }

      try {
        await addMovie(
          {
            title: movie.title,
            tmdbId: movie.tmdbId,
            imdbId: movie.imdbId,
            titleSlug: `${movie.title}-${movie.tmdbId}`,
            minimumAvailability: "announced"
          },
          defaults
        );
        existingIds.add(Number(movie.tmdbId));
        added++;
      } catch (err) {
        console.error("[movieSeries] Failed to add movie:", movie, err.message);
        skipped++;
      }
    }

    const msg =
      `🎞 *${state.collection.name}*\n` +
      `Added ${added} movies.\n` +
      `${skipped > 0 ? `${skipped} already existed or failed.` : ""}`;

    await safeEditMessage(
      bot,
      chatId,
      state.messageId,
      msg,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("[movieSeries] Failed to add collection:", err);
    await safeEditMessage(
      bot,
      chatId,
      state.messageId,
      "❌ Could not add that movie series.",
      { parse_mode: "Markdown" }
    );
  } finally {
    clearPending(chatId);
  }
}

export async function handleMovieSeriesCallback(bot, query) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const state = pending[chatId];

  if (data === "ms_cancel") {
    clearPending(chatId);
    await safeEditMessage(bot, chatId, query.message.message_id, "❌ Cancelled.");
    return true;
  }

  if (data === "ms_confirm") {
    if (!state || state.mode !== "movie_series_confirm") {
      await bot.sendMessage(chatId, "Sorry, I lost track of that series.");
      return true;
    }

    await safeEditMessage(bot, chatId, state.messageId, "Adding movies…", {
      reply_markup: { inline_keyboard: [] }
    });
    await addCollection(bot, chatId, state);
    return true;
  }

  if (data.startsWith("ms_pick_")) {
    if (!state || state.mode !== "movie_series_pick") {
      await bot.sendMessage(chatId, "I don't have that list anymore.");
      return true;
    }

    const id = Number(data.replace("ms_pick_", ""));
    const choice = state.choices.find((c) => Number(c.id) === id);
    if (!choice) {
      await bot.sendMessage(chatId, "Couldn't load that collection.");
      return true;
    }

    await presentConfirmation(bot, chatId, choice);
    return true;
  }

  return false;
}
