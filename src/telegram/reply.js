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

