import { describe, expect, jest, test } from "@jest/globals";
import { createMockBot } from "../../helpers/mockBot.js";

const mockHandleRedownload = jest.fn();
const mockHandleListFullyWatched = jest.fn();
const mockHandleTidySeason = jest.fn();
const mockHandleDownloadSeason = jest.fn();
const mockHandleDownloadNextSeason = jest.fn();
const mockHandleAdvanceShow = jest.fn();
const mockHandleNasRecycleBin = jest.fn();
const mockHandleNasFreeSpace = jest.fn();
const mockHandleQbUnregistered = jest.fn();
const mockHandleAddMedia = jest.fn();
const mockHandleDownloadMovieSeries = jest.fn();

jest.unstable_mockModule("../../../src/router/tvHandler.js", () => ({
  handleRedownload: mockHandleRedownload,
  handleListFullyWatched: mockHandleListFullyWatched,
  handleTidySeason: mockHandleTidySeason,
  handleDownloadSeason: mockHandleDownloadSeason,
  handleDownloadNextSeason: mockHandleDownloadNextSeason,
  handleAdvanceShow: mockHandleAdvanceShow
}));

jest.unstable_mockModule("../../../src/router/nasHandler.js", () => ({
  handleNasRecycleBin: mockHandleNasRecycleBin,
  handleNasFreeSpace: mockHandleNasFreeSpace
}));

jest.unstable_mockModule("../../../src/router/qbittorrentHandler.js", () => ({
  handleQbUnregistered: mockHandleQbUnregistered
}));

jest.unstable_mockModule("../../../src/router/addMediaHandler.js", () => ({
  handleAddMedia: mockHandleAddMedia
}));

jest.unstable_mockModule("../../../src/router/movieSeriesHandler.js", () => ({
  handleDownloadMovieSeries: mockHandleDownloadMovieSeries
}));

const { routeIntent } = await import("../../../src/router/intentRouter.js");

