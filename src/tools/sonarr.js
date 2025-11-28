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
  return data || [];
}

export async function getEpisodes(seriesId) {
  console.log("[DEBUG][getEpisodes] Request for seriesId:", seriesId);

  try {
    const res = await axios.get(
      `${process.env.SONARR_URL}/api/v3/episode?seriesId=${seriesId}&includeEpisodeFile=true`,
      { headers: { "X-Api-Key": process.env.SONARR_API_KEY } }
    );

    console.log("[DEBUG][getEpisodes] Got", res.data.length, "episodes");

    return res.data;

  } catch (err) {
    console.error("[DEBUG][getEpisodes] ERROR fetching episodes:", err.message);
    return [];
  }
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

export async function getSeriesById(seriesId) {
  if (!process.env.SONARR_URL || !process.env.SONARR_API_KEY) {
    throw new Error("SONARR_URL or SONARR_API_KEY missing.");
  }

  const base = process.env.SONARR_URL.replace(/\/+$/, "");
  const url = `${base}/api/v3/series/${seriesId}`;

  const res = await axios.get(url, {
    headers: {
      "X-Api-Key": process.env.SONARR_API_KEY
    }
  });

  return res.data;
}

export async function updateSeries(seriesId, seriesPayload) {
  return await client.put(`/api/v3/series/${seriesId}`, seriesPayload);
}

export async function getSonarrRootFolders() {
  const { data } = await client.get("/api/v3/rootfolder");
  return data || [];
}

export async function getSonarrQualityProfiles() {
  const { data } = await client.get("/api/v3/qualityprofile");
  return data || [];
}

export async function runSeriesSearch(seriesIds = []) {
  if (!Array.isArray(seriesIds) || seriesIds.length === 0) return;
  const body = {
    name: "SeriesSearch",
    seriesIds
  };
  const { data } = await client.post("/api/v3/command", body);
  return data;
}

export async function addSeries(series, { rootFolderPath, qualityProfileId }) {
  const payload = {
    title: series.title,
    tvdbId: series.tvdbId,
    qualityProfileId,
    rootFolderPath,
    seasons: (series.seasons || []).map((s) => ({ seasonNumber: s.seasonNumber, monitored: true })),
    monitored: true,
    titleSlug: series.titleSlug,
    addOptions: { searchForMissingEpisodes: true },
    seasonFolder: true,
    seriesType: series.seriesType || "standard"
  };

  const { data } = await client.post("/api/v3/series", payload);
  return data;
}

export async function listAllSeries() {
  const { data } = await client.get("/api/v3/series");
  return data || [];
}
