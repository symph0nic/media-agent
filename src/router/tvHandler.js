import {
  lookupSeries,
  getEpisodes,
  findEpisode
} from "../tools/sonarr.js";

import {
  updateStatus,
  clearStatus
} from "../telegram/statusMessage.js";

import { yesNoPickKeyboard } from "../telegram/reply.js";
import { pending } from "../state/pending.js";

export async function handleRedownload(bot, chatId, entities, statusId) {

  const title = entities.title;
  const season = entities.seasonNumber;
  const episode = entities.episodeNumber;

  try {
    //
    // 1️⃣ SERIES LOOKUP
    //
    await updateStatus(bot, chatId, statusId, `🔎 *Searching for series:* _${title}_…`);
    const seriesList = await lookupSeries(title);

    if (!seriesList || seriesList.length === 0) {
      await updateStatus(bot, chatId, statusId, `❌ No results for *${title}*`);
      await clearStatus(bot, chatId, statusId);
      return;
    }

    // Filter to only Sonarr-ready results
    const validSeries = seriesList.filter(s => s.id);

    if (validSeries.length === 0) {
      await updateStatus(bot, chatId, statusId, `❌ No valid Sonarr series found for *${title}*.`);
      await clearStatus(bot, chatId, statusId);
      return;
    }

    //
    // 2️⃣ AUTO-PICK FIRST MATCH (Option A behaviour)
    //
    const selected = validSeries[0];

    await updateStatus(
      bot,
      chatId,
      statusId,
      `📘 *Selected:* _${selected.title}_\nFetching episodes…`
    );

    //
    // 3️⃣ EPISODE LOOKUP
    //
    const episodes = await getEpisodes(selected.id);

    await updateStatus(
      bot,
      chatId,
      statusId,
      `🎬 Matching episode *S${season}E${episode}*…`
    );

    const matches = findEpisode(episodes, season, episode);

    if (matches.length === 0) {
      await updateStatus(
        bot,
        chatId,
        statusId,
        `⚠️ Episode not found, will search regardless.`
      );

      await clearStatus(bot, chatId, statusId);

      pending[chatId] = {
        mode: "redownload",
        selectedSeries: selected,
        seriesList: validSeries,
        season,
        episode,
        episodeId: 0,
        episodeFileId: 0
      };

      await bot.sendMessage(
        chatId,
        `⚠️ Episode S${season}E${episode} not found for *${selected.title}*.`
      );

      return;
    }

    const ep = matches[0];

    //
    // 4️⃣ PREPARE CONFIRMATION DIALOG
    //
    await updateStatus(bot, chatId, statusId, "💬 Preparing confirmation…");
    await clearStatus(bot, chatId, statusId);

    // This is key: store full list so "Pick other show" works
    pending[chatId] = {
      mode: "redownload",
      selectedSeries: selected,
      seriesList: validSeries,
      season,
      episode,
      episodeId: ep.id,
      episodeFileId: ep.episodeFileId || 0
    };

    await bot.sendMessage(
      chatId,
      `Found *${selected.title}* — Season ${season}, Episode ${episode}.\nRedownload this episode?`,
      { parse_mode: "Markdown", ...yesNoPickKeyboard(validSeries) }
    );

  } catch (err) {
    console.error("[tvHandler] Error:", err);
    await updateStatus(bot, chatId, statusId, "❌ Error during processing.");
    await clearStatus(bot, chatId, statusId);
  }
}
