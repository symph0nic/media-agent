import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createMockBot } from "../../helpers/mockBot.js";

const mockDeleteEpisodeFile = jest.fn();
const mockRunEpisodeSearch = jest.fn();
const mockGetEpisodes = jest.fn();
const mockFindEpisode = jest.fn();
const mockGetSeriesById = jest.fn();
const mockUpdateSeries = jest.fn();
const mockEmptyRecycleBin = jest.fn();
const mockAddSeries = jest.fn();
const mockAddMovie = jest.fn();

jest.unstable_mockModule("../../../src/tools/sonarr.js", () => ({
  deleteEpisodeFile: mockDeleteEpisodeFile,
  runEpisodeSearch: mockRunEpisodeSearch,
  getEpisodes: mockGetEpisodes,
  findEpisode: mockFindEpisode,
  getSeriesById: mockGetSeriesById,
  updateSeries: mockUpdateSeries,
  addSeries: mockAddSeries,
  getSonarrRootFolders: jest.fn().mockResolvedValue([{ path: "/tv" }]),
  getSonarrQualityProfiles: jest.fn().mockResolvedValue([{ id: 1 }]),
  lookupSeries: jest.fn().mockResolvedValue([])
}));

jest.unstable_mockModule("../../../src/tools/nas.js", () => ({
  emptyRecycleBin: mockEmptyRecycleBin
}));

jest.unstable_mockModule("../../../src/tools/radarr.js", () => ({
  addMovie: mockAddMovie,
  lookupMovie: jest.fn().mockResolvedValue([]),
  getRadarrRootFolders: jest.fn().mockResolvedValue([{ path: "/movies" }]),
  getRadarrQualityProfiles: jest.fn().mockResolvedValue([{ id: 2 }])
}));

const mockSafeEditMessage = jest.fn();

jest.unstable_mockModule("../../../src/telegram/safeEdit.js", () => ({
  safeEditMessage: mockSafeEditMessage
}));

const mockBuildTidyConfirmation = jest.fn();
const mockHandleRedownload = jest.fn();

jest.unstable_mockModule("../../../src/router/tvHandler.js", () => ({
  buildTidyConfirmation: mockBuildTidyConfirmation,
  handleRedownload: mockHandleRedownload
}));

const mockFindSeriesInCache = jest.fn();

jest.unstable_mockModule("../../../src/cache/sonarrCache.js", () => ({
  findSeriesInCache: mockFindSeriesInCache
}));

jest.unstable_mockModule("../../../src/config.js", () => ({
  loadConfig: () => ({})
}));

const { handleCallback } = await import("../../../src/router/callbackHandler.js");
const { pending } = await import("../../../src/state/pending.js");

describe("callbackHandler redownload actions", () => {
  beforeEach(() => {
    Object.keys(pending).forEach((key) => delete pending[key]);
    mockSafeEditMessage.mockReset();
    mockDeleteEpisodeFile.mockReset();
    mockRunEpisodeSearch.mockReset();
    mockFindSeriesInCache.mockReset();
    mockAddSeries.mockReset();
    mockAddMovie.mockReset();
  });

  test("redl_yes deletes file and starts episode search", async () => {
    const bot = createMockBot({
      sendChatAction: jest.fn().mockResolvedValue(),
      answerCallbackQuery: jest.fn().mockResolvedValue()
    });

    pending[1] = {
      mode: "redownload",
      episodeFileId: 50,
      episodeId: 60
    };

    mockRunEpisodeSearch.mockResolvedValue({ status: "started" });

    await handleCallback(bot, {
      id: "cb",
      data: "redl_yes",
      message: { chat: { id: 1 }, message_id: 10 }
    });

    expect(mockDeleteEpisodeFile).toHaveBeenCalledWith(50);
    expect(mockRunEpisodeSearch).toHaveBeenCalledWith(60);
    expect(mockSafeEditMessage).toHaveBeenCalledWith(
      bot,
      1,
      10,
      "🔁 Episode deleted and redownload started!"
    );
    expect(pending[1]).toBeUndefined();
  });

  test("redl_yes_resolved resolves to Sonarr episode and starts search", async () => {
    const bot = createMockBot({
      sendChatAction: jest.fn().mockResolvedValue(),
      answerCallbackQuery: jest.fn().mockResolvedValue()
    });

    pending[3] = {
      mode: "redownload_resolved",
      best: { title: "Bake Off", seasonNumber: 1, episodeNumber: 2 }
    };

    mockFindSeriesInCache.mockReturnValue([{ id: 23, title: "Bake Off" }]);
    const ep = { id: 99, seasonNumber: 1, episodeNumber: 2, episodeFileId: 5 };
    mockGetEpisodes.mockResolvedValue([ep]);
    mockFindEpisode.mockReturnValue([ep]);
    mockRunEpisodeSearch.mockResolvedValue({ status: "queued" });

    await handleCallback(bot, {
      id: "cb",
      data: "redl_yes_resolved",
      message: { chat: { id: 3 }, message_id: 30 }
    });

    expect(mockFindSeriesInCache).toHaveBeenCalledWith([], "Bake Off");
    expect(mockGetEpisodes).toHaveBeenCalledWith(23);
    expect(mockFindEpisode).toHaveBeenCalledWith([ep], 1, 2);
    expect(mockDeleteEpisodeFile).toHaveBeenCalledWith(5);
    expect(mockRunEpisodeSearch).toHaveBeenCalledWith(99);
    expect(mockSafeEditMessage).toHaveBeenCalledWith(
      bot,
      3,
      30,
      "🔁 Redownload started for the latest episode."
    );
    expect(pending[3]).toBeUndefined();
  });
});

