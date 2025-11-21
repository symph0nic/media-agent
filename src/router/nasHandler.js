import { loadConfig } from "../config.js";
import { pending } from "../state/pending.js";
import {
  discoverRecycleBins,
  summarizeRecycleBin,
  getStorageStatus
} from "../tools/nas.js";
import { formatBytes, formatBytesDecimal } from "../tools/format.js";
import {
  nasPrimaryKeyboard,
  nasSelectionKeyboard
} from "../telegram/reply.js";

function formatBinPreview(binSummary) {
  const previewEntries = binSummary.summary.preview
    .map((entry) => `${entry.name} (${formatBytes(entry.sizeBytes)})`)
    .slice(0, 3);

  return previewEntries.length > 0
    ? `   Examples: ${previewEntries.join(", ")}`
    : "";
}

export async function handleNasRecycleBin(bot, chatId) {
  const config = loadConfig();
  const shareRoots = config.NAS_SHARE_ROOTS || [];

  if (shareRoots.length === 0) {
    await bot.sendMessage(
      chatId,
      "NAS recycle-bin paths are not configured. Set NAS_SHARE_ROOTS (comma-separated) in your environment."
    );
    return;
  }

  try {
    console.log("[nas] Discovering recycle bins in roots:", shareRoots);
    const bins = await discoverRecycleBins(shareRoots, config);
    console.log("[nas] Found recycle bins:", bins.map((b) => b.recyclePath));
    if (bins.length === 0) {
      await bot.sendMessage(
        chatId,
        "No recycle-bin directories were found under the configured NAS share roots."
      );
      return;
    }

    const binSummaries = [];
    let totalBytes = 0;
    let totalFiles = 0;

    let progressId = null;
    let progressText = "Inspecting NAS recycle bins…";
    try {
      const progressMsg = await bot.sendMessage(chatId, progressText);
      progressId = progressMsg.message_id;
    } catch (_) {}

    for (let idx = 0; idx < bins.length; idx++) {
      const bin = bins[idx];

      if (progressId) {
        const text = `Inspecting NAS recycle bins… (${idx + 1}/${bins.length})\n${bin.share}`;
        try {
          await bot.editMessageText(text, { chat_id: chatId, message_id: progressId });
        } catch (_) {
          progressId = null;
        }
      }

      console.log("[nas] Summarizing bin:", bin.recyclePath);
      const summary = await summarizeRecycleBin(
        bin.recyclePath,
        { previewLimit: 5 },
        config
      );
      console.log(
        "[nas] Completed summary",
        bin.recyclePath,
        "size=",
        summary.totalBytes,
        "files=",
        summary.totalFiles
      );
      binSummaries.push({
        ...bin,
        summary
      });
      totalBytes += summary.totalBytes;
      totalFiles += summary.totalFiles;
    }

    if (progressId) {
      try {
        await bot.deleteMessage(chatId, progressId);
      } catch (_) {}
    }

    if (binSummaries.every((b) => b.summary.entryCount === 0)) {
      await bot.sendMessage(chatId, "All recycle bins are already empty.");
      return;
    }

    const lines = [];
    lines.push("🗑 *NAS Recycle Bins*");
    lines.push(`Detected bins: ${binSummaries.length}`);
    lines.push(`Total files: ${totalFiles}`);
    lines.push(`Approximate size: *${formatBytes(totalBytes)}*`);
    lines.push("");

    binSummaries.forEach((bin, idx) => {
      lines.push(`${idx + 1}. *${bin.share}*`);
      lines.push(`   Path: \`${bin.recyclePath}\``);
      lines.push(
        `   Entries: ${bin.summary.entryCount} (${bin.summary.totalFiles} files)`
      );
      lines.push(`   Size: *${formatBytes(bin.summary.totalBytes)}*`);
      const preview = formatBinPreview(bin);
      if (preview) {
        lines.push(preview);
      }
      lines.push("");
    });

    lines.push(
      "Clear everything, pick a specific bin, or cancel. Deletions cannot be undone."
    );

    console.log("[nas] Sending summary message to chat", chatId);
    const summaryMsg = await bot.sendMessage(chatId, lines.join("\n"), {
      parse_mode: "Markdown",
      ...nasPrimaryKeyboard()
    });

    pending[chatId] = {
      mode: "nas_empty",
      bins: binSummaries,
      summaryMessageId: summaryMsg.message_id
    };
  } catch (err) {
    console.error("[nas] Failed to inspect recycle bins:", err);
    await bot.sendMessage(
      chatId,
      "Unable to read recycle-bin contents. Check NAS connectivity and permissions."
    );
  }
}

export async function handleNasFreeSpace(bot, chatId) {
  const config = loadConfig();
  const shareRoots = config.NAS_SHARE_ROOTS || [];

  if (shareRoots.length === 0) {
    await bot.sendMessage(
      chatId,
      "NAS paths are not configured. Set NAS_SHARE_ROOTS (comma-separated)."
    );
    return;
  }

  try {
    const status = await getStorageStatus(shareRoots, config);

    if (!status || status.length === 0) {
      await bot.sendMessage(chatId, "Could not read NAS storage info.");
      return;
    }

    const lines = [];
    lines.push("💽 *NAS Storage*");
    for (const entry of status) {
      const total = Number(entry.totalBytes || 0);
      const used = Number(entry.usedBytes || 0);
      const free = total > 0 ? Math.max(0, total - used) : Number(entry.availableBytes || 0);
      const pct = total > 0 ? Math.round((used / total) * 100) : Number(entry.usedPercent || 0);
      const usedPct = Math.max(0, Math.min(100, pct));

      const barLength = 10;
      const filled = Math.round((usedPct / 100) * barLength);
      const bar = "█".repeat(filled) + "░".repeat(barLength - filled);
      const label = entry.path || entry.mount || "(unknown)";
      lines.push(`• \`${label}\``);
      lines.push(
        `  ${bar} ${usedPct}% used — ${formatBytesDecimal(used)} / ${formatBytesDecimal(total)} (free: ${formatBytesDecimal(free)})`
      );
    }

    await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    console.error("[nas] Failed to fetch free space:", err);
    await bot.sendMessage(
      chatId,
      "Unable to check NAS free space. Verify SSH configuration and permissions."
    );
  }
}
