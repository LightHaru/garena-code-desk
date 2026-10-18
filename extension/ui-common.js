"use strict";
globalThis.Desk = {
  async send(type, payload = {}) {
    const result = await chrome.runtime.sendMessage({ type, ...payload });
    if (!result?.ok) throw new Error(result?.error || "Extension chưa phản hồi. Anh thử tải lại extension.");
    return result;
  },
  date(value) { return value ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(value) : "Chưa quét"; },
  download(filename, text, type = "application/json") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a"); link.href = url; link.download = filename;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  message(text, error = false) {
    const node = document.querySelector("#notice"); if (!node) return;
    node.textContent = text; node.className = error ? "notice error" : "notice"; node.hidden = !text;
  }
};
