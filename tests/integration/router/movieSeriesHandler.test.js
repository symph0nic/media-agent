import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createMockBot } from "../../helpers/mockBot.js";

process.env.TMDB_API_KEY = "tmdb-test";

const mockSearchCollections = jest.fn();
const mockGetCollectionDetails = jest.fn();

jest.unstable_mockModule("../../../src/tools/tmdb.js", () => ({
  searchCollections: mockSearchCollections,
  getCollectionDetails: mockGetCollectionDetails
}));

const mockGetRadarrRootFolders = jest.fn();
const mockGetRadarrQualityProfiles = jest.fn();
const mockAddMovie = jest.fn();
const mockListAllMovies = jest.fn();

jest.unstable_mockModule("../../../src/tools/radarr.js", () => ({
  getRadarrRootFolders: mockGetRadarrRootFolders,
  getRadarrQualityProfiles: mockGetRadarrQualityProfiles,
  addMovie: mockAddMovie,
  listAllMovies: mockListAllMovies
}));

const mockSafeEditMessage = jest.fn();

jest.unstable_mockModule("../../../src/telegram/safeEdit.js", () => ({
  safeEditMessage: mockSafeEditMessage
}));

const { handleDownloadMovieSeries, handleMovieSeriesCallback } = await import(
  "../../../src/router/movieSeriesHandler.js"
);
const { pending } = await import("../../../src/state/pending.js");

describe("movieSeriesHandler", () => {
  beforeEach(() => {
    mockSearchCollections.mockReset();
    mockGetCollectionDetails.mockReset();
    mockGetRadarrRootFolders.mockReset();
    mockGetRadarrQualityProfiles.mockReset();
    mockAddMovie.mockReset();
    mockListAllMovies.mockReset();
    mockSafeEditMessage.mockReset();
    Object.keys(pending).forEach((key) => delete pending[key]);
  });

  test("prompts for collection selection when multiple matches exist", async () => {
    const bot = createMockBot();
    mockSearchCollections.mockResolvedValue([
      { id: 1, name: "Final Destination Collection" },
      { id: 2, name: "Another Collection" }
    ]);

    await handleDownloadMovieSeries(bot, 1, { reference: "final destination" });

    expect(bot.sendMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("I found multiple collections"),
      expect.any(Object)
    );
    expect(pending[1].mode).toBe("movie_series_pick");
    expect(pending[1].choices).toHaveLength(2);
  });

  test("confirms and adds movies from a collection", async () => {
    const bot = createMockBot();

    mockSearchCollections.mockResolvedValue([
      { id: 10, name: "Final Destination Collection" }
    ]);

    mockGetCollectionDetails.mockResolvedValue({
      id: 10,
      name: "Final Destination Collection",
      parts: [
        { tmdbId: 100, title: "Final Destination" },
        { tmdbId: 101, title: "Final Destination 2" },
        { tmdbId: 102, title: "Final Destination 3" }
      ]
    });

    mockGetRadarrRootFolders.mockResolvedValue([{ path: "/movies" }]);
    mockGetRadarrQualityProfiles.mockResolvedValue([{ id: 5, name: "Any" }]);
    mockListAllMovies.mockResolvedValue([{ tmdbId: 101 }]);

    await handleDownloadMovieSeries(bot, 2, { reference: "final destination" });

    const state = pending[2];
    expect(state.mode).toBe("movie_series_confirm");
    expect(bot.sendMessage).toHaveBeenCalledWith(
      2,
      expect.stringContaining("Final Destination Collection"),
      expect.any(Object)
    );

    await handleMovieSeriesCallback(bot, {
      message: { chat: { id: 2 }, message_id: 1 },
      data: "ms_confirm"
    });

    expect(mockAddMovie).toHaveBeenCalledTimes(2);
    expect(mockSafeEditMessage).toHaveBeenCalledWith(
      bot,
      2,
      expect.any(Number),
      expect.stringContaining("Added 2 movies."),
      expect.any(Object)
    );
    expect(pending[2]).toBeUndefined();
  });
});
