import { loadConfig } from './config.js';
import { startTelegramBot } from './telegram/bot.js';

async function main() {
  const config = loadConfig();

  console.log('[media-agent] Starting Media Concierge v2...');
  console.log(`[media-agent] Telegram Bot ID: ${config.TG_BOT_TOKEN ? 'OK' : 'MISSING TOKEN'}`);
  console.log("[media-agent] Using model:", config.MODEL);

  await startTelegramBot(config);
}

main().catch((err) => {
  console.error('Fatal error:', err);
});
