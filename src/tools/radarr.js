import axios from "axios";
import { loadConfig } from "../config.js";

const config = loadConfig();

const client = axios.create({
  baseURL: config.RADARR_URL,
  headers: { "X-Api-Key": config.RADARR_API_KEY }
});

export async function lookupMovie(term) {
  const { data } = await client.get("/api/v3/movie/lookup", { params: { term } });
  return data || [];
}

export async function getRadarrRootFolders() {
  const { data } = await client.get("/api/v3/rootfolder");
  return data || [];
}

export async function getRadarrQualityProfiles() {
  const { data } = await client.get("/api/v3/qualityprofile");
  return data || [];
}

export async function addMovie(movie, { rootFolderPath, qualityProfileId }) {
  const payload = {
    title: movie.title,
    tmdbId: movie.tmdbId,
    imdbId: movie.imdbId,
    qualityProfileId,
    rootFolderPath,
    minimumAvailability: movie.minimumAvailability || "announced",
    monitored: true,
    titleSlug: movie.titleSlug,
    addOptions: { searchForMovie: true }
  };

  const { data } = await client.post("/api/v3/movie", payload);
  return data;
}

export async function listAllMovies() {
  const { data } = await client.get("/api/v3/movie");
  return data || [];
}

export async function editMoviesQualityProfile(movieIds, qualityProfileId) {
  const body = {
    movieIds,
    qualityProfileId
  };
  const { data } = await client.put("/api/v3/movie/editor", body);
  return data;
}

export async function searchMovies(movieIds = []) {
  const body = { name: "MoviesSearch", movieIds };
  const { data } = await client.post("/api/v3/command", body);
  return data;
}
