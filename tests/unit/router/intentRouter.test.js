import { describe, expect, jest, test } from "@jest/globals";
import { createMockBot } from "../../helpers/mockBot.js";

const mockHandleRedownload = jest.fn();
const mockHandleListFullyWatched = jest.fn();
const mockHandleTidySeason = jest.fn();
const mockHandleNasRecycleBin = jest.fn();
const mockHandleNasFreeSpace = jest.fn();
const mockHandleQbUnregistered = jest.fn();

jest.unstable_mockModule("../../../src/router/tvHandler.js", () => ({
  handleRedownload: mockHandleRedownload,
  handleListFullyWatched: mockHandleListFullyWatched,
  handleTidySeason: mockHandleTidySeason
}));

jest.unstable_mockModule("../../../src/router/nasHandler.js", () => ({
  handleNasRecycleBin: mockHandleNasRecycleBin,
  handleNasFreeSpace: mockHandleNasFreeSpace
}));

jest.unstable_mockModule("../../../src/router/qbittorrentHandler.js", () => ({
  handleQbUnregistered: mockHandleQbUnregistered
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

  test("supporting intents like add_movie send confirmation placeholders", async () => {
    const bot = createMockBot();
    await routeIntent(
      bot,
      7,
      { intent: "add_movie", entities: { title: "Movie", year: 2020 }, reference: "Movie" }
    );
    expect(bot.sendMessage).toHaveBeenCalledWith(7, "Add movie: Movie (2020)");
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
