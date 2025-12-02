import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockSafeEditMessage = jest.fn();
const mockGetCommand = jest.fn();
const mockGetEpisodeById = jest.fn();
const mockRunEpisodeSearch = jest.fn();
const mockSleep = jest.fn().mockResolvedValue();

jest.unstable_mockModule("../../../src/telegram/safeEdit.js", () => ({
  safeEditMessage: mockSafeEditMessage
}));

jest.unstable_mockModule("../../../src/tools/sonarr.js", () => ({
  getCommand: mockGetCommand,
  getEpisodeById: mockGetEpisodeById,
  runEpisodeSearch: mockRunEpisodeSearch
}));

jest.unstable_mockModule("../../../src/utils/timers.js", () => ({
  sleep: mockSleep
}));

const { startRedownloadMonitor, _resetMonitorsForTests } = await import(
  "../../../src/redownload/redownloadMonitor.js"
);

describe("redownload monitor", () => {
  beforeEach(() => {
    mockSafeEditMessage.mockReset();
    mockGetCommand.mockReset();
    mockGetEpisodeById.mockReset();
    mockRunEpisodeSearch.mockReset();
    mockSleep.mockReset().mockResolvedValue();
    _resetMonitorsForTests();
  });

  afterEach(() => {
    _resetMonitorsForTests();
  });

  test("reports success once Sonarr finishes and a new file exists", async () => {
    mockGetCommand.mockResolvedValue({ state: "completed" });
    mockGetEpisodeById.mockResolvedValue({
      episodeFileId: 501,
      episodeFile: {
        size: 1500,
        quality: { quality: { name: "HD-1080p" } }
      }
    });

    await startRedownloadMonitor({
      bot: {},
      chatId: 123,
      messageId: 55,
      episodeId: 777,
      commandId: 42,
      previousFileId: 10,
      seriesTitle: "The Show",
      episodeLabel: "S1E1",
      maxAttempts: 1,
      commandPollIntervalMs: 1,
      filePollIntervalMs: 1
    });

    expect(mockSafeEditMessage).toHaveBeenCalledTimes(1);
    const [, , , text] = mockSafeEditMessage.mock.calls[0];
    expect(text).toContain("✅");
    expect(text).toContain("The Show S1E1");
    expect(text).toContain("HD-1080p");
  });

  test("retries a failed command and eventually reports success", async () => {
    mockGetCommand
      .mockResolvedValueOnce({ state: "failed" })
      .mockResolvedValueOnce({ state: "completed" });

    mockRunEpisodeSearch.mockResolvedValueOnce({ id: 2002 });

    mockGetEpisodeById.mockResolvedValue({
      episodeFileId: 999,
      episodeFile: {
        size: 8_192,
        quality: { quality: { name: "HD-720p" } }
      }
    });

    await startRedownloadMonitor({
      bot: {},
      chatId: 1,
      messageId: 2,
      episodeId: 300,
      commandId: 1001,
      seriesTitle: "Retry Show",
      episodeLabel: "S5E10",
      commandPollIntervalMs: 1,
      filePollIntervalMs: 1
    });

    expect(mockRunEpisodeSearch).toHaveBeenCalledWith(300);
    expect(mockSafeEditMessage).toHaveBeenCalledTimes(2);

    const retryMessage = mockSafeEditMessage.mock.calls[0][3];
    expect(retryMessage).toContain("Retrying (2/3)");
    expect(retryMessage).toContain("Retry Show S5E10");

    const successMessage = mockSafeEditMessage.mock.calls[1][3];
    expect(successMessage).toContain("✅");
    expect(successMessage).toContain("HD-720p");
  });
});
