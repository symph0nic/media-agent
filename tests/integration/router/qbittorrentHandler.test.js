import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createMockBot } from "../../helpers/mockBot.js";

const mockFindUnregistered = jest.fn();
const mockDeleteTorrents = jest.fn();

jest.unstable_mockModule("../../../src/tools/qbittorrent.js", () => ({
  findUnregisteredTorrents: mockFindUnregistered,
  deleteTorrents: mockDeleteTorrents,
  formatTorrentList: (list) => list.map((t, i) => `${i + 1}. ${t.name}`).join("\n")
}));

jest.unstable_mockModule("../../../src/config.js", () => ({
  loadConfig: () => ({
    QBITTORRENT_TV_CATEGORY: "tv-cat",
    QBITTORRENT_MOVIE_CATEGORY: "movie-cat"
  })
}));

const { handleQbUnregistered, handleQbUnregisteredConfirm } = await import(
  "../../../src/router/qbittorrentHandler.js"
);
const { pending } = await import("../../../src/state/pending.js");

describe("qBittorrent unregistered handler", () => {
  beforeEach(() => {
    Object.keys(pending).forEach((k) => delete pending[k]);
    mockFindUnregistered.mockReset();
    mockDeleteTorrents.mockReset();
  });

  test("prompts with scoped label and truncates long list", async () => {
    mockFindUnregistered.mockResolvedValue(
      Array.from({ length: 25 }).map((_, i) => ({
        hash: `${i}`,
        name: `Torrent ${i + 1}`,
        size: 1000,
        added_on: i
      }))
    );

    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({ message_id: 77 })
    });

    await handleQbUnregistered(bot, 1, "tv");

    const text = bot.sendMessage.mock.calls[0][1];
    expect(text).toContain("Unregistered torrents detected (TV)");
    expect(text).toContain("…and 5 more");
    expect(pending[1]).toMatchObject({
      mode: "qb_unregistered",
      summaryMessageId: 77
    });
  });

  test("confirms deletion and edits summary message", async () => {
    const bot = createMockBot({
      editMessageText: jest.fn().mockResolvedValue(),
      sendMessage: jest.fn().mockResolvedValue()
    });

    pending[5] = {
      mode: "qb_unregistered",
      summaryMessageId: 10,
      torrents: [{ hash: "a", name: "A", size: 1000 }]
    };

    mockDeleteTorrents.mockResolvedValue(1);

    await handleQbUnregisteredConfirm(bot, 5, pending[5]);

    expect(mockDeleteTorrents).toHaveBeenCalledWith(expect.any(Object), ["a"], true);
    expect(bot.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("Deleted 1 unregistered"),
      expect.objectContaining({ chat_id: 5, message_id: 10, parse_mode: "Markdown" })
    );
    expect(pending[5]).toBeUndefined();
  });
});
