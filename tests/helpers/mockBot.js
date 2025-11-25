import { jest } from "@jest/globals";

export function createMockBot(overrides = {}) {
  return {
    sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
    sendPhoto: jest.fn().mockResolvedValue({ message_id: 2, photo: [{}] }),
    sendChatAction: jest.fn().mockResolvedValue(),
    editMessageText: jest.fn().mockResolvedValue(),
    editMessageCaption: jest.fn().mockResolvedValue(),
    deleteMessage: jest.fn().mockResolvedValue(),
    answerCallbackQuery: jest.fn().mockResolvedValue(),
    ...overrides
  };
}
