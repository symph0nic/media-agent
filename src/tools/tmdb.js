import axios from "axios";
import { loadConfig } from "../config.js";

const config = loadConfig();

function ensureApiKey() {
  if (!config.TMDB_API_KEY) {
    throw new Error("TMDB_API_KEY is not configured.");
  }
}

function buildClient() {
  ensureApiKey();
  return axios.create({
    baseURL: "https://api.themoviedb.org/3",
    params: { api_key: config.TMDB_API_KEY }
  });
}

export async function searchCollections(query) {
  ensureApiKey();
  if (!query || !query.trim()) return [];

  const client = buildClient();
  const { data } = await client.get("/search/collection", {
    params: {
      query,
      include_adult: false,
      language: "en-US"
    }
  });

  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map((item) => ({
    id: item.id,
    name: item.name,
    overview: item.overview,
    posterPath: item.poster_path,
    backdropPath: item.backdrop_path,
    partCount: item.parts?.length || item.total_results || 0,
    popularity: item.popularity || 0
  }));
}

export async function getCollectionDetails(collectionId) {
  ensureApiKey();
  if (!collectionId) return null;

  const client = buildClient();
  const { data } = await client.get(`/collection/${collectionId}`, {
    params: { language: "en-US" }
  });

  if (!data) return null;

  const parts = Array.isArray(data.parts) ? data.parts : [];
  parts.sort((a, b) => {
    const orderDiff = Number(a.order || 0) - Number(b.order || 0);
    if (orderDiff !== 0) return orderDiff;
    const dateA = a.release_date ? new Date(a.release_date) : new Date(0);
    const dateB = b.release_date ? new Date(b.release_date) : new Date(0);
    return dateA - dateB;
  });

  return {
    id: data.id,
    name: data.name,
    overview: data.overview,
    parts: parts.map((part) => ({
      id: part.id,
      title: part.title || part.name,
      releaseDate: part.release_date,
      overview: part.overview,
      tmdbId: part.id,
      imdbId: part.imdb_id,
      posterPath: part.poster_path
    }))
  };
}
