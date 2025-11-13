import dotenv from 'dotenv';

export function loadConfig() {
  dotenv.config(); // Loads .env if present

  return {
    TG_BOT_TOKEN: process.env.TG_BOT_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    MODEL: process.env.OPENAI_MODEL,
    SONARR_URL: process.env.SONARR_URL,
    SONARR_API_KEY: process.env.SONARR_API_KEY
  };

}