describe("callbackHandler tidy flows", () => {
  beforeEach(() => {
    Object.keys(pending).forEach((key) => delete pending[key]);
    mockSafeEditMessage.mockReset();
    mockDeleteEpisodeFile.mockReset();
    mockRunEpisodeSearch.mockReset();
    mockUpdateSeries.mockReset();
  });

  test("tidy_select rebuilds confirmation for new series", async () => {
    const bot = createMockBot({
      answerCallbackQuery: jest.fn().mockResolvedValue()
    });

    pending[2] = {
      mode: "tidy",
      season: 1,
      seriesList: [
        { id: 5, title: "Correct" },
        { id: 6, title: "Other" }
      ]
    };

    mockBuildTidyConfirmation.mockResolvedValue({
      msg: "confirm",
      fileIds: [1],
      sizeOnDisk: 123
    });

    await handleCallback(bot, {
      id: "cb",
      data: "tidy_select|5",
      message: { chat: { id: 2 }, message_id: 11 }
    });

    expect(mockBuildTidyConfirmation).toHaveBeenCalledWith(
      { id: 5, title: "Correct" },
      1,
      {}
    );
    expect(pending[2]).toMatchObject({
      seriesId: 5,
      fileIds: [1],
      sizeOnDisk: 123
    });
    expect(mockSafeEditMessage).toHaveBeenCalledWith(
      bot,
      2,
      11,
      "confirm",
      expect.objectContaining({ parse_mode: "Markdown" })
    );
  });

  test("tidy_yes deletes episode files and updates Sonarr seasons", async () => {
    const bot = createMockBot({
      sendChatAction: jest.fn().mockResolvedValue(),
      answerCallbackQuery: jest.fn().mockResolvedValue()
    });

    pending[3] = {
      mode: "tidy",
      fileIds: [10, 20],
      title: "Show",
      seriesId: 99,
      season: 2,
      sizeOnDisk: 2000000000
    };

    mockGetSeriesById.mockResolvedValue({
      seasons: [{ seasonNumber: 2, monitored: true }]
    });

    await handleCallback(bot, {
      id: "cb",
      data: "tidy_yes",
      message: { chat: { id: 3 }, message_id: 12 }
    });

    expect(mockDeleteEpisodeFile).toHaveBeenCalledTimes(2);
    expect(mockGetSeriesById).toHaveBeenCalledWith(99);
    expect(mockUpdateSeries).toHaveBeenCalledWith(
      99,
      expect.objectContaining({ seasons: expect.any(Array), monitored: true })
    );
    expect(mockSafeEditMessage).toHaveBeenCalledWith(
      bot,
      3,
      12,
      expect.stringContaining("Tidy-up complete!"),
      expect.objectContaining({ parse_mode: "Markdown" })
    );
    expect(pending[3]).toBeUndefined();
  });
});

