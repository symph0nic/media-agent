import dotenv from "dotenv";


export function loadConfig() {
  dotenv.config();
  return {
    TG_BOT_TOKEN: process.env.TG_BOT_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    MODEL: process.env.OPENAI_MODEL,
    SONARR_URL: process.env.SONARR_URL,
    SONARR_API_KEY: process.env.SONARR_API_KEY,

    // Plex
    PLEX_URL: process.env.PLEX_URL,
    PLEX_TOKEN: process.env.PLEX_TOKEN,
    PLEX_TV_SECTION: process.env.PLEX_TV_SECTION,
    PLEX_MOVIE_SECTION: process.env.PLEX_MOVIE_SECTION,
    ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID
  };
}
