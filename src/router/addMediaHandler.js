import { loadConfig } from "../config.js";
import axios from "axios";
import {
  lookupSeries,
  getSonarrRootFolders,
  getSonarrQualityProfiles,
  addSeries
} from "../tools/sonarr.js";
import {
  lookupMovie,
  getRadarrRootFolders,
  getRadarrQualityProfiles,
  addMovie
} from "../tools/radarr.js";
import { pending } from "../state/pending.js";
import { safeEditMessage } from "../telegram/safeEdit.js";

const MAX_CANDIDATES = 8;
const MAX_OVERVIEW = 700;
const config = loadConfig();
const MISSING_POSTER_TV = "https://artworks.thetvdb.com/banners/images/missing/series.jpg";
const MISSING_POSTER_MOVIE = "https://artworks.thetvdb.com/banners/images/missing/movie.jpg";

function trimOverview(overview) {
  if (!overview) return "";
  return overview.length > MAX_OVERVIEW
    ? `${overview.slice(0, MAX_OVERVIEW)}…`
    : overview;
}

function buildCaption(kind, item) {
  const title = item.title || item.name;
  const year = item.year || item.firstAired?.slice(0, 4) || item.releaseDate?.slice(0, 4) || "";
  const network =
    item.network || item.studio || item.originalLanguage || item.originalNetwork || "";

  let status = "";
  if (kind === "tv") {
    status = item.status || (item.monitored ? "Continuing" : item.isAvailable ? "Ended" : "");
  } else {
    status = item.status || (item.hasFile || item.isAvailable ? "Released" : "Announced");
  }

  const seasons =
    kind === "tv" && Array.isArray(item.seasons) ? `${item.seasons.length} Seasons` : "";
  const headerParts = [title, year && `(${year})`, seasons, network, status].filter(Boolean);
  const header = headerParts.join(" — ");
  const overview = trimOverview(item.overview || item.plot || "");
  return `*${header}*\n\n${overview}`;
}

function buildLinks(kind, item) {
  const buttons = [];
  if (kind === "tv") {
    if (item.tvdbId) buttons.push({ text: "TVDB", url: `https://www.thetvdb.com/dereferrer/series/${item.tvdbId}` });
    if (item.imdbId) buttons.push({ text: "IMDb", url: `https://www.imdb.com/title/${item.imdbId}` });
  } else {
    if (item.tmdbId) buttons.push({ text: "TMDB", url: `https://www.themoviedb.org/movie/${item.tmdbId}` });
    if (item.imdbId) buttons.push({ text: "IMDb", url: `https://www.imdb.com/title/${item.imdbId}` });
  }
  return buttons;
}

function absoluteUrl(url, kind) {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base =
    kind === "tv" ? config.SONARR_URL?.replace(/\/+$/, "") : config.RADARR_URL?.replace(/\/+$/, "");
  if (!base) return null;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function getPosterBuffer(item, kind) {
  const url = getPosterUrl(item, kind);
  if (!url) return null;

  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      headers:
        kind === "tv"
          ? { "X-Api-Key": config.SONARR_API_KEY }
          : { "X-Api-Key": config.RADARR_API_KEY }
    });

    const headerCt = res.headers["content-type"] || "";
    const contentType = headerCt.split(";")[0] || inferContentType(url) || "image/jpeg";
    const filename = buildFilename(contentType, url);
    return { buffer: Buffer.from(res.data), contentType, filename };
  } catch (err) {
    console.warn("[add] fetch poster failed:", err.message);
    return null;
  }
}

