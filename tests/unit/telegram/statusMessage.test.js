import { describe, expect, jest, test } from "@jest/globals";
import {
  createStatus,
  updateStatus,
  clearStatus
} from "../../../src/telegram/statusMessage.js";
import { createMockBot } from "../../helpers/mockBot.js";

describe("status message helpers", () => {
  test("createStatus sends markdown text and returns message id", async () => {
    const bot = createMockBot({
      sendMessage: jest.fn().mockResolvedValue({ message_id: 42 })
    });

    const messageId = await createStatus(bot, 1, "hello");
    expect(messageId).toBe(42);
    expect(bot.sendMessage).toHaveBeenCalledWith(1, "hello", {
      parse_mode: "Markdown"
    });
  });

  test("updateStatus swallows not-modified errors", async () => {
    const bot = createMockBot({
      editMessageText: jest.fn().mockRejectedValue({
        response: { body: { description: "Bad Request: message is not modified" } }
      })
    });

    await expect(updateStatus(bot, 1, 2, "same")).resolves.toBeUndefined();
  });

  test("clearStatus ignores deletion errors", async () => {
    const bot = createMockBot({
      deleteMessage: jest.fn().mockRejectedValue(new Error("too old"))
    });

    await expect(clearStatus(bot, 1, 2)).resolves.toBeUndefined();
  });
});
