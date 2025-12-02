import { safeEditMessage } from "../telegram/safeEdit.js";
import {
  getCommand,
  getEpisodeById,
  runEpisodeSearch
} from "../tools/sonarr.js";
import { formatBytes } from "../tools/format.js";
import { sleep } from "../utils/timers.js";

const COMMAND_POLL_INTERVAL_MS = 5_000;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1_000;
const FILE_POLL_INTERVAL_MS = 10_000;
const FILE_TIMEOUT_MS = 5 * 60 * 1_000;
const MAX_ATTEMPTS = 3;

const activeMonitors = new Map();

function monitorKey(chatId, episodeId) {
  return `${chatId}:${episodeId}`;
}

export function startRedownloadMonitor(options) {
  const key = monitorKey(options.chatId, options.episodeId);
  const existing = activeMonitors.get(key);
  if (existing) {
    existing.cancel("superseded");
    activeMonitors.delete(key);
  }

  const monitor = new RedownloadMonitor(options);
  activeMonitors.set(key, monitor);

  const monitorPromise = monitor
    .start()
    .catch(err => {
      console.error("[redownload-monitor] Unexpected crash:", err);
    })
    .finally(() => {
      const current = activeMonitors.get(key);
      if (current === monitor) {
        activeMonitors.delete(key);
      }
    });

  return monitorPromise;
}

export function cancelRedownloadMonitor(chatId, episodeId) {
  const key = monitorKey(chatId, episodeId);
  const existing = activeMonitors.get(key);
  if (existing) {
    existing.cancel("cancelled");
    activeMonitors.delete(key);
  }
}

// Exposed only for tests.
export function _resetMonitorsForTests() {
  activeMonitors.forEach(m => m.cancel("reset"));
  activeMonitors.clear();
}

class RedownloadMonitor {
  constructor(options) {
    this.bot = options.bot;
    this.chatId = options.chatId;
    this.messageId = options.messageId;
    this.episodeId = options.episodeId;
    this.seriesTitle = options.seriesTitle || "Episode";
    this.episodeLabel = options.episodeLabel || "";
    this.commandId = options.commandId;
    this.previousFileId = options.previousFileId || 0;
    this.attempt = options.attempt || 1;
    this.maxAttempts = options.maxAttempts || MAX_ATTEMPTS;
    this.commandPollIntervalMs =
      options.commandPollIntervalMs || COMMAND_POLL_INTERVAL_MS;
    this.commandTimeoutMs = options.commandTimeoutMs || COMMAND_TIMEOUT_MS;
    this.filePollIntervalMs =
      options.filePollIntervalMs || FILE_POLL_INTERVAL_MS;
    this.fileTimeoutMs = options.fileTimeoutMs || FILE_TIMEOUT_MS;
    this.cancelled = false;
  }

  label() {
    return `${this.seriesTitle} ${this.episodeLabel}`.trim();
  }

  cancel(reason = "cancelled") {
    this.cancelled = true;
    if (reason) {
      console.log(`[redownload-monitor] Cancelled ${this.label()} – ${reason}`);
    }
  }

  async start() {
    if (this.cancelled) return;
    try {
      await this.monitorLoop();
    } catch (err) {
      console.error("[redownload-monitor] Monitor crashed:", err);
      if (!this.cancelled) {
        await this.updateMessage(
          `❌ ${this.label()}: monitoring failed (${err?.message || err}).`
        );
      }
    }
  }

  async monitorLoop() {
    while (!this.cancelled) {
      const state = await this.waitForCommandState();
      if (this.cancelled) return;

      if (state === "completed") {
        const fileInfo = await this.waitForEpisodeFile();
        if (this.cancelled) return;

        if (fileInfo) {
          await this.reportSuccess(fileInfo);
          return;
        }

        const retriedNoFile = await this.retry(
          "Sonarr finished but no new file appeared."
        );
        if (!retriedNoFile) return;
        continue;
      }

      if (state === "failed" || state === "aborted" || state === "timeout") {
        const reason =
          state === "timeout"
            ? "Sonarr command never completed."
            : `Sonarr reported \"${state}\".`;
        const retriedCommand = await this.retry(reason);
        if (!retriedCommand) return;
        continue;
      }

      const retriedUnknown = await this.retry(
        `Unexpected Sonarr command state: ${state || "unknown"}.`
      );
      if (!retriedUnknown) return;
    }
  }

  async waitForCommandState() {
    if (!this.commandId) {
      return "failed";
    }

    const startedAt = Date.now();
    while (!this.cancelled && Date.now() - startedAt < this.commandTimeoutMs) {
      try {
        const command = await getCommand(this.commandId);
        const state = (command?.state || command?.status || "").toLowerCase();

        if (["completed", "failed", "aborted"].includes(state)) {
          return state;
        }
      } catch (err) {
        console.error(
          `[redownload-monitor] Failed to poll command ${this.commandId}:`,
          err.message || err
        );
      }

      await sleep(this.commandPollIntervalMs);
    }

    return "timeout";
  }

  async waitForEpisodeFile() {
    const startedAt = Date.now();
    while (!this.cancelled && Date.now() - startedAt < this.fileTimeoutMs) {
      try {
        const episode = await getEpisodeById(this.episodeId);
        if (episode?.episodeFileId && episode.episodeFileId !== this.previousFileId) {
          const file = episode.episodeFile || {};
          return {
            fileId: episode.episodeFileId,
            size: file.size,
            quality:
              file.quality?.quality?.name ||
              file.quality?.name ||
              file.quality?.quality?.label ||
              "unknown quality"
          };
        }
      } catch (err) {
        console.error(
          `[redownload-monitor] Failed to load episode ${this.episodeId}:`,
          err.message || err
        );
      }

      await sleep(this.filePollIntervalMs);
    }

    return null;
  }

  async retry(reason) {
    if (this.cancelled) return false;

    if (this.attempt >= this.maxAttempts) {
      await this.reportFailure(reason);
      return false;
    }

    const nextAttempt = this.attempt + 1;

    await this.updateMessage(
      `⚠️ ${this.label()}: ${reason} Retrying (${nextAttempt}/${this.maxAttempts})…`
    );

    try {
      const result = await runEpisodeSearch(this.episodeId);
      if (!result?.id) {
        await this.reportFailure(
          "Sonarr did not provide a command id for the retry."
        );
        return false;
      }

      this.commandId = result.id;
      this.attempt = nextAttempt;
      return true;
    } catch (err) {
      console.error("[redownload-monitor] Failed to restart search:", err);
      await this.reportFailure("Unable to restart the Sonarr search.");
      return false;
    }
  }

  async reportSuccess(file) {
    if (this.cancelled) return;

    this.previousFileId = file.fileId || this.previousFileId;
    const sizeText = file.size ? formatBytes(file.size) : "unknown size";
    const qualityText = file.quality || "unknown quality";

    await this.updateMessage(
      `✅ ${this.label()} redownloaded (${qualityText}, ${sizeText}).`
    );
  }

  async reportFailure(reason) {
    if (this.cancelled) return;

    await this.updateMessage(
      `❌ ${this.label()} redownload failed. ${reason}`
    );
  }

  async updateMessage(text) {
    if (this.cancelled) return;

    try {
      await safeEditMessage(this.bot, this.chatId, this.messageId, text, {
        reply_markup: { inline_keyboard: [] }
      });
    } catch (err) {
      console.error(
        "[redownload-monitor] Failed to update Telegram message:",
        err.message || err
      );
    }
  }
}