function inferContentType(url) {
  const lower = url.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function buildFilename(contentType, url) {
  if (url) {
    const name = url.split("/").pop()?.split("?")[0];
    if (name && name.includes(".")) return name;
  }
  const ext =
    contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : contentType === "image/gif"
          ? "gif"
          : "jpg";
  return `poster.${ext}`;
}

function getPosterUrl(item, kind) {
  const images = item.images || [];
  const poster = images.find((i) => i.coverType === "poster") || images[0];
  return absoluteUrl(poster?.url, kind);
}

function setPending(chatId, state) {
  pending[chatId] = state;
}

async function chooseDefaults(kind) {
  if (kind === "tv") {
    const [roots, profiles] = await Promise.all([
      getSonarrRootFolders(),
      getSonarrQualityProfiles()
    ]);
    if (!roots.length || !profiles.length) throw new Error("Sonarr roots/profiles missing");
    const root =
      roots.find((r) => r.path === config.SONARR_DEFAULT_ROOT) || roots[0];
    const profile =
      profiles.find(
        (p) =>
          p.id === Number(config.SONARR_DEFAULT_PROFILE) ||
          p.name?.toLowerCase() === (config.SONARR_DEFAULT_PROFILE || "").toLowerCase()
      ) || profiles[0];
    return { rootFolderPath: root.path, qualityProfileId: profile.id };
  }
  const [roots, profiles] = await Promise.all([
    getRadarrRootFolders(),
    getRadarrQualityProfiles()
  ]);
  if (!roots.length || !profiles.length) throw new Error("Radarr roots/profiles missing");
  const root =
    roots.find((r) => r.path === config.RADARR_DEFAULT_ROOT) || roots[0];
  const profile =
    profiles.find(
      (p) =>
        p.id === Number(config.RADARR_DEFAULT_PROFILE) ||
        p.name?.toLowerCase() === (config.RADARR_DEFAULT_PROFILE || "").toLowerCase()
    ) || profiles[0];
  return { rootFolderPath: root.path, qualityProfileId: profile.id };
}

function nextCandidateIndex(candidates, current, dir) {
  if (!candidates.length) return 0;
  return (current + dir + candidates.length) % candidates.length;
}

async function safeUpdateMessage(bot, chatId, messageId, text, isPhoto) {
  try {
    if (isPhoto) {
      await bot.editMessageCaption(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [] }
      });
    } else {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [] }
      });
    }
  } catch (err) {
    // If edit fails (e.g., caption vs text mismatch), fall back to a new message
    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  }
}

