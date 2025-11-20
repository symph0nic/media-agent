// src/tools/plex.js
import axios from "axios";

/**
 * Low-level Plex JSON request helper
 */
export async function plexRequest(config, path) {
  const url = `${config.PLEX_URL}${path}`;

  //console.log("PLEX REQUEST CALL:", { base: config.PLEX_URL, path });
  //console.log("PLEX FINAL URL:", url);

  try {
    const res = await axios.get(url, {
      headers: {
        "X-Plex-Token": config.PLEX_TOKEN,
        "Accept": "application/json"
      }
    });

    // Plex JSON root
    return res.data.MediaContainer;

  } catch (err) {
    console.error("[plexRequest] Error requesting:", url, err.message);
    throw err;
  }
}


/**
 * Get all TV shows from Plex using the configured section.
 */
export async function getAllPlexShows(config) {
  const section = config.PLEX_TV_SECTION;

  const path = `/library/sections/${section}/all?title=`;
  console.log("BUILDING PLEX PATH:", path);

  const container = await plexRequest(config, path);

  if (!container || !container.Metadata) return [];

  const metadata = Array.isArray(container.Metadata)
    ? container.Metadata
    : [container.Metadata];

  return metadata
    .map(m => ({
      title: m.title,
      ratingKey: m.ratingKey
    }))
    .filter(m => m.title && m.ratingKey);
}


/**
 * Get seasons for a Plex show by ratingKey.
 */
export async function getPlexSeasons(config, ratingKey) {
  const container = await plexRequest(config, `/library/metadata/${ratingKey}/children`);

  if (!container || !container.Metadata) return [];

  const metadata = Array.isArray(container.Metadata)
    ? container.Metadata
    : [container.Metadata];

  return metadata.map(m => ({
    title: m.title,
    seasonNumber: Number (m.index ?? 0),
    ratingKey: m.ratingKey,
    year: Number(m.year ?? 0),
    leafCount: Number(m.leafCount ?? 0),
    viewedLeafCount: Number(m.viewedLeafCount ?? 0),
    lastViewedAt: m.lastViewedAt ? Number(m.lastViewedAt) : 0
  }));
}

export async function getCurrentlyWatchingShows(config) {
  const cw = await getContinueWatching(config);

  // Filter to “in-progress” episodes
  const inProgress = cw.filter(
    s =>
      s.viewOffset > 0 &&
      s.duration > 0 &&
      s.viewOffset < s.duration
  );

  inProgress.sort((a, b) => (b.lastViewedAt || 0) - (a.lastViewedAt || 0));

  return inProgress;
}




export async function getContinueWatching(config) {
  const url = `${config.PLEX_URL}/hubs/continueWatching`;

  const response = await axios.get(url, {
    headers: {
      "X-Plex-Token": config.PLEX_TOKEN
    }
  });

  const hubs = response.data?.MediaContainer?.Hub || [];
  const cwHub = hubs.find(h => h.title?.toLowerCase() === "continue watching");

  if (!cwHub || !cwHub.Metadata) return [];

  return cwHub.Metadata.map(m => ({
    // show-level info
    title: m.grandparentTitle || m.parentTitle || m.title,
    ratingKey: m.ratingKey,

    // episode-level info
    episodeTitle: m.title,
    seasonNumber: Number(m.parentIndex ?? 0),
    episodeNumber: Number(m.index ?? 0),

    // progress
    duration: Number(m.duration ?? 0),
    viewOffset: Number(m.viewOffset ?? 0),
    percent: m.duration ? Math.round((m.viewOffset / m.duration) * 100) : 0,

    // recency
    lastViewedAt: Number(m.lastViewedAt ?? 0),

    // extra flags
    type: m.type,
    year: Number(m.year ?? 0),
  }));
}

export function fuzzyMatchCW(continueWatching, reference) {
  const ref = reference.toLowerCase().trim();

  // very simple fuzzy — good enough for "housewives", "cooking", etc
  return continueWatching.filter(item =>
    item.title.toLowerCase().includes(ref)
  );
}

