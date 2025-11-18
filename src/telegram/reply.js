export function yesNoPickKeyboard(seriesList) {
  const buttons = [
    [{ text: "✅ Yes", callback_data: "redl_yes" }],
    [{ text: "❌ No", callback_data: "redl_no" }]
  ];

  if (seriesList.length > 1) {
    buttons.push([{ text: "🔍 Pick different show", callback_data: "redl_pick" }]);
  }

  return { reply_markup: { inline_keyboard: buttons } };
}

// ─────────────────────────────────────────
//  TIDY CONFIRMATION KEYBOARDS
// ─────────────────────────────────────────

export function yesNoPickTidyKeyboard(seriesList) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Yes", callback_data: "tidy_yes" }],
        [{ text: "❌ No", callback_data: "tidy_no" }],
        [
          {
            text: "🔄 Pick Another Series",
            callback_data: "tidy_pick"
          }
        ]
      ]
    }
  };
}

export function seriesSelectionTidyKeyboard(seriesList) {
  return {
    reply_markup: {
      inline_keyboard: [
        ...seriesList.map((s) => [
          {
            text: s.title,
            callback_data: `tidy_select|${s.id}`
          }
        ]),
        [
          {
            text: "❌ Cancel",
            callback_data: "tidy_cancelpick"
          }
        ]
      ]
    }
  };
}




export function seriesSelectionKeyboard(seriesList) {
  const showButtons = seriesList.map((s) => [
    {
      text: s.title,
      callback_data: `redl_select|${s.id}`
    }
  ]);

  // Add cancel row
  showButtons.push([
    {
      text: "❌ Cancel",
      callback_data: "redl_cancel"
    }
  ]);

  return {
    reply_markup: {
      inline_keyboard: showButtons
    }
  };
}

