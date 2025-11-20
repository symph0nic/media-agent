import { afterAll, describe, expect, test } from "@jest/globals";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  summarizeRecycleBin,
  emptyRecycleBin,
  discoverRecycleBins
} from "../../../src/tools/nas.js";

async function createTempRecycleBin() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nas-bin-"));
  await fs.writeFile(path.join(dir, "file1.mkv"), Buffer.alloc(1024));

  const nestedDir = path.join(dir, "Show");
  await fs.mkdir(nestedDir);
  await fs.writeFile(path.join(nestedDir, "episode.mkv"), Buffer.alloc(2048));

  return dir;
}

describe("NAS tools", () => {
  const createdDirs = [];

  afterAll(async () => {
    await Promise.all(
      createdDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }))
    );
  });

  test("summarizeRecycleBin provides totals and previews", async () => {
    const tempDir = await createTempRecycleBin();
    createdDirs.push(tempDir);
    const summary = await summarizeRecycleBin(tempDir);

    expect(summary.entryCount).toBe(2);
    expect(summary.totalFiles).toBe(2);
    expect(summary.totalBytes).toBe(1024 + 2048);
    expect(summary.preview[0].name).toBe("Show");
  });

  test("emptyRecycleBin removes contents", async () => {
    const tempDir = await createTempRecycleBin();
    createdDirs.push(tempDir);
    const removed = await emptyRecycleBin(tempDir);
    expect(removed).toBe(2);

    const remaining = await fs.readdir(tempDir);
    expect(remaining).toHaveLength(0);
  });

  test("discoverRecycleBins finds recycle folders under share roots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nas-root-"));
    createdDirs.push(root);

    const shareA = path.join(root, "Multimedia");
    await fs.mkdir(shareA);
    const recycleA = path.join(shareA, "@Recycle");
    await fs.mkdir(recycleA);

    const shareB = path.join(root, "Downloads");
    await fs.mkdir(shareB);
    const recycleB = path.join(shareB, "@Recycle");
    await fs.mkdir(recycleB);

    const bins = await discoverRecycleBins([root]);
    const paths = bins.map((b) => b.recyclePath).sort();
    expect(paths).toEqual([recycleA, recycleB].sort());
  });
});
