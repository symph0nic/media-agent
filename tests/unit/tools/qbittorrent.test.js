import { describe, expect, jest, test } from "@jest/globals";

const mockPost = jest.fn();
const mockGet = jest.fn();

jest.unstable_mockModule("axios", () => ({
  default: {
    post: mockPost,
    create: () => ({ get: mockGet, post: mockPost })
  }
}));

const qb = await import("../../../src/tools/qbittorrent.js");
const {
  findUnregisteredTorrents,
  deleteTorrents,
  formatTorrentList
} = qb;

const baseConfig = {
  QBITTORRENT_URL: "http://qb",
  QBITTORRENT_USERNAME: "user",
  QBITTORRENT_PASSWORD: "pass"
};

describe("qbittorrent helpers", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockReset();
    mockPost.mockResolvedValue({ headers: { "set-cookie": ["SID=abc"] } });
  });

  test("findUnregisteredTorrents filters by tracker message and category", async () => {
    mockGet
      .mockResolvedValueOnce({
        data: [
          { hash: "a", name: "A", size: 100, added_on: 1, category: "tv" },
          { hash: "b", name: "B", size: 200, added_on: 2, category: "movies" }
        ]
      })
      .mockResolvedValueOnce({
        data: [
          { msg: "unregistered torrent" },
          { msg: "ok" }
        ]
      })
      .mockResolvedValueOnce({
        data: [
          { msg: "working" }
        ]
      });

    const res = await findUnregisteredTorrents(baseConfig, { category: "tv" });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ hash: "a", name: "A" });
  });

  test("deleteTorrents posts deleteFiles true and returns count", async () => {
    const count = await deleteTorrents(baseConfig, ["a", "b"]);
    expect(count).toBe(2);
    const deleteCall = mockPost.mock.calls.find((call) => call[0] === "/torrents/delete");
    expect(deleteCall[1]).toContain("hashes=a%7Cb");
  });

  test("formatTorrentList formats numbered list with sizes", () => {
    const txt = formatTorrentList([
      { name: "One", size: 1000 },
      { name: "Two", size: 2000 }
    ]);
    expect(txt).toContain("1. One");
    expect(txt).toContain("2. Two");
  });
});
