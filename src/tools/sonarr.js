import axios from "axios";
import { loadConfig } from "../config.js";

const config = loadConfig();

const client = axios.create({
  baseURL: config.SONARR_URL,
  headers: { "X-Api-Key": config.SONARR_API_KEY }
});

export async function lookupSeries(term) {
  const { data } = await client.get(`/api/v3/series/lookup`, {
    params: { term }
  });

  // Only keep shows already added to Sonarr (have id)
  return data
    .filter((s) => s.id)
    .map((s) => ({
      id: s.id,
      title: s.title,
      tvdbId: s.tvdbId
    }));
}

export async function getEpisodes(seriesId) {
  const { data } = await client.get(`/api/v3/episode`, {
    params: { seriesId }
  });
  return data;
}

export function findEpisode(episodes, seasonNumber, episodeNumber) {
  if (episodeNumber === 0) {
    // whole season – return all from that season
    return episodes.filter((e) => e.seasonNumber === seasonNumber);
  }

  return episodes.filter(
    (e) =>
      e.seasonNumber === seasonNumber &&
      e.episodeNumber === episodeNumber
  );
}

export async function runEpisodeSearch(episodeId) {
  const body = {
    name: "EpisodeSearch",
    episodeIds: [episodeId]
  };

  const { data } = await client.post(`/api/v3/command`, body);
  return data;
}

export async function deleteEpisodeFile(episodeFileId) {
  if (!episodeFileId) {
    return { skipped: true };
  }

  const { data } = await client.delete(`/api/v3/episodefile/${episodeFileId}`);
  return data;
}