async function sendCard(bot, chatId, kind, state) {
  const { candidates, index } = state;

  if (!candidates || candidates.length === 0) {
    await bot.sendMessage(chatId, `No ${kind === "tv" ? "TV" : "movie"} results to show.`);
    delete pending[chatId];
    return;
  }

  const safeIndex = Math.min(Math.max(index, 0), candidates.length - 1);
  const item = candidates[safeIndex];
  const caption = buildCaption(kind, item);
  const linksRow = buildLinks(kind, item);
  const already = Boolean(item.id); // present in Sonarr/Radarr

  const mainRow = [];
  if (!already) mainRow.push({ text: "➕ Add", callback_data: "addmedia_add" });
  else mainRow.push({ text: "✅ Already added", callback_data: "addmedia_skip" });
  mainRow.push({ text: "✖️ Cancel", callback_data: "addmedia_cancel" });

  const navRow = [];
  if (candidates.length > 1) {
    navRow.push({ text: "◀️ Prev", callback_data: "addmedia_prev" });
    navRow.push({ text: "Next ▶️", callback_data: "addmedia_next" });
  }

  const keyboard = [mainRow];
  if (navRow.length) keyboard.push(navRow);
  if (state.otherCandidates && state.otherCandidates.length) {
    keyboard.push([
      {
        text: state.otherKind === "movie" ? "🎬 See movies" : "📺 See shows",
        callback_data: state.otherKind === "movie" ? "addmedia_kind_movie" : "addmedia_kind_tv"
      }
    ]);
  }
  if (linksRow.length) keyboard.push(linksRow);

  const fallbackPoster =
    kind === "tv"
      ? "https://artworks.thetvdb.com/banners/images/missing/series.jpg"
      : "https://artworks.thetvdb.com/banners/images/missing/movie.jpg";

  // URL preference order: remotePoster → absolute local → missing poster
  const posterUrl =
    item.remotePoster || getPosterUrl(item, kind) || fallbackPoster;

  // Buffer last-resort (may still help if URL blocked)
  const posterBuffer = await getPosterBuffer(item, kind);
  if (state.messageId) {
    try {
      await bot.deleteMessage(chatId, state.messageId);
    } catch (_) {
      // ignore
    }
  }

  let sent;
  // Prefer URL (remotePoster or absolute) like Searcharr; fallback to known-good missing poster
  if (posterUrl) {
    try {
      sent = await bot.sendPhoto(chatId, posterUrl, {
        caption,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (err) {
      console.warn("[add] sendPhoto url failed, trying buffer:", err.message);
    }
  }

  // Buffer attempt if URL failed
  if (!sent && posterBuffer) {
    try {
      sent = await bot.sendPhoto(chatId, posterBuffer.buffer, {
        caption,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (err) {
      console.warn("[add] sendPhoto buffer failed, falling back to text:", err.message);
    }
  }

  if (!sent) {
    sent = await bot.sendMessage(chatId, caption, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard }
    });
  }

  // keep both candidate sets around for later switches
  const tvCandidates =
    state.tvCandidates ||
    (kind === "tv"
      ? candidates
      : state.otherKind === "tv"
        ? state.otherCandidates || []
        : []);
  const movieCandidates =
    state.movieCandidates ||
    (kind === "movie"
      ? candidates
      : state.otherKind === "movie"
        ? state.otherCandidates || []
        : []);

  setPending(chatId, {
    ...state,
    tvCandidates,
    movieCandidates,
    index: safeIndex,
    messageId: sent.message_id,
    mode: "add_media",
    kind,
    messageIsPhoto: Boolean(sent.photo)
  });
}

export async function handleAddMedia(bot, chatId, entities) {
  // reset any prior add-media state for this chat
  delete pending[chatId];

  const rawTitle = entities.title || entities.reference || "";
  const title = rawTitle.trim();
  if (!title) {
    await bot.sendMessage(chatId, "Please tell me what to add.");
    return;
  }

  const requestedType = entities.type || "auto";
  let tvResults = [];
  let movieResults = [];

  if (requestedType !== "movie") {
    try {
      tvResults = (await lookupSeries(title)).slice(0, MAX_CANDIDATES);
    } catch (err) {
      console.error("[add] sonarr lookup failed:", err.message);
    }
  }

  if (requestedType !== "tv") {
    try {
      movieResults = (await lookupMovie(title)).slice(0, MAX_CANDIDATES);
    } catch (err) {
      console.error("[add] radarr lookup failed:", err.message);
    }
  }

  const tvScore = tvResults[0]?.ratings?.value || tvResults[0]?.popularity || 0;
  const mvScore = movieResults[0]?.ratings?.value || movieResults[0]?.popularity || 0;

  const haveTv = tvResults.length > 0;
  const haveMovie = movieResults.length > 0;

  // If user forced a type and we have it, go straight there
  if ((requestedType === "tv" && haveTv) || (requestedType === "movie" && haveMovie)) {
    const kind = requestedType;
    const candidates = kind === "tv" ? tvResults : movieResults;
    return sendCard(bot, chatId, kind, {
      mode: "add_media",
      kind,
      candidates,
      otherCandidates: kind === "tv" ? movieResults : tvResults,
      otherKind: kind === "tv" ? "movie" : "tv",
      tvCandidates: tvResults,
      movieCandidates: movieResults,
      index: 0
    });
  }

  // If only one side has results, pick it
  if (haveTv && !haveMovie) {
    return sendCard(bot, chatId, "tv", {
      mode: "add_media",
      kind: "tv",
      candidates: tvResults,
      otherCandidates: [],
      otherKind: "movie",
      tvCandidates: tvResults,
      movieCandidates: [],
      index: 0
    });
  }
  if (!haveTv && haveMovie) {
    return sendCard(bot, chatId, "movie", {
      mode: "add_media",
      kind: "movie",
      candidates: movieResults,
      otherCandidates: [],
      otherKind: "tv",
      tvCandidates: [],
      movieCandidates: movieResults,
      index: 0
    });
  }

  // Both have results: ask the user which set to browse
  if (haveTv && haveMovie) {
    pending[chatId] = {
      mode: "add_media_choose",
      tvCandidates: tvResults,
      movieCandidates: movieResults
    };

    const tvLabel = tvResults[0]?.title || tvResults[0]?.name || "TV results";
    const mvLabel = movieResults[0]?.title || "Movie results";

    await bot.sendMessage(
      chatId,
      `I found both TV and movie matches for “${title}”. Which do you want to browse first?`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: `📺 TV (${tvLabel})`, callback_data: "addmedia_kind_tv" }],
            [{ text: `🎬 Movie (${mvLabel})`, callback_data: "addmedia_kind_movie" }],
            [{ text: "✖️ Cancel", callback_data: "addmedia_cancel" }]
          ]
        }
      }
    );
    return;
  }

  await bot.sendMessage(chatId, "I couldn't find a matching show or movie.");
}

