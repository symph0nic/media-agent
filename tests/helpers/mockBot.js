import { jest } from "@jest/globals";

export function createMockBot(overrides = {}) {
  return {
    sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
    sendChatAction: jest.fn().mockResolvedValue(),
    editMessageText: jest.fn().mockResolvedValue(),
    deleteMessage: jest.fn().mockResolvedValue(),
    answerCallbackQuery: jest.fn().mockResolvedValue(),
    ...overrides
  };
}
