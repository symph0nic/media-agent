import axios from "axios";
import { formatBytesDecimal } from "./format.js";

function ensureQbConfig(config) {
  if (
    !config.QBITTORRENT_URL ||
    !config.QBITTORRENT_USERNAME ||
    !config.QBITTORRENT_PASSWORD
  ) {
    throw new Error("QBITTORRENT_URL/USERNAME/PASSWORD missing");
  }
}

async function createClient(config) {
  ensureQbConfig(config);

  const baseURL = config.QBITTORRENT_URL.replace(/\/+$/, "");
  const login = await axios.post(
    `${baseURL}/api/v2/auth/login`,
    new URLSearchParams({
      username: config.QBITTORRENT_USERNAME,
      password: config.QBITTORRENT_PASSWORD
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      maxRedirects: 0,
      validateStatus: (s) => s === 200
    }
  );

  const cookie = login.headers?.["set-cookie"]?.[0];
  if (!cookie) throw new Error("Failed to authenticate with qBittorrent");

  return axios.create({
    baseURL: `${baseURL}/api/v2`,
    headers: {
      Cookie: cookie
    }
  });
}

export async function findUnregisteredTorrents(config, { category } = {}) {
  const client = await createClient(config);
  const { data: torrents } = await client.get("/torrents/info");
  if (!Array.isArray(torrents) || torrents.length === 0) return [];

  const result = [];

  for (const torrent of torrents) {
    try {
      if (category && torrent.category !== category) continue;

      const { data: trackers } = await client.get(
        `/torrents/trackers?hash=${torrent.hash}`
      );

      const hasUnreg = trackers.some((trk) =>
        typeof trk.msg === "string" &&
        trk.msg.toLowerCase().includes("unregistered")
      );

      if (hasUnreg) {
        result.push({
          hash: torrent.hash,
          name: torrent.name,
          size: torrent.size,
          added_on: torrent.added_on
        });
      }
    } catch (err) {
      // ignore per-torrent tracker failures
      continue;
    }
  }

  return result;
}

export async function deleteTorrents(config, hashes, deleteFiles = true) {
  if (!hashes || hashes.length === 0) return 0;
  const client = await createClient(config);
  const payload = new URLSearchParams({
    hashes: hashes.join("|"),
    deleteFiles: deleteFiles ? "true" : "false"
  }).toString();

  await client.post("/torrents/delete", payload, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  return hashes.length;
}

export function formatTorrentList(torrents) {
  return torrents
    .map((t, idx) => {
      const size = formatBytesDecimal(t.size || 0);
      return `${idx + 1}. ${t.name} (${size})`;
    })
    .join("\n");
}
