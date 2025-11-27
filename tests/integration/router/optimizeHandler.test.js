import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createMockBot } from "../../helpers/mockBot.js";

const mockListAllMovies = jest.fn();
const mockGetRadarrQualityProfiles = jest.fn();
const mockEditMoviesQualityProfile = jest.fn();
const mockSearchMovies = jest.fn();

jest.unstable_mockModule("../../../src/tools/radarr.js", () => ({
  listAllMovies: mockListAllMovies,
  getRadarrQualityProfiles: mockGetRadarrQualityProfiles,
  editMoviesQualityProfile: mockEditMoviesQualityProfile,
  searchMovies: mockSearchMovies
}));

const optimizeModule = await import("../../../src/router/optimizeHandler.js");
const { handleOptimizeMovies, handleOptimizeCallback } = optimizeModule;
const { pending } = await import("../../../src/state/pending.js");

describe("optimize handler flows", () => {
  beforeEach(() => {
    mockListAllMovies.mockReset();
    mockGetRadarrQualityProfiles.mockReset();
    mockEditMoviesQualityProfile.mockReset();
    mockSearchMovies.mockReset();
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
      candidates: expect.any(Array),
      targetProfileId: 10,
      summaryMessageId: 99
    });
  });

  test("optm_cancel removes picker and summary messages", async () => {
    const bot = createMockBot();

    pending[7] = {
      mode: "optimize_movies",
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
    expect(bot.deleteMessage).toHaveBeenCalledWith(7, 111);
    expect(pending[7]).toBeUndefined();
  });

  test("optm_all tidies summary and triggers Radarr updates", async () => {
    const bot = createMockBot();
    mockEditMoviesQualityProfile.mockResolvedValue({});
    mockSearchMovies.mockResolvedValue({});

    pending[9] = {
      mode: "optimize_movies",
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
    expect(bot.deleteMessage).toHaveBeenCalledWith(9, 333);
    expect(mockEditMoviesQualityProfile).toHaveBeenCalledWith([1, 2], 55);
    expect(mockSearchMovies).toHaveBeenCalledWith([1, 2]);
    expect(pending[9]).toBeUndefined();
  });
});
