import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockAxiosGet = jest.fn();

jest.unstable_mockModule("axios", () => ({
  default: { get: mockAxiosGet }
}));

const plexModule = await import("../../../src/tools/plex.js");
const {
  plexRequest,
  getAllPlexShows,
  getPlexSeasons,
  getCurrentlyWatchingShows,
  getContinueWatching,
  fuzzyMatchCW
} = plexModule;

beforeEach(() => {
  mockAxiosGet.mockReset();
});
describe("plexRequest", () => {
  test("returns Plex MediaContainer payload", async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { MediaContainer: { key: "value" } } });
    const config = { PLEX_URL: "http://plex" };

    const result = await plexRequest(config, "/foo");
    expect(mockAxiosGet).toHaveBeenCalledWith("http://plex/foo", {
      headers: {
        "X-Plex-Token": undefined,
        Accept: "application/json"
      }
    });
    expect(result).toEqual({ key: "value" });
  });

  test("bubbles up request errors", async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error("boom"));
    await expect(plexRequest({ PLEX_URL: "http://plex" }, "/bad")).rejects.toThrow(
      "boom"
    );
  });
});

describe("higher level Plex helpers", () => {
  test("getAllPlexShows flattens metadata and filters invalid entries", async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        MediaContainer: {
          Metadata: [
            { title: "Show A", ratingKey: "1" },
            { title: "", ratingKey: "2" }
          ]
        }
      }
    });

    const config = { PLEX_URL: "http://plex", PLEX_TV_SECTION: "43" };
    const shows = await getAllPlexShows(config);
    expect(shows).toEqual([{ title: "Show A", ratingKey: "1" }]);
  });

  test("getPlexSeasons normalises numeric fields", async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        MediaContainer: {
          Metadata: [
            {
              title: "Season 1",
              index: "1",
              ratingKey: "s1",
              year: "2023",
              leafCount: "10",
              viewedLeafCount: "5",
              lastViewedAt: "1234567"
            }
          ]
        }
      }
    });

    const result = await getPlexSeasons({ PLEX_URL: "http://plex", PLEX_TOKEN: "token" }, "show-1");
    expect(result[0]).toEqual({
      title: "Season 1",
      seasonNumber: 1,
      ratingKey: "s1",
      year: 2023,
      leafCount: 10,
      viewedLeafCount: 5,
      lastViewedAt: 1234567
    });
  });

  test("getCurrentlyWatchingShows filters and sorts by progress/recency", async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        MediaContainer: {
          Hub: [
            {
              title: "Continue Watching",
              Metadata: [
                {
                  grandparentTitle: "Paused",
                  duration: 100,
                  viewOffset: 0,
                  lastViewedAt: 20
                },
                {
                  grandparentTitle: "Watching",
                  duration: 100,
                  viewOffset: 50,
                  lastViewedAt: 30
                },
                {
                  grandparentTitle: "Finished",
                  duration: 100,
                  viewOffset: 100,
                  lastViewedAt: 10
                }
              ]
            }
          ]
        }
      }
    });

    const list = await getCurrentlyWatchingShows({ PLEX_URL: "http://plex", PLEX_TOKEN: "token" });
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Watching");
  });
});

describe("getContinueWatching + fuzzyMatch", () => {
  test("getContinueWatching converts Plex hub payload", async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        MediaContainer: {
          Hub: [
            { title: "other", Metadata: [] },
            {
              title: "Continue Watching",
              Metadata: [
                {
                  grandparentTitle: "Show",
                  title: "Episode",
                  ratingKey: "123",
                  parentIndex: "2",
                  index: "5",
                  duration: "100",
                  viewOffset: "50",
                  lastViewedAt: "555",
                  type: "episode",
                  year: "2024"
                }
              ]
            }
          ]
        }
      }
    });

    const cw = await getContinueWatching({ PLEX_URL: "http://plex", PLEX_TOKEN: "t" });
    expect(cw[0]).toEqual({
      title: "Show",
      ratingKey: "123",
      episodeTitle: "Episode",
      seasonNumber: 2,
      episodeNumber: 5,
      duration: 100,
      viewOffset: 50,
      percent: 50,
      lastViewedAt: 555,
      type: "episode",
      year: 2024
    });
  });

  test("fuzzyMatchCW performs case-insensitive containment match", () => {
    const cw = [
      { title: "Real Housewives of Sydney" },
      { title: "Top Chef" }
    ];

    const matches = fuzzyMatchCW(cw, "housewives");
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toContain("Housewives");
  });
});
