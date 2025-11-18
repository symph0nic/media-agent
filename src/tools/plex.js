// src/tools/plex.js
import axios from "axios";

/**
 * Low-level Plex JSON request helper
 */
export async function plexRequest(config, path) {
  const url = `${config.PLEX_URL}${path}`;

  console.log("PLEX REQUEST CALL:", { base: config.PLEX_URL, path });
  console.log("PLEX FINAL URL:", url);

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
    seasonNumber: Number(m.index ?? 0),
    leafCount: Number(m.leafCount ?? 0),
    viewedLeafCount: Number(m.viewedLeafCount ?? 0)
  }));
}
