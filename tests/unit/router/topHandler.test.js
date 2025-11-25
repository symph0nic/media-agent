import { describe, expect, jest, test } from "@jest/globals";
import { createMockBot } from "../../helpers/mockBot.js";

const mockListAllSeries = jest.fn();
const mockListAllMovies = jest.fn();

jest.unstable_mockModule("../../../src/tools/sonarr.js", () => ({
  listAllSeries: mockListAllSeries
}));

jest.unstable_mockModule("../../../src/tools/radarr.js", () => ({
  listAllMovies: mockListAllMovies
}));

const { handleShowTop } = await import("../../../src/router/topHandler.js");

describe("handleShowTop", () => {
  test("shows top size tv", async () => {
    const bot = createMockBot();
    mockListAllSeries.mockResolvedValue([
      { title: "Big", statistics: { sizeOnDisk: 5000, episodeFileCount: 5 } },
      { title: "Small", statistics: { sizeOnDisk: 1000, episodeFileCount: 1 } }
    ]);

    await handleShowTop(bot, 1, { scope: "tv", metric: "size", reference: "largest" });

    expect(bot.sendMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining("Largest TV Shows"),
      expect.objectContaining({ parse_mode: "Markdown" })
    );
  });

  test("shows top rated movies", async () => {
    const bot = createMockBot();
    mockListAllMovies.mockResolvedValue([
      { title: "A", ratings: { imdb: { value: 9.0 } } },
      { title: "B", ratings: { value: 8.0 } }
    ]);

    await handleShowTop(bot, 2, { scope: "movie", metric: "rating", reference: "top rated" });

    expect(bot.sendMessage).toHaveBeenCalledWith(
      2,
      expect.stringContaining("Top-rated Movies"),
      expect.objectContaining({ parse_mode: "Markdown" })
    );
  });
});
