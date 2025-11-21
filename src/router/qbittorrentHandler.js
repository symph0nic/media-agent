import { loadConfig } from "../config.js";
import { pending } from "../state/pending.js";
import {
  findUnregisteredTorrents,
  deleteTorrents,
  formatTorrentList
} from "../tools/qbittorrent.js";
import { formatBytesDecimal } from "../tools/format.js";

export async function handleQbUnregistered(bot, chatId, scope = "all") {
  const config = loadConfig();

  const category =
    scope === "tv"
      ? config.QBITTORRENT_TV_CATEGORY
      : scope === "movies"
        ? config.QBITTORRENT_MOVIE_CATEGORY
        : null;

  try {
    const torrents = await findUnregisteredTorrents(config, { category });

    if (!torrents || torrents.length === 0) {
      await bot.sendMessage(chatId, "No unregistered torrents found.");
      return;
    }

    const totalSize = torrents.reduce((sum, t) => sum + (t.size || 0), 0);

    const MAX_LINES = 20;
    const preview = torrents.slice(0, MAX_LINES);
    const listText = formatTorrentList(preview);
    const overflow = torrents.length - preview.length;

    const scopeLabel = scope === "tv" ? "TV" : scope === "movies" ? "Movies" : "All";

    const lines = [];
    lines.push(`⚠️ *Unregistered torrents detected (${scopeLabel})*\n`);
    lines.push(listText);
    if (overflow > 0) {
      lines.push(`\n…and ${overflow} more`);
    }
    lines.push("\nDelete these torrents (and their files)?");
    lines.push(`Total size: ${formatBytesDecimal(totalSize)}`);

    const msg = await bot.sendMessage(chatId, lines.join("\n"), {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Delete", callback_data: "qb_unreg_yes" },
            { text: "❌ Cancel", callback_data: "qb_unreg_no" }
          ]
        ]
      }
    });

    pending[chatId] = {
      mode: "qb_unregistered",
      torrents,
      summaryMessageId: msg.message_id
    };
  } catch (err) {
    console.error("[qb] Failed to find unregistered torrents:", err);
    await bot.sendMessage(
      chatId,
      "Unable to query qBittorrent. Check configuration and connectivity."
    );
  }
}

export async function handleQbUnregisteredConfirm(bot, chatId, state) {
  const config = loadConfig();
  const hashes = (state?.torrents || []).map((t) => t.hash);

  try {
    const deleted = await deleteTorrents(config, hashes, true);
    const totalSize = state.torrents.reduce((sum, t) => sum + (t.size || 0), 0);
    const msg =
      `✅ Deleted ${deleted} unregistered torrent(s).\n` +
      `Approx freed: ${formatBytesDecimal(totalSize)}`;

    if (state.summaryMessageId) {
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: state.summaryMessageId,
        parse_mode: "Markdown"
      });
    } else {
      await bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    }
  } catch (err) {
    console.error("[qb] Failed to delete unregistered torrents:", err);
    await bot.sendMessage(
      chatId,
      "Could not delete unregistered torrents. Check qBittorrent connectivity."
    );
  }

  delete pending[chatId];
}