export async function handleAddMediaCallback(bot, query) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const state = pending[chatId];

  if (!state) {
    return bot.answerCallbackQuery(query.id, { text: "No active add-media request." });
  }

  if (data === "addmedia_cancel") {
    delete pending[chatId];
    try {
      await bot.deleteMessage(chatId, query.message.message_id);
    } catch (_) {
      await safeEditMessage(bot, chatId, query.message.message_id, "Cancelled.");
    }
    await bot.sendMessage(chatId, "❌ Add cancelled.");
    return bot.answerCallbackQuery(query.id);
  }

  if (data === "addmedia_kind_tv" || data === "addmedia_kind_movie") {
    const st = pending[chatId];
    if (!st || (st.mode !== "add_media_choose" && st.mode !== "add_media")) {
      await bot.answerCallbackQuery(query.id, { text: "Search expired, try again." });
      return;
    }
    const kind = data === "addmedia_kind_tv" ? "tv" : "movie";
    const candidates = kind === "tv" ? st.tvCandidates || [] : st.movieCandidates || [];
    const otherCandidates = kind === "tv" ? st.movieCandidates || [] : st.tvCandidates || [];

    if (!candidates || candidates.length === 0) {
      await bot.answerCallbackQuery(query.id, { text: `No ${kind} results available.` });
      return;
    }

    // remove chooser message
    try {
      await bot.deleteMessage(chatId, query.message.message_id);
    } catch (_) {}

    return sendCard(bot, chatId, kind, {
      mode: "add_media",
      kind,
      candidates,
      otherCandidates,
      otherKind: kind === "tv" ? "movie" : "tv",
      tvCandidates: st.tvCandidates || [],
      movieCandidates: st.movieCandidates || [],
      index: 0
    });
  }

  if (data === "addmedia_next" || data === "addmedia_prev") {
    const dir = data === "addmedia_next" ? 1 : -1;
    const next = nextCandidateIndex(state.candidates, state.index, dir);
    return sendCard(bot, chatId, state.kind, {
      ...state,
      tvCandidates: state.tvCandidates || [],
      movieCandidates: state.movieCandidates || [],
      index: next
    });
  }

  if (data === "addmedia_skip") {
    delete pending[chatId];
    await safeUpdateMessage(
      bot,
      chatId,
      query.message.message_id,
      "Already added.",
      state.messageIsPhoto
    );
    return bot.answerCallbackQuery(query.id);
  }

  if (data === "addmedia_add") {
    const item = state.candidates[state.index];
    try {
      const defaults = await chooseDefaults(state.kind);
      if (state.kind === "tv") {
        await addSeries(item, defaults);
      } else {
        await addMovie(item, defaults);
      }
      await safeUpdateMessage(
        bot,
        chatId,
        query.message.message_id,
        `✅ Added ${item.title || item.name}.`,
        state.messageIsPhoto
      );
    } catch (err) {
      console.error("[add] add failed:", err);
      await safeUpdateMessage(
        bot,
        chatId,
        query.message.message_id,
        "❌ Could not add. Check profiles/roots and API keys.",
        state.messageIsPhoto
      );
    }
    delete pending[chatId];
    return bot.answerCallbackQuery(query.id);
  }

  return bot.answerCallbackQuery(query.id);
}
