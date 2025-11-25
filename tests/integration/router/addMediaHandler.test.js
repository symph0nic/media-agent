import { describe, expect, jest, test, beforeEach } from "@jest/globals";
import { createMockBot } from "../../helpers/mockBot.js";

const mockLookupSeries = jest.fn();
const mockLookupMovie = jest.fn();
const mockGetSonarrRootFolders = jest.fn();
const mockGetSonarrQualityProfiles = jest.fn();
const mockGetRadarrRootFolders = jest.fn();
const mockGetRadarrQualityProfiles = jest.fn();
const mockAddSeries = jest.fn();
const mockAddMovie = jest.fn();
const mockSafeEdit = jest.fn();

jest.unstable_mockModule("../../../src/tools/sonarr.js", () => ({
  lookupSeries: mockLookupSeries,
  getSonarrRootFolders: mockGetSonarrRootFolders,
  getSonarrQualityProfiles: mockGetSonarrQualityProfiles,
  addSeries: mockAddSeries
}));

jest.unstable_mockModule("../../../src/tools/radarr.js", () => ({
  lookupMovie: mockLookupMovie,
  getRadarrRootFolders: mockGetRadarrRootFolders,
  getRadarrQualityProfiles: mockGetRadarrQualityProfiles,
  addMovie: mockAddMovie
}));

jest.unstable_mockModule("../../../src/telegram/safeEdit.js", () => ({
  safeEditMessage: mockSafeEdit
}));

const { handleAddMedia, handleAddMediaCallback } = await import(
  "../../../src/router/addMediaHandler.js"
);
const { pending } = await import("../../../src/state/pending.js");

describe("addMedia handler", () => {
  beforeEach(() => {
    Object.keys(pending).forEach((k) => delete pending[k]);
    mockLookupSeries.mockReset();
    mockLookupMovie.mockReset();
    mockGetSonarrRootFolders.mockReset();
    mockGetSonarrQualityProfiles.mockReset();
    mockGetRadarrRootFolders.mockReset();
    mockGetRadarrQualityProfiles.mockReset();
    mockAddSeries.mockReset();
    mockAddMovie.mockReset();
    mockSafeEdit.mockReset();
  });

  test("shows first TV result with poster and stores pending", async () => {
    const bot = createMockBot({
      sendPhoto: jest.fn().mockResolvedValue({ message_id: 10 })
    });

    mockLookupSeries.mockResolvedValue([
      { title: "Severance", tvdbId: 1, images: [{ coverType: "poster", url: "poster.jpg" }] }
    ]);
    mockLookupMovie.mockResolvedValue([]);

    await handleAddMedia(bot, 5, { title: "Severance", type: "auto" });

    expect(bot.sendPhoto).toHaveBeenCalled();
    expect(pending[5]).toMatchObject({ mode: "add_media", kind: "tv", index: 0 });
  });

  test("addmedia_add adds via Sonarr and edits message", async () => {
    const bot = createMockBot({
      editMessageText: jest.fn().mockResolvedValue({})
    });
    pending[7] = {
      mode: "add_media",
      kind: "tv",
      candidates: [{ title: "Show", tvdbId: 2 }],
      index: 0,
      messageIsPhoto: false
    };
    mockGetSonarrRootFolders.mockResolvedValue([{ path: "/tv" }]);
    mockGetSonarrQualityProfiles.mockResolvedValue([{ id: 1 }]);
    mockAddSeries.mockResolvedValue({});

    await handleAddMediaCallback(bot, {
      id: "cb",
      data: "addmedia_add",
      message: { chat: { id: 7 }, message_id: 70 }
    });

    expect(mockAddSeries).toHaveBeenCalledWith(
      expect.objectContaining({ tvdbId: 2 }),
      expect.objectContaining({ rootFolderPath: "/tv", qualityProfileId: 1 })
    );
    expect(bot.editMessageText).toHaveBeenCalledWith(
      "✅ Added Show.",
      expect.objectContaining({ chat_id: 7, message_id: 70, parse_mode: "Markdown", reply_markup: { inline_keyboard: [] } })
    );
    expect(pending[7]).toBeUndefined();
  });

  test("chooser then switch between tv and movie keeps both candidate sets", async () => {
    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({ message_id: 11 }),
      sendPhoto: jest.fn().mockResolvedValue({ message_id: 12, photo: [{}] })
    });

    mockLookupSeries.mockResolvedValue([
      { title: "TV Hit", tvdbId: 10, images: [{ coverType: "poster", url: "http://t/poster.jpg" }] }
    ]);
    mockLookupMovie.mockResolvedValue([
      { title: "Movie Hit", tmdbId: 20, images: [{ coverType: "poster", url: "http://m/poster.jpg" }] }
    ]);

    await handleAddMedia(bot, 5, { title: "foo", type: "auto" });

    // choose movies first
    await handleAddMediaCallback(bot, {
      id: "cb",
      data: "addmedia_kind_movie",
      message: { chat: { id: 5 }, message_id: 11 }
    });

    // switch to tv
    await handleAddMediaCallback(bot, {
      id: "cb2",
      data: "addmedia_kind_tv",
      message: { chat: { id: 5 }, message_id: 12 }
    });

    expect(bot.sendPhoto).toHaveBeenCalled();
    expect(pending[5]).toMatchObject({
      mode: "add_media",
      kind: "tv",
      tvCandidates: expect.any(Array),
      movieCandidates: expect.any(Array)
    });
  });

  test("radarr add uses defaults", async () => {
    const bot = createMockBot({
      editMessageCaption: jest.fn().mockResolvedValue({})
    });
    pending[9] = {
      mode: "add_media",
      kind: "movie",
      candidates: [{ title: "Film", tmdbId: 30 }],
      index: 0,
      messageIsPhoto: true
    };
    mockGetRadarrRootFolders.mockResolvedValue([{ path: "/movies" }]);
    mockGetRadarrQualityProfiles.mockResolvedValue([{ id: 99, name: "Any" }]);
    mockAddMovie.mockResolvedValue({});

    await handleAddMediaCallback(bot, {
      id: "cb",
      data: "addmedia_add",
      message: { chat: { id: 9 }, message_id: 90 }
    });

    expect(mockAddMovie).toHaveBeenCalledWith(
      expect.objectContaining({ tmdbId: 30 }),
      expect.objectContaining({ rootFolderPath: "/movies", qualityProfileId: 99 })
    );
    expect(bot.editMessageCaption).toHaveBeenCalledWith(
      "✅ Added Film.",
      expect.objectContaining({ chat_id: 9, message_id: 90, parse_mode: "Markdown", reply_markup: { inline_keyboard: [] } })
    );
    expect(pending[9]).toBeUndefined();
  });

  test("cancel clears pending and confirms", async () => {
    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({})
    });
    pending[4] = {
      mode: "add_media",
      kind: "movie",
      candidates: [{ title: "X", tmdbId: 1 }],
      index: 0,
      messageIsPhoto: false
    };

    await handleAddMediaCallback(bot, {
      id: "cb",
      data: "addmedia_cancel",
      message: { chat: { id: 4 }, message_id: 44 }
    });

    expect(pending[4]).toBeUndefined();
    expect(bot.sendMessage).toHaveBeenCalledWith(4, "❌ Add cancelled.");
  });
});
