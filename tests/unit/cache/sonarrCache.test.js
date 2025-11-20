import { describe, expect, test } from "@jest/globals";
import { findSeriesInCache } from "../../../src/cache/sonarrCache.js";

const sampleCache = [
  { id: 1, title: "The Block (AU)" },
  { id: 2, title: "The Block (US)" },
  { id: 3, title: "House of the Dragon" },
  { id: 4, title: "Planet Earth" }
];

describe("findSeriesInCache", () => {
  test("returns best ranked matches ordered by similarity", () => {
    const results = findSeriesInCache(sampleCache, "house of the dragon");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("House of the Dragon");
  });

  test("favors entries with matching region words when provided", () => {
    const [first, second] = findSeriesInCache(sampleCache, "the block us");
    expect(first.title).toBe("The Block (US)");
    expect(second.title).toBe("The Block (AU)");
  });

  test("filters out weak matches below relevance threshold", () => {
    const results = findSeriesInCache(sampleCache, "completely unrelated");
    expect(results).toEqual([]);
  });
});
