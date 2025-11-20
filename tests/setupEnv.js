import { afterEach, beforeAll, beforeEach, jest } from "@jest/globals";

beforeAll(() => {
  process.env.TG_BOT_TOKEN = process.env.TG_BOT_TOKEN ?? "tg-test-token";
  process.env.ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID ?? "12345";
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "sk-test";
  process.env.OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-test";
  process.env.MODEL = process.env.MODEL ?? "gpt-test";
  process.env.SONARR_URL = process.env.SONARR_URL ?? "http://sonarr.test";
  process.env.SONARR_API_KEY = process.env.SONARR_API_KEY ?? "sonarr-key";
  process.env.PLEX_URL = process.env.PLEX_URL ?? "http://plex.test";
  process.env.PLEX_TOKEN = process.env.PLEX_TOKEN ?? "plex-token";
  process.env.PLEX_TV_SECTION = process.env.PLEX_TV_SECTION ?? "7";
  process.env.NAS_RECYCLE_PATH = process.env.NAS_RECYCLE_PATH ?? "/nas/@Recycle";
  process.env.NAS_SHARE_ROOTS =
    process.env.NAS_SHARE_ROOTS ?? "/nas/share1,/nas/share2";
});

beforeEach(() => {
  jest.restoreAllMocks();
  global.sonarrCache = [];
});

afterEach(() => {
  jest.clearAllMocks();
});
