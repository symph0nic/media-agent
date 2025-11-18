import fs from "fs";
import path from "path";
import axios from "axios";
import { fileURLToPath } from "url";

//
// Resolve filesystem paths
//
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.join(__dirname, "../../cache");
const CACHE_PATH = path.join(CACHE_DIR, "sonarr_series.json");
const METADATA_PATH = path.join(CACHE_DIR, "sonarr_cache_meta.json");

//
// Ensure the cache directory exists
//
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log("[cache] Created cache directory:", CACHE_DIR);
}

//
// Utility: clean & normalise titles for lookup
//
function cleanTitle(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

//
// Load Sonarr cache from disk
//
export function loadSonarrCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;

    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    const data = JSON.parse(raw);

    console.log("[cache] Loaded Sonarr cache:", data.length, "series");
    return data;

  } catch (err) {
    console.error("[cache] Error loading Sonarr cache:", err);
    return null;
  }
}

//
// Save cache metadata (timestamp)
//
function saveCacheMetadata() {
  try {
    const meta = { updatedAt: Date.now() };
    fs.writeFileSync(METADATA_PATH, JSON.stringify(meta, null, 2));
  } catch (err) {
    console.error("[cache] Failed to write cache metadata:", err);
  }
}

//
// Store series list + update metadata
//
export function saveSonarrCache(data) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2));
    saveCacheMetadata();
    console.log("[cache] Sonarr cache + metadata saved.");
  } catch (err) {
    console.error("[cache] Failed to write Sonarr cache:", err);
  }
}

//
// Check if cache is fresh (< maxAgeHours old)
//
export function cacheIsFresh(maxAgeHours = 24) {
  try {
    if (!fs.existsSync(METADATA_PATH)) return false;

    const { updatedAt } = JSON.parse(
      fs.readFileSync(METADATA_PATH, "utf8")
    );

    const ageMs = Date.now() - updatedAt;
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

    return ageMs < maxAgeMs;

  } catch (err) {
    console.error("[cache] Failed checking metadata:", err);
    return false;
  }
}

//
// Refresh cache by downloading *all* Sonarr series
//
export async function refreshSonarrCache(config) {
  console.log("[cache] Refreshing Sonarr series cache…");

  try {
    const res = await axios.get(
      `${config.SONARR_URL}/api/v3/series`,
      {
        headers: { "X-Api-Key": config.SONARR_API_KEY }
      }
    );

    const series = res.data.map(s => ({
      id: s.id,
      title: s.title,
      cleanTitle: s.cleanTitle ?? cleanTitle(s.title),
      episodeFileCount: s.statistics?.episodeFileCount ?? null,
      totalEpisodeCount: s.statistics?.totalEpisodeCount ?? null,
      monitored: s.monitored,
      ended: s.ended,
      path: s.path
    }));

    saveSonarrCache(series);
    return series;

  } catch (err) {
    console.error("[cache] Failed to refresh Sonarr cache:", err.message);
    return null;
  }
}

//
// Fuzzy title search inside cache
//
// Region suffixes we recognize
const REGION_WORDS = new Set(["uk", "us", "au", "nz", "ca"]);

// Stopwords that should NOT include region codes
const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "season"
]);

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w))
    .join(" ");
}

function tokenSet(str) {
  return new Set(str.split(" ").filter(s => s.length > 1));
}

function tokenSimilarity(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  const intersection = [...A].filter(x => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return intersection / union || 0;
}

function extractRegion(words) {
  return words.filter(w => REGION_WORDS.has(w));
}

export function findSeriesInCache(cache, rawQuery) {
  const queryNorm = normalize(rawQuery);
  const queryWords = queryNorm.split(" ");
  const queryRegions = extractRegion(queryWords);

  const scored = cache.map(s => {
    const titleNorm = normalize(s.title);
    const titleWords = titleNorm.split(" ");
    const titleRegions = extractRegion(titleWords);

    // Base similarity
    const sim = tokenSimilarity(titleNorm, queryNorm);

    let score = sim;

    // Strong prefix match
    if (titleNorm.startsWith(queryNorm)) score += 0.4;

    // Strong exact match
    if (titleNorm === queryNorm) score += 0.5;

    // Region bonus IF user specified one
    if (queryRegions.length > 0 &&
        titleRegions.some(r => queryRegions.includes(r))) {
      score += 0.5;
    }

    return { series: s, score };
  });

  // Only keep reasonably relevant matches
  const filtered = scored.filter(s => s.score > 0.3);

  // Sort best first
  filtered.sort((a, b) => b.score - a.score);

  console.log("[DEBUG] Fuzzy search scoring:");
  filtered.forEach(f =>
    console.log(` • ${f.series.title} score=${f.score.toFixed(3)}`)
  );

  return filtered.map(f => f.series);
}


//
// Optional convenience accessor (if you want it):
//
export function getSeriesById(cache, id) {
  if (!cache) return null;
  return cache.find(s => s.id === id) || null;
}
