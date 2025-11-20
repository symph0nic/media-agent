import axios from "axios";

async function main() {
  try {
    const sonarrUrl = process.env.SONARR_URL;
    const sonarrKey = process.env.SONARR_API_KEY;

    // Sanity check
    if (!sonarrUrl || !sonarrKey) throw new Error("Missing Sonarr config");

    // Ping Sonarr status
    await axios.get(`${sonarrUrl}/system/status`, {
      headers: { "X-Api-Key": sonarrKey }
    });

    // If we reach here → healthy
    process.exit(0);
  } catch (err) {
    console.error("Healthcheck failed:", err.message);
    process.exit(1);
  }
}

main();
