import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createMockBot } from "../../helpers/mockBot.js";

const mockGetEpisodes = jest.fn();
const mockFindEpisode = jest.fn();
const mockGetSeriesById = jest.fn();

jest.unstable_mockModule("../../../src/tools/sonarr.js", () => ({
  getEpisodes: mockGetEpisodes,
  findEpisode: mockFindEpisode,
  getSeriesById: mockGetSeriesById
}));

const mockGetCurrentlyWatchingShows = jest.fn();
const mockGetAllPlexShows = jest.fn();
const mockGetPlexSeasons = jest.fn();
const mockFuzzyMatchCW = jest.fn();

jest.unstable_mockModule("../../../src/tools/plex.js", () => ({
  getCurrentlyWatchingShows: mockGetCurrentlyWatchingShows,
  getAllPlexShows: mockGetAllPlexShows,
  getPlexSeasons: mockGetPlexSeasons,
  fuzzyMatchCW: mockFuzzyMatchCW
}));

const mockUpdateStatus = jest.fn();
const mockClearStatus = jest.fn();

jest.unstable_mockModule("../../../src/telegram/statusMessage.js", () => ({
  updateStatus: mockUpdateStatus,
  clearStatus: mockClearStatus
}));

const mockResolveCWAmbiguous = jest.fn();

jest.unstable_mockModule("../../../src/llm/classify.js", () => ({
  resolveCWAmbiguous: mockResolveCWAmbiguous
}));

jest.unstable_mockModule("../../../src/config.js", () => ({
  loadConfig: () => ({
    PLEX_URL: "http://plex",
    PLEX_TOKEN: "token",
    PLEX_TV_SECTION: "1"
  })
}));

const tvHandlerModule = await import("../../../src/router/tvHandler.js");
const {
  handleRedownload,
  handleTidySeason,
  handleListFullyWatched,
  buildTidyConfirmation
} = tvHandlerModule;
const { pending } = await import("../../../src/state/pending.js");

describe("tvHandler redownload flow", () => {
  beforeEach(() => {
    mockGetEpisodes.mockReset();
    mockFindEpisode.mockReset();
    mockGetCurrentlyWatchingShows.mockReset();
    mockFuzzyMatchCW.mockReset();
    mockResolveCWAmbiguous.mockReset();
    mockGetAllPlexShows.mockReset();
    mockGetPlexSeasons.mockReset();
    mockGetSeriesById.mockReset();
    Object.keys(pending).forEach((key) => delete pending[key]);
  });

  test("explicit redownload path selects series and stores pending state", async () => {
    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({})
    });

    global.sonarrCache = [
      { id: 10, title: "The Block (AU)" },
      { id: 11, title: "Other" }
    ];

    const mockEpisodes = [{ id: 1, seasonNumber: 2, episodeNumber: 3, episodeFileId: 5 }];
    mockGetEpisodes.mockResolvedValue(mockEpisodes);
    mockFindEpisode.mockReturnValue([mockEpisodes[0]]);

    await handleRedownload(
      bot,
      99,
      { title: "The Block", seasonNumber: 2, episodeNumber: 3, reference: "The Block" },
      "status-1"
    );

    expect(mockGetEpisodes).toHaveBeenCalledWith(10);
    expect(mockFindEpisode).toHaveBeenCalledWith(mockEpisodes, 2, 3);
    expect(pending[99]).toMatchObject({
      mode: "redownload",
      season: 2,
      episode: 3,
      episodeId: 1,
      episodeFileId: 5
    });
    expect(bot.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("Found"),
      expect.any(Object)
    );
  });

  test("ambiguous reference uses continue watching fuzzy results", async () => {
    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({ message_id: 200 }),
      deleteMessage: jest.fn().mockResolvedValue()
    });

    pending[1] = { mode: "redownload", messageId: 123 };

    mockGetCurrentlyWatchingShows.mockResolvedValue([
      {
        title: "Real Housewives",
        seasonNumber: 5,
        episodeNumber: 3,
        episodeTitle: "Drama",
        ratingKey: "rh"
      }
    ]);
    mockFuzzyMatchCW.mockReturnValue([
      {
        title: "Real Housewives",
        seasonNumber: 5,
        episodeNumber: 3,
        episodeTitle: "Drama",
        ratingKey: "rh"
      }
    ]);

    await handleRedownload(
      bot,
      1,
      { title: "", seasonNumber: 0, episodeNumber: 0, reference: "latest housewives" },
      "status"
    );

    expect(bot.deleteMessage).toHaveBeenCalledWith(1, 123);
    expect(bot.sendMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("Found *Real Housewives*"),
      expect.any(Object)
    );
    expect(pending[1]).toMatchObject({
      mode: "redownload_resolved",
      best: expect.objectContaining({ title: "Real Housewives" }),
      messageId: 200
    });
  });
});

