import axios from "axios";

function trimUrl(url) {
  return url?.replace(/\/+$/, "") || "";
}

async function checkService(name, url, apiKey) {
  if (!url || !apiKey) {
    throw new Error(`Missing ${name} config`);
  }

  const statusUrl = `${trimUrl(url)}/api/v3/system/status`;
  await axios.get(statusUrl, {
    headers: { "X-Api-Key": apiKey }
  });
}

async function main() {
  try {
    await Promise.all([
      checkService("Sonarr", process.env.SONARR_URL, process.env.SONARR_API_KEY),
      checkService("Radarr", process.env.RADARR_URL, process.env.RADARR_API_KEY)
    ]);
    process.exit(0);
  } catch (err) {
    console.error("Healthcheck failed:", err.message);
    process.exit(1);
  }
}

main();
