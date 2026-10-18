chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message.target !== "parser") return false;
  try { sendResponse({ ok: true, codes: GCAParser.parseHtml(message.html, message.selector) }); }
  catch (error) { sendResponse({ ok: false, error: error.message }); }
  return false;
});