describe("routeIntent", () => {
  test("routes redownload intent with enriched entities", async () => {
    const bot = createMockBot();
    const entities = { title: "Show", seasonNumber: 2, episodeNumber: 3 };

    await routeIntent(bot, 99, { intent: "redownload_tv", entities, reference: "raw ref" }, "stat");

    expect(mockHandleRedownload).toHaveBeenCalledWith(
      bot,
      99,
      expect.objectContaining({ reference: "raw ref" }),
      "stat"
    );
  });

  test("routes tidy intent and injects reference into entities", async () => {
    const bot = createMockBot();
    const entities = { title: "Show", seasonNumber: 1, episodeNumber: 0 };

    await routeIntent(bot, 10, { intent: "tidy_tv", entities, reference: "some ref" }, "status");

    expect(mockHandleTidySeason).toHaveBeenCalledWith(
      bot,
      10,
      expect.objectContaining({ reference: "some ref" }),
      "status"
    );
  });

  test("routes download season intent", async () => {
    const bot = createMockBot();
    const entities = { title: "Taskmaster", seasonNumber: 2, episodeNumber: 0 };
    await routeIntent(bot, 2, { intent: "download_season", entities, reference: "taskmaster s2" }, "s");
    expect(mockHandleDownloadSeason).toHaveBeenCalledWith(
      bot,
      2,
      expect.objectContaining({ reference: "taskmaster s2" }),
      "s"
    );
  });

  test("routes download next season intent", async () => {
    const bot = createMockBot();
    const entities = { title: "", seasonNumber: 0, episodeNumber: 0 };
    await routeIntent(
      bot,
      3,
      { intent: "download_next_season", entities, reference: "taskmaster" },
      "status"
    );
    expect(mockHandleDownloadNextSeason).toHaveBeenCalledWith(
      bot,
      3,
      expect.objectContaining({ reference: "taskmaster" }),
      "status"
    );
  });

  test("routes advance show intent", async () => {
    const bot = createMockBot();
    const entities = { title: "", seasonNumber: 0, episodeNumber: 0 };
    await routeIntent(bot, 4, { intent: "advance_show", entities, reference: "advance taskmaster" }, "stat");
    expect(mockHandleAdvanceShow).toHaveBeenCalledWith(
      bot,
      4,
      expect.objectContaining({ reference: "advance taskmaster" }),
      "stat"
    );
  });

  test("routes download movie series intent", async () => {
    const bot = createMockBot();
    await routeIntent(
      bot,
      15,
      { intent: "download_movie_series", entities: { title: "Final Destination" }, reference: "final destination" }
    );
    expect(mockHandleDownloadMovieSeries).toHaveBeenCalledWith(
      bot,
      15,
      expect.objectContaining({ reference: "final destination" }),
      undefined
    );
  });

  test("routes list fully watched intent", async () => {
    const bot = createMockBot();
    await routeIntent(bot, 1, { intent: "list_fully_watched_tv", entities: {}, reference: "x" });
    expect(mockHandleListFullyWatched).toHaveBeenCalledWith(bot, 1);
  });

  test("falls back to chatbot message for unknown intents", async () => {
    const bot = createMockBot();
    await routeIntent(bot, 1, { intent: "something_else", entities: {}, reference: "text" });
    expect(bot.sendMessage).toHaveBeenCalledWith(1, "Sorry, I didn’t understand that.");
  });

  test("routes add_movie/add_tv/add_media to handler with type hint", async () => {
    const bot = createMockBot();
    await routeIntent(
      bot,
      7,
      { intent: "add_movie", entities: { title: "Movie", year: 2020 }, reference: "Movie" }
    );
    expect(mockHandleAddMedia).toHaveBeenCalledWith(
      bot,
      7,
      expect.objectContaining({ type: "movie", reference: "Movie" })
    );

    await routeIntent(
      bot,
      8,
      { intent: "add_tv", entities: { title: "Show" }, reference: "Show" }
    );
    expect(mockHandleAddMedia).toHaveBeenCalledWith(
      bot,
      8,
      expect.objectContaining({ type: "tv", reference: "Show" })
    );

    await routeIntent(
      bot,
      9,
      { intent: "add_media", entities: { title: "Either" }, reference: "Either" }
    );
    expect(mockHandleAddMedia).toHaveBeenCalledWith(
      bot,
      9,
      expect.objectContaining({ reference: "Either" })
    );
  });

  test("detects movie series phrasing inside add_movie intent", async () => {
    const bot = createMockBot();
    await routeIntent(
      bot,
      21,
      { intent: "add_movie", entities: { title: "Final Destination" }, reference: "final destination movies" }
    );
    expect(mockHandleDownloadMovieSeries).toHaveBeenCalledWith(
      bot,
      21,
      expect.objectContaining({ reference: "final destination movies" }),
      undefined
    );
  });

  test("routes NAS recycle-bin intent", async () => {
    const bot = createMockBot();
    await routeIntent(bot, 9, { intent: "nas_empty_recycle_bin", entities: {}, reference: "" });
    expect(mockHandleNasRecycleBin).toHaveBeenCalledWith(bot, 9);
  });

  test("routes NAS free space intent", async () => {
    const bot = createMockBot();
    await routeIntent(bot, 10, { intent: "nas_check_free_space", entities: {}, reference: "" });
    expect(mockHandleNasFreeSpace).toHaveBeenCalledWith(bot, 10);
  });

  test("routes qb unregistered intents with scopes", async () => {
    const bot = createMockBot();
    await routeIntent(bot, 11, { intent: "qb_delete_unregistered", entities: {}, reference: "" });
    expect(mockHandleQbUnregistered).toHaveBeenCalledWith(bot, 11, "all");

    await routeIntent(bot, 12, { intent: "qb_delete_unregistered_tv", entities: {}, reference: "" });
    expect(mockHandleQbUnregistered).toHaveBeenCalledWith(bot, 12, "tv");

    await routeIntent(bot, 13, { intent: "qb_delete_unregistered_movies", entities: {}, reference: "" });
    expect(mockHandleQbUnregistered).toHaveBeenCalledWith(bot, 13, "movies");
  });
});
