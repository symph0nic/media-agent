import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createMockBot } from "../../helpers/mockBot.js";

const mockGetSeriesById = jest.fn();
const mockListAllMovies = jest.fn();
const mockGetAllPlexShows = jest.fn();
const mockGetPlexSeasons = jest.fn();
const mockFindSeriesInCache = jest.fn();

jest.unstable_mockModule("../../../src/tools/sonarr.js", () => ({
  getSeriesById: mockGetSeriesById
}));

jest.unstable_mockModule("../../../src/tools/radarr.js", () => ({
  listAllMovies: mockListAllMovies
}));

jest.unstable_mockModule("../../../src/tools/plex.js", () => ({
  getAllPlexShows: mockGetAllPlexShows,
  getPlexSeasons: mockGetPlexSeasons
}));

jest.unstable_mockModule("../../../src/cache/sonarrCache.js", () => ({
  findSeriesInCache: mockFindSeriesInCache
}));

jest.unstable_mockModule("../../../src/config.js", () => ({
  loadConfig: () => ({
    PLEX_URL: "http://plex",
    PLEX_TOKEN: "token",
    PLEX_TV_SECTION: "2"
  })
}));

const { handleHaveMedia, buildAddKeyboard } = await import("../../../src/router/haveMediaHandler.js");

describe("haveMediaHandler", () => {
  beforeEach(() => {
    mockGetSeriesById.mockReset();
    mockListAllMovies.mockReset();
    mockGetAllPlexShows.mockReset();
    mockGetPlexSeasons.mockReset();
    mockFindSeriesInCache.mockReset();
  });

  test("summarises Sonarr seasons with Plex watch stats", async () => {
    const bot = createMockBot();

    mockFindSeriesInCache.mockReturnValue([{ id: 10, title: "Luther" }]);
    mockGetSeriesById.mockResolvedValue({
      title: "Luther",
      statistics: { sizeOnDisk: 5000000000 },
      seasons: [
        {
          seasonNumber: 1,
          monitored: true,
          statistics: { episodeCount: 6, episodeFileCount: 6 }
        },
        {
          seasonNumber: 2,
          monitored: false,
          statistics: { episodeCount: 4, episodeFileCount: 2 }
        }
      ]
    });
    mockGetAllPlexShows.mockResolvedValue([{ title: "Luther", ratingKey: "rk1" }]);
    mockGetPlexSeasons.mockResolvedValue([
      { seasonNumber: 1, viewedLeafCount: 6, leafCount: 6 },
      { seasonNumber: 2, viewedLeafCount: 4, leafCount: 4 }
    ]);

    await handleHaveMedia(
      bot,
      1,
      { title: "Luther", reference: "Luther", seasonNumber: 0, type: "tv" }
    );

    expect(bot.sendMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("Luther"),
      expect.objectContaining({ parse_mode: "Markdown" })
    );
    const body = bot.sendMessage.mock.calls[0][1];
    expect(body).toContain("S1");
    expect(body).toContain("Fully downloaded");
    expect(body).toContain("fully watched");
  });

  test("detects cleaned-up series and reports accordingly", async () => {
    const bot = createMockBot();

    mockFindSeriesInCache.mockReturnValue([{ id: 12, title: "Finished Show" }]);
    mockGetSeriesById.mockResolvedValue({
      title: "Finished Show",
      statistics: { episodeFileCount: 0 },
      seasons: [
        { seasonNumber: 1, monitored: false, statistics: { episodeCount: 10, episodeFileCount: 0 } }
      ],
      ended: true
    });
    mockGetAllPlexShows.mockResolvedValue([]);

    await handleHaveMedia(
      bot,
      6,
      { title: "Finished Show", reference: "Finished Show", type: "tv" }
    );

    const body = bot.sendMessage.mock.calls[0][1];
    expect(body).toContain("finished");
    expect(body).toContain("cleaned");
  });

  test("tv not found suggests adding", async () => {
    const bot = createMockBot();
    mockFindSeriesInCache.mockReturnValue([]);

    await handleHaveMedia(
      bot,
      2,
      { title: "Some Show", reference: "Some Show", seasonNumber: 0, type: "tv" }
    );

    const options = bot.sendMessage.mock.calls[0][2];
    expect(options.reply_markup.inline_keyboard[0][0].callback_data).toContain("haveadd|tv|");
  });

  test("summarises Radarr movie download status", async () => {
    const bot = createMockBot();
    mockListAllMovies.mockResolvedValue([
      {
        id: 1,
        title: "Spider-Man",
        year: 2018,
        hasFile: true,
        monitored: true,
        movieFile: {
          size: 40000000000,
          quality: { quality: { name: "WEB-DL 2160p" } }
        }
      }
    ]);

    await handleHaveMedia(
      bot,
      3,
      { title: "Spider-Man", reference: "Spider-Man", type: "movie" }
    );

    const message = bot.sendMessage.mock.calls[0][1];
    expect(message).toContain("Spider-Man");
    expect(message).toContain("Downloaded");
  });

  test("movie not found suggests add button", async () => {
    const bot = createMockBot();
    mockListAllMovies.mockResolvedValue([
      { id: 1, title: "Known Movie", hasFile: false }
    ]);

    await handleHaveMedia(
      bot,
      4,
      { title: "Unknown", reference: "Unknown", type: "movie" }
    );

    const options = bot.sendMessage.mock.calls[0][2];
    expect(options.reply_markup.inline_keyboard[0][0].callback_data).toContain("haveadd|movie|");
  });
});
