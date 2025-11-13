export async function safeEditMessage(bot, chatId, messageId, text, options = {}) {
  try {
    return await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      ...options
    });
  } catch (err) {
    if (
      err.code === "ETELEGRAM" &&
      err.response?.body?.description?.includes("message is not modified")
    ) {
      // Silently ignore — nothing changed anyway
      return null;
    }

    throw err; // real error
  }
}
