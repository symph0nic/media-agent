import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createMockBot } from "../../helpers/mockBot.js";

const mockListAllMovies = jest.fn();
const mockGetRadarrQualityProfiles = jest.fn();
const mockEditMoviesQualityProfile = jest.fn();
const mockSearchMovies = jest.fn();
const mockListAllSeries = jest.fn();
const mockGetSonarrQualityProfiles = jest.fn();
const mockUpdateSeries = jest.fn();
const mockRunSeriesSearch = jest.fn();
const mockGetEpisodes = jest.fn();

jest.unstable_mockModule("../../../src/tools/radarr.js", () => ({
  listAllMovies: mockListAllMovies,
  getRadarrQualityProfiles: mockGetRadarrQualityProfiles,
  editMoviesQualityProfile: mockEditMoviesQualityProfile,
  searchMovies: mockSearchMovies
}));

jest.unstable_mockModule("../../../src/tools/sonarr.js", () => ({
  listAllSeries: mockListAllSeries,
  getSonarrQualityProfiles: mockGetSonarrQualityProfiles,
  updateSeries: mockUpdateSeries,
  runSeriesSearch: mockRunSeriesSearch,
  getEpisodes: mockGetEpisodes
}));

const optimizeModule = await import("../../../src/router/optimizeHandler.js");
const {
  handleOptimizeMovies,
  handleOptimizeShows,
  handleOptimizeCallback,
  handleListTvProfiles,
  handleListMovieProfiles
} = optimizeModule;
const { pending } = await import("../../../src/state/pending.js");