describe("tidy/list fully watched helpers", () => {
  beforeEach(() => {
    Object.keys(pending).forEach((key) => delete pending[key]);
  });

  test("buildTidyConfirmation summarises Sonarr and Plex data", async () => {
    mockGetEpisodes.mockResolvedValue([
      { seasonNumber: 1, episodeFileId: 1 },
      { seasonNumber: 1, episodeFileId: 2 }
    ]);
    mockGetSeriesById.mockResolvedValue({
      seasons: [
        {
          seasonNumber: 1,
          statistics: {
            sizeOnDisk: 5000000000
          }
        }
      ]
    });
    mockGetAllPlexShows.mockResolvedValue([{ title: "Show", ratingKey: "abc" }]);
    mockGetPlexSeasons.mockResolvedValue([
      { seasonNumber: 1, viewedLeafCount: 8, leafCount: 10 }
    ]);

    const { msg, fileIds, sizeOnDisk } = await buildTidyConfirmation(
      { id: 5, title: "Show" },
      1,
      {}
    );

    expect(fileIds).toEqual([1, 2]);
    expect(sizeOnDisk).toBe(5000000000);
    expect(msg).toContain("Show");
    expect(msg).toContain("Watched: 8");
    expect(msg).toContain("Unwatched: 2");
  });

  test("handleTidySeason stores pending tidy state and sends confirmation", async () => {
    mockGetEpisodes.mockResolvedValue([
      { seasonNumber: 1, episodeFileId: 1 }
    ]);
    mockGetSeriesById.mockResolvedValue({
      seasons: [
        {
          seasonNumber: 1,
          statistics: { sizeOnDisk: 1000000000 }
        }
      ]
    });
    mockGetAllPlexShows.mockResolvedValue([{ title: "Show", ratingKey: "abc" }]);
    mockGetPlexSeasons.mockResolvedValue([
      { seasonNumber: 1, viewedLeafCount: 10, leafCount: 10 }
    ]);

    global.sonarrCache = [{ id: 5, title: "Show" }];
    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({})
    });

    await handleTidySeason(
      bot,
      7,
      { title: "Show", seasonNumber: 1, reference: "Show" },
      "status"
    );

    expect(bot.sendMessage).toHaveBeenCalledWith(
      7,
      expect.stringContaining("Confirm Tidy-Up"),
      expect.objectContaining({ parse_mode: "Markdown" })
    );
    expect(pending[7]).toMatchObject({
      mode: "tidy",
      seriesId: 5,
      season: 1,
      fileIds: [1]
    });
  });

  test("handleListFullyWatched aggregates Plex and Sonarr data", async () => {
    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({})
    });

    mockGetAllPlexShows.mockResolvedValue([{ title: "Plex Show", ratingKey: "rk" }]);
    mockGetPlexSeasons.mockResolvedValue([
      { seasonNumber: 1, viewedLeafCount: 10, leafCount: 10 }
    ]);

    global.sonarrCache = [{ id: 20, title: "Sonarr Show" }];
    mockGetSeriesById.mockResolvedValue({
      seasons: [
        {
          seasonNumber: 1,
          statistics: { episodeCount: 10, totalEpisodeCount: 10, sizeOnDisk: 6000000000 }
        }
      ]
    });

    await handleListFullyWatched(bot, 15);
    const lastCall = bot.sendMessage.mock.calls.at(-1);
    expect(lastCall[0]).toBe(15);
    expect(lastCall[1]).toContain("Fully watched seasons");
  });
});
