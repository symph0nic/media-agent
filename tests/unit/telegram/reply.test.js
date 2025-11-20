import { describe, expect, test } from "@jest/globals";
import {
  yesNoPickKeyboard,
  seriesSelectionKeyboard,
  yesNoPickTidyKeyboard,
  seriesSelectionTidyKeyboard,
  nasPrimaryKeyboard,
  nasSelectionKeyboard
} from "../../../src/telegram/reply.js";

describe("redownload keyboards", () => {
  test("yesNoPickKeyboard adds pick button only when multiple series exist", () => {
    const single = yesNoPickKeyboard([{ id: 1, title: "Show" }]);
    expect(single.reply_markup.inline_keyboard).toHaveLength(2);

    const multi = yesNoPickKeyboard([
      { id: 1, title: "Show" },
      { id: 2, title: "Alt" }
    ]);
    expect(multi.reply_markup.inline_keyboard).toHaveLength(3);
    expect(multi.reply_markup.inline_keyboard[2][0].callback_data).toBe("redl_pick");
  });

  test("seriesSelectionKeyboard builds buttons per series and cancel option", () => {
    const keyboard = seriesSelectionKeyboard([
      { id: 10, title: "First" },
      { id: 11, title: "Second" }
    ]).reply_markup.inline_keyboard;

    expect(keyboard).toHaveLength(3);
    expect(keyboard[0][0]).toMatchObject({ callback_data: "redl_select|10" });
    expect(keyboard[2][0].callback_data).toBe("redl_cancel");
  });
});

describe("tidy keyboards", () => {
  test("always include pick option and cancel button", () => {
    const yesNoPick = yesNoPickTidyKeyboard([{ id: 1, title: "Show" }]);
    expect(yesNoPick.reply_markup.inline_keyboard).toHaveLength(3);

    const selection = seriesSelectionTidyKeyboard([{ id: 5, title: "Show" }]);
    const finalRow = selection.reply_markup.inline_keyboard.at(-1);
    expect(finalRow[0].callback_data).toBe("tidy_cancelpick");
  });
});

describe("NAS keyboards", () => {
  test("primary keyboard exposes clear-all, pick, cancel actions", () => {
    const keyboard = nasPrimaryKeyboard().reply_markup.inline_keyboard;
    expect(keyboard).toHaveLength(3);
    expect(keyboard[0][0].callback_data).toBe("nas_clear_all");
    expect(keyboard[1][0].callback_data).toBe("nas_clear_pick");
    expect(keyboard[2][0].callback_data).toBe("nas_clear_cancel");
  });

  test("selection keyboard lists shares plus back button", () => {
    const keyboard = nasSelectionKeyboard([
      { share: "Media" },
      { share: "Backups" }
    ]).reply_markup.inline_keyboard;
    expect(keyboard).toHaveLength(3);
    expect(keyboard[0][0].callback_data).toBe("nas_clear_select|0");
    expect(keyboard[1][0].callback_data).toBe("nas_clear_select|1");
    expect(keyboard[2][0].callback_data).toBe("nas_clear_pick_cancel");
  });
});