describe("optimize handler flows", () => {
  beforeEach(() => {
    mockListAllMovies.mockReset();
    mockGetRadarrQualityProfiles.mockReset();
    mockEditMoviesQualityProfile.mockReset();
    mockSearchMovies.mockReset();
    mockListAllSeries.mockReset();
    mockGetSonarrQualityProfiles.mockReset();
    mockUpdateSeries.mockReset();
    mockRunSeriesSearch.mockReset();
    mockGetEpisodes.mockReset();
    Object.keys(pending).forEach((key) => delete pending[key]);
  });

  test("handleOptimizeMovies stores pending summary context", async () => {
    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({ message_id: 99 })
    });

    mockListAllMovies.mockResolvedValue([
      {
        id: 1,
        title: "Big Movie",
        sizeOnDisk: 60 * 1024 ** 3,
        hasFile: true,
        movieFile: { quality: { quality: { name: "WEB-DL" } } }
      }
    ]);
    mockGetRadarrQualityProfiles.mockResolvedValue([{ id: 10, name: "Good Enough" }]);

    await handleOptimizeMovies(bot, 5, { reference: "optimize" }, {});

    expect(bot.sendMessage).toHaveBeenCalledWith(
      5,
      expect.stringContaining("Optimization candidates"),
      expect.objectContaining({ reply_markup: expect.any(Object) })
    );
    expect(pending[5]).toMatchObject({
      mode: "optimize_movies",
      kind: "movie",
      candidates: expect.any(Array),
      targetProfileId: 10,
      summaryMessageId: 99
    });
  });

  test("handleOptimizeMovies skips entries already on target profile", async () => {
    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({ message_id: 10 })
    });

    mockListAllMovies.mockResolvedValue([
      {
        id: 1,
        title: "Already Good",
        sizeOnDisk: 80 * 1024 ** 3,
        hasFile: true,
        qualityProfileId: 5
      }
    ]);
    mockGetRadarrQualityProfiles.mockResolvedValue([
      { id: 5, name: "Best" }
    ]);

    await handleOptimizeMovies(bot, 8, { reference: "" });

    expect(bot.sendMessage).toHaveBeenCalledWith(
      8,
      "No movie results available for that query."
    );
    expect(pending[8]).toBeUndefined();
  });

  test("handleOptimizeShows inspects series quality even when nothing beats the target", async () => {
    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({ message_id: 12 })
    });
    mockListAllSeries.mockResolvedValue([
      {
        id: 30,
        title: "Huge Show",
        statistics: { sizeOnDisk: 80 * 1024 ** 3, episodeFileCount: 10 },
        qualityProfileId: 4
      }
    ]);
    mockGetSonarrQualityProfiles.mockResolvedValue([
      { id: 4, name: "Best" },
      {
        id: 6,
        name: "SD",
        cutoff: 6,
        items: [{ quality: { id: 6, name: "SDTV-480p" }, allowed: true }]
      }
    ]);
    mockGetEpisodes.mockImplementation(async () => [
      { episodeFile: { quality: { quality: { name: "WEBRip-1080p" } } } }
    ]);

    await handleOptimizeShows(bot, 9, { reference: "optimize tv to sd" });

    expect(mockGetEpisodes).toHaveBeenCalledWith(30);
    const summaryCall = bot.sendMessage.mock.calls[0];
    expect(summaryCall[0]).toBe(9);
    expect(summaryCall[1]).toContain("TV optimization candidates");
  });

  test("handleOptimizeShows still responds when defaults are used", async () => {
    const prevMin = process.env.OPTIMIZE_TV_MIN_SIZE_GB;
    const prevProfile = process.env.OPTIMIZE_TV_TARGET_PROFILE;
    process.env.OPTIMIZE_TV_MIN_SIZE_GB = "1";
    process.env.OPTIMIZE_TV_TARGET_PROFILE = "";

    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({ message_id: 77 })
    });

    mockListAllSeries.mockResolvedValue([
      {
        id: 20,
        title: "Big Show",
        statistics: { sizeOnDisk: 2 * 1024 ** 3, episodeFileCount: 10 },
        qualityProfileId: 5
      }
    ]);
    mockGetSonarrQualityProfiles.mockResolvedValue([
      {
        id: 3,
        name: "HD-1080p",
        cutoff: 3,
        items: [{ quality: { id: 3, name: "HDTV-1080p" }, allowed: true }]
      }
    ]);
    mockGetEpisodes.mockImplementation(async () => [
      { episodeFile: { quality: { quality: { name: "WEBRip-1080p" } } } }
    ]);

    await handleOptimizeShows(bot, 6, { reference: "" });

    expect(mockGetEpisodes).toHaveBeenCalledWith(20);
    expect(bot.sendMessage).toHaveBeenCalledWith(
      6,
      "No TV results available for that query."
    );

    process.env.OPTIMIZE_TV_MIN_SIZE_GB = prevMin;
    process.env.OPTIMIZE_TV_TARGET_PROFILE = prevProfile;
  });

  test("optm_cancel removes picker and summary messages", async () => {
    const bot = createMockBot();

    pending[7] = {
      mode: "optimize_movies",
      kind: "movie",
      candidates: [],
      selected: [],
      targetProfileId: 1,
      summaryMessageId: 111,
      selectionMessageId: 222
    };

    await handleOptimizeCallback(bot, {
      id: "cb",
      data: "optm_cancel",
      message: { chat: { id: 7 } }
    });

    expect(bot.deleteMessage).toHaveBeenCalledWith(7, 222);
    expect(bot.editMessageText).toHaveBeenCalledWith("❌ Optimization cancelled.", {
      chat_id: 7,
      message_id: 111,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [] }
    });
    expect(pending[7]).toBeUndefined();
  });

  test("optm_all tidies summary and triggers Radarr updates", async () => {
    const bot = createMockBot();
    mockEditMoviesQualityProfile.mockResolvedValue({});
    mockSearchMovies.mockResolvedValue({});

    pending[9] = {
      mode: "optimize_movies",
      kind: "movie",
      candidates: [
        { id: 1, title: "First", sizeOnDisk: 50, hasFile: true },
        { id: 2, title: "Second", sizeOnDisk: 60, hasFile: true }
      ],
      selected: [],
      targetProfileId: 55,
      summaryMessageId: 333,
      selectionMessageId: 444
    };

    await handleOptimizeCallback(bot, {
      id: "cb2",
      data: "optm_all",
      message: { chat: { id: 9 } }
    });

    expect(bot.deleteMessage).toHaveBeenCalledWith(9, 444);
    expect(bot.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("Optimization started for 2 movie(s)"),
      expect.objectContaining({
        chat_id: 9,
        message_id: 333,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [] }
      })
    );
    expect(mockEditMoviesQualityProfile).toHaveBeenCalledWith([1, 2], 55);
    expect(mockSearchMovies).toHaveBeenCalledWith([1, 2]);
    expect(pending[9]).toBeUndefined();
  });

  test("optm_all updates Sonarr quality profiles for TV", async () => {
    const bot = createMockBot();
    mockUpdateSeries.mockResolvedValue({});
    mockRunSeriesSearch.mockResolvedValue({});

    pending[11] = {
      mode: "optimize_tv",
      kind: "tv",
      candidates: [
        {
          id: 100,
          title: "Series A",
          statistics: { sizeOnDisk: 10, episodeFileCount: 5 },
          qualityProfileId: 1
        }
      ],
      selected: [],
      targetProfileId: 9,
      summaryMessageId: 600,
      selectionMessageId: 601
    };

    await handleOptimizeCallback(bot, {
      id: "cb3",
      data: "optm_all",
      message: { chat: { id: 11 } }
    });

    expect(bot.deleteMessage).toHaveBeenCalledWith(11, 601);
    expect(mockUpdateSeries).toHaveBeenCalledWith(
      100,
      expect.objectContaining({ qualityProfileId: 9 })
    );
    expect(mockRunSeriesSearch).toHaveBeenCalledWith([100]);
    expect(bot.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("series"),
      expect.objectContaining({
        chat_id: 11,
        message_id: 600,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [] }
      })
    );
    expect(pending[11]).toBeUndefined();
  });

  test("handleListTvProfiles prints available Sonarr profiles", async () => {
    const bot = createMockBot();
    mockGetSonarrQualityProfiles.mockResolvedValue([
      { id: 1, name: "Best" }
    ]);

    await handleListTvProfiles(bot, 70);

    expect(bot.sendMessage).toHaveBeenCalledWith(
      70,
      expect.stringContaining("Best"),
      expect.objectContaining({ parse_mode: "Markdown" })
    );
  });

  test("handleListMovieProfiles prints Radarr profiles", async () => {
    const bot = createMockBot();
    mockGetRadarrQualityProfiles.mockResolvedValue([
      { id: 2, name: "HD-1080p" }
    ]);

    await handleListMovieProfiles(bot, 71);

    expect(bot.sendMessage).toHaveBeenCalledWith(
      71,
      expect.stringContaining("HD-1080p"),
      expect.objectContaining({ parse_mode: "Markdown" })
    );
  });
});
    mockGetEpisodes.mockImplementation(async () => [
      { episodeFile: { quality: { quality: { name: "WEBDL-2160p" } } } }
    ]);
    mockGetEpisodes.mockImplementation(async () => [
      { episodeFile: { quality: { quality: { name: "WEBRip-2160p" } } } }
    ]);
