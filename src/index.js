// src/index.js
import { loadConfig } from "./config.js";
import { startTelegramBot } from "./telegram/bot.js";
import {
  loadSonarrCache,
  refreshSonarrCache,
  cacheIsFresh
} from "./cache/sonarrCache.js";
import { getCurrentlyWatchingShows } from "./tools/plex.js";


function msUntilNextMidnight() {
  const now = new Date();
  const next = new Date(now);
  // set to next midnight
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

function scheduleMidnightCacheRefresh(config, bot) {
  const adminChatId = config.ADMIN_CHAT_ID;

  const run = async () => {
    console.log("[media-agent] Midnight cache refresh starting…");
    try {
      const newCache = await refreshSonarrCache(config);
      if (newCache) {
        global.sonarrCache = newCache;
        console.log("[media-agent] Midnight cache refresh completed.");

        if (adminChatId) {
          await bot.sendMessage(
            adminChatId,
            "🕛 Sonarr series cache refreshed successfully at midnight."
          );
        }
      } else {
        console.warn("[media-agent] Midnight refresh returned no cache data.");
        if (adminChatId) {
          await bot.sendMessage(
            adminChatId,
            "⚠️ Sonarr midnight cache refresh ran but returned no data. Check logs."
          );
        }
      }
    } catch (err) {
      console.error("[media-agent] Midnight cache refresh failed:", err);
      if (adminChatId) {
        await bot.sendMessage(
          adminChatId,
          "⚠️ Sonarr midnight cache refresh failed. Check media-agent logs."
        );
      }
    } finally {
      // schedule next midnight in exactly 24h
      setTimeout(run, 24 * 60 * 60 * 1000);
    }
  };

  const delay = msUntilNextMidnight();
  console.log(
    `[media-agent] First midnight cache refresh in ~${Math.round(
      delay / 1000
    )}s`
  );
  setTimeout(run, delay);
}

async function main() {
  const config = loadConfig();

  console.log("[media-agent] Starting Media Concierge v2...");
  console.log(
    `[media-agent] Telegram Bot ID: ${
      config.TG_BOT_TOKEN ? "OK" : "MISSING TOKEN"
    }`
  );
  console.log("[media-agent] Using model:", config.OPENAI_MODEL || config.MODEL);

  console.log("[media-agent] Initialising Sonarr cache…");

  // Load cache from disk (may be null)
  let cache = loadSonarrCache();

  // If missing or stale, refresh it now
  if (!cache || !cacheIsFresh()) {
    console.log(
      "[media-agent] Cache missing or older than 24h → refreshing now…"
    );
    cache = await refreshSonarrCache(config);
  } else {
    console.log("[media-agent] Using existing cache (fresh).");
  }

  // Store globally for handlers
  global.sonarrCache = cache;

  // Start the Telegram bot and get the instance
  const bot = await startTelegramBot(config);

  // Schedule midnight refresh + Telegram notification
  scheduleMidnightCacheRefresh(config, bot);



}

main().catch((err) => {
  console.error("Fatal error:", err);
});
