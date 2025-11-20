export async function createStatus(bot, chatId, text) {
  const msg = await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  return msg.message_id;
}

export async function updateStatus(bot, chatId, messageId, text) {
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown"
    });
  } catch (err) {
    // Ignore harmless Telegram errors
    const desc = err.response?.body?.description;
    const benign =
      desc?.includes("message is not modified") ||
      desc?.includes("message to edit not found") ||
      desc?.includes("message can't be edited");
    if (!benign) {
      console.error("Status update failed:", err);
    }
  }
}

export async function clearStatus(bot, chatId, messageId) {
  try {
    await bot.deleteMessage(chatId, messageId);
  } catch (_) {
    // Ignore deletion errors (message too old or already removed)
  }
}
