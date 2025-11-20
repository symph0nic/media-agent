import { describe, expect, jest, test } from "@jest/globals";
import { safeEditMessage } from "../../../src/telegram/safeEdit.js";
import { createMockBot } from "../../helpers/mockBot.js";

describe("safeEditMessage", () => {
  test("returns editMessageText result on success", async () => {
    const bot = createMockBot({
      editMessageText: jest.fn().mockResolvedValue({ ok: true })
    });

    const result = await safeEditMessage(bot, 1, 2, "text");
    expect(result).toEqual({ ok: true });
    expect(bot.editMessageText).toHaveBeenCalledWith("text", {
      chat_id: 1,
      message_id: 2
    });
  });

  test("swallows Telegram not-modified errors", async () => {
    const bot = createMockBot({
      editMessageText: jest.fn().mockRejectedValue({
        code: "ETELEGRAM",
        response: { body: { description: "Bad Request: message is not modified" } }
      })
    });

    await expect(safeEditMessage(bot, 1, 2, "text")).resolves.toBeNull();
  });

  test("rethrows unknown errors", async () => {
    const bot = createMockBot({
      editMessageText: jest.fn().mockRejectedValue(new Error("boom"))
    });

    await expect(safeEditMessage(bot, 1, 2, "text")).rejects.toThrow("boom");
  });
});
