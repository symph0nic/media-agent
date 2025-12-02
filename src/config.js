import dotenv from "dotenv";


export function loadConfig() {
  dotenv.config();
  const shareRoots = (process.env.NAS_SHARE_ROOTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (shareRoots.length === 0 && process.env.NAS_RECYCLE_PATH) {
    shareRoots.push(process.env.NAS_RECYCLE_PATH);
  }

  return {
    TG_BOT_TOKEN: process.env.TG_BOT_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    MODEL: process.env.OPENAI_MODEL,
    SONARR_URL: process.env.SONARR_URL,
    SONARR_API_KEY: process.env.SONARR_API_KEY,
    SONARR_DEFAULT_ROOT: process.env.SONARR_DEFAULT_ROOT,
    SONARR_DEFAULT_PROFILE: process.env.SONARR_DEFAULT_PROFILE,
    RADARR_URL: process.env.RADARR_URL,
    RADARR_API_KEY: process.env.RADARR_API_KEY,
    RADARR_DEFAULT_ROOT: process.env.RADARR_DEFAULT_ROOT,
    RADARR_DEFAULT_PROFILE: process.env.RADARR_DEFAULT_PROFILE,
    TMDB_API_KEY: process.env.TMDB_API_KEY,

    // Plex
    PLEX_URL: process.env.PLEX_URL,
    PLEX_TOKEN: process.env.PLEX_TOKEN,
    PLEX_TV_SECTION: process.env.PLEX_TV_SECTION,
    PLEX_MOVIE_SECTION: process.env.PLEX_MOVIE_SECTION,
    ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID,

    NAS_SHARE_ROOTS: shareRoots,
    NAS_SSH_HOST: process.env.NAS_SSH_HOST,
    NAS_SSH_PORT: Number(process.env.NAS_SSH_PORT || 22),
    NAS_SSH_USERNAME: process.env.NAS_SSH_USERNAME,
    NAS_SSH_PASSWORD: process.env.NAS_SSH_PASSWORD,
    NAS_SSH_PRIVATE_KEY: process.env.NAS_SSH_PRIVATE_KEY,
    NAS_BIN_MIN_BYTES: Number(process.env.NAS_BIN_MIN_BYTES || 1_000_000),
    NAS_BIN_MIN_FILES: Number(process.env.NAS_BIN_MIN_FILES || 10),

    QBITTORRENT_URL: process.env.QBITTORRENT_URL,
    QBITTORRENT_USERNAME: process.env.QBITTORRENT_USERNAME,
    QBITTORRENT_PASSWORD: process.env.QBITTORRENT_PASSWORD,
    QBITTORRENT_TV_CATEGORY: process.env.QBITTORRENT_TV_CATEGORY,
    QBITTORRENT_MOVIE_CATEGORY: process.env.QBITTORRENT_MOVIE_CATEGORY
  };
}
