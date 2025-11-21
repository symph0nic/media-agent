import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createMockBot } from "../../helpers/mockBot.js";

const mockSummarizeRecycleBin = jest.fn();
const mockDiscoverRecycleBins = jest.fn();
const mockGetStorageStatus = jest.fn();

jest.unstable_mockModule("../../../src/tools/nas.js", () => ({
  summarizeRecycleBin: mockSummarizeRecycleBin,
  discoverRecycleBins: mockDiscoverRecycleBins,
  getStorageStatus: mockGetStorageStatus
}));

jest.unstable_mockModule("../../../src/config.js", () => ({
  loadConfig: () => ({
    NAS_SHARE_ROOTS: ["/nas/share1", "/nas/share2"]
  })
}));

const { handleNasRecycleBin, handleNasFreeSpace } = await import("../../../src/router/nasHandler.js");
const { pending } = await import("../../../src/state/pending.js");

describe("handleNasRecycleBin", () => {
  beforeEach(() => {
    mockSummarizeRecycleBin.mockReset();
    mockDiscoverRecycleBins.mockReset();
    Object.keys(pending).forEach((key) => delete pending[key]);
  });

  test("reports already empty recycle bins", async () => {
    mockDiscoverRecycleBins.mockResolvedValue([{ share: "Media", recyclePath: "/nas/share1/@Recycle" }]);
    mockSummarizeRecycleBin.mockResolvedValue({
      entryCount: 0,
      totalFiles: 0,
      totalBytes: 0,
      preview: []
    });

    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({ message_id: 1 })
    });

    await handleNasRecycleBin(bot, 1);
    expect(bot.sendMessage).toHaveBeenCalledWith(1, "All recycle bins are already empty.");
  });

  test("summarises multiple recycle bins and stores pending state", async () => {
    mockDiscoverRecycleBins.mockResolvedValue([
      { share: "Media", recyclePath: "/nas/share1/@Recycle" },
      { share: "Backups", recyclePath: "/nas/share2/@Recycle" }
    ]);

    mockSummarizeRecycleBin
      .mockResolvedValueOnce({
        entryCount: 2,
        totalFiles: 5,
        totalBytes: 5120,
        preview: [{ name: "Show", type: "directory", sizeBytes: 4096, fileCount: 4 }]
      })
      .mockResolvedValueOnce({
        entryCount: 1,
        totalFiles: 2,
        totalBytes: 2048,
        preview: [{ name: "movie.mkv", type: "file", sizeBytes: 2048, fileCount: 1 }]
      });

    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({ message_id: 42 })
    });

    await handleNasRecycleBin(bot, 7);

    const summaryCall = bot.sendMessage.mock.calls.at(-1);
    expect(summaryCall[0]).toBe(7);
    expect(summaryCall[1]).toContain("NAS Recycle Bins");
    expect(summaryCall[2]).toMatchObject({ parse_mode: "Markdown" });
    expect(pending[7]).toMatchObject({
      mode: "nas_empty",
      summaryMessageId: expect.any(Number),
      bins: expect.arrayContaining([
        expect.objectContaining({ share: "Media" }),
        expect.objectContaining({ share: "Backups" })
      ])
    });
  });

  test("reports NAS free space", async () => {
    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({})
    });

    mockGetStorageStatus.mockResolvedValue([
      {
        path: "/nas/share1",
        mount: "/nas/share1",
        totalBytes: 1000,
        usedBytes: 400,
        availableBytes: 600,
        usedPercent: 40
      }
    ]);

    await handleNasFreeSpace(bot, 11);

    expect(bot.sendMessage).toHaveBeenCalledWith(
      11,
      expect.stringContaining("NAS Storage"),
      { parse_mode: "Markdown" }
    );
  });
});