describe("callbackHandler NAS recycle bin flows", () => {
  beforeEach(() => {
    Object.keys(pending).forEach((key) => delete pending[key]);
    mockEmptyRecycleBin.mockReset();
    mockSafeEditMessage.mockReset();
  });

  test("nas_clear_all empties all bins and reports freed space", async () => {
    const bot = createMockBot({
      sendChatAction: jest.fn().mockResolvedValue(),
      answerCallbackQuery: jest.fn().mockResolvedValue()
    });

    pending[5] = {
      mode: "nas_empty",
      bins: [
        {
          share: "Media",
          recyclePath: "/nas/share1/@Recycle",
          summary: { totalBytes: 1024 }
        },
        {
          share: "Backups",
          recyclePath: "/nas/share2/@Recycle",
          summary: { totalBytes: 2048 }
        }
      ],
      summaryMessageId: 13
    };

    mockEmptyRecycleBin.mockResolvedValue(4);

    await handleCallback(bot, {
      id: "cb",
      data: "nas_clear_all",
      message: { chat: { id: 5 }, message_id: 13 }
    });

    expect(mockSafeEditMessage).toHaveBeenNthCalledWith(
      1,
      bot,
      5,
      13,
      "🧼 Clearing all NAS recycle bins… please wait.",
      expect.objectContaining({
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [] }
      })
    );
    expect(mockEmptyRecycleBin).toHaveBeenNthCalledWith(
      1,
      "/nas/share1/@Recycle",
      expect.any(Object)
    );
    expect(mockEmptyRecycleBin).toHaveBeenNthCalledWith(
      2,
      "/nas/share2/@Recycle",
      expect.any(Object)
    );
    expect(mockSafeEditMessage).toHaveBeenNthCalledWith(
      2,
      bot,
      5,
      13,
      expect.stringContaining("Cleared all NAS recycle bins!"),
      expect.objectContaining({ parse_mode: "Markdown" })
    );
    expect(pending[5]).toBeUndefined();
  });

  test("nas_clear_pick opens selection keyboard", async () => {
    const bot = createMockBot({
      answerCallbackQuery: jest.fn().mockResolvedValue(),
      sendMessage: jest.fn().mockResolvedValue({ message_id: 99 })
    });

    pending[6] = {
      mode: "nas_empty",
      bins: [{ share: "Media", recyclePath: "/nas/share1/@Recycle", summary: {} }],
      summaryMessageId: 14
    };

    await handleCallback(bot, {
      id: "cb",
      data: "nas_clear_pick",
      message: { chat: { id: 6 }, message_id: 14 }
    });

    expect(bot.sendMessage).toHaveBeenCalledWith(
      6,
      "Select which recycle bin to empty:",
      expect.any(Object)
    );
    expect(pending[6].selectionMessageId).toBeDefined();
  });

  test("nas_clear_select empties chosen bin", async () => {
    const bot = createMockBot({
      sendChatAction: jest.fn().mockResolvedValue(),
      answerCallbackQuery: jest.fn().mockResolvedValue()
    });

    pending[7] = {
      mode: "nas_empty",
      bins: [
        {
          share: "Media",
          recyclePath: "/nas/share1/@Recycle",
          summary: { totalBytes: 1024 }
        }
      ],
      summaryMessageId: 42,
      selectionMessageId: 55
    };

    mockEmptyRecycleBin.mockResolvedValue(3);

    await handleCallback(bot, {
      id: "cb",
      data: "nas_clear_select|0",
      message: { chat: { id: 7 }, message_id: 15 }
    });

    expect(mockSafeEditMessage).toHaveBeenNthCalledWith(
      1,
      bot,
      7,
      42,
      "🧼 Clearing recycle bin for *Media*… please wait.",
      expect.objectContaining({ parse_mode: "Markdown" })
    );
    expect(mockEmptyRecycleBin).toHaveBeenCalledWith(
      "/nas/share1/@Recycle",
      expect.any(Object)
    );
    expect(mockSafeEditMessage).toHaveBeenNthCalledWith(
      2,
      bot,
      7,
      42,
      expect.stringContaining("recycle bin emptied"),
      expect.objectContaining({ parse_mode: "Markdown" })
    );
    expect(bot.deleteMessage).toHaveBeenCalledWith(7, 55);
    expect(pending[7]).toBeUndefined();
  });

  test("nas_clear_pick_cancel aborts selection message", async () => {
    const bot = createMockBot({
      answerCallbackQuery: jest.fn().mockResolvedValue()
    });

    pending[8] = { mode: "nas_empty", bins: [], selectionMessageId: 60 };

    await handleCallback(bot, {
      id: "cb",
      data: "nas_clear_pick_cancel",
      message: { chat: { id: 8 }, message_id: 16 }
    });

    expect(bot.deleteMessage).toHaveBeenCalledWith(8, 60);
  });

  test("nas_clear_cancel cancels cleanup entirely", async () => {
    const bot = createMockBot({
      answerCallbackQuery: jest.fn().mockResolvedValue()
    });

    pending[9] = { mode: "nas_empty", selectionMessageId: 70 };

    await handleCallback(bot, {
      id: "cb",
      data: "nas_clear_cancel",
      message: { chat: { id: 9 }, message_id: 17 }
    });

    expect(mockSafeEditMessage).toHaveBeenCalledWith(
      bot,
      9,
      17,
      "❌ Recycle-bin cleanup cancelled."
    );
    expect(bot.deleteMessage).toHaveBeenCalledWith(9, 70);
    expect(pending[9]).toBeUndefined();
  });
});
