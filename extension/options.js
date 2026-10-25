"use strict";
let currentState, loadedSettings = false, page = 0, refreshTimer;
const PAGE_SIZE = 50;
const el = id => document.getElementById(id);
function textNode(tag, text, className) {
  const node = document.createElement(tag); node.textContent = text;
  if (className) node.className = className;
  return node;
}
async function action(type, payload = {}, message = "Đã lưu.") {
  try { const result = await Desk.send(type, payload); if (message) Desk.message(typeof message === "function" ? message(result) : message); await refresh(); return result; }
  catch (error) { Desk.message(error.message, true); return null; }
}
async function refresh() {
  try {
    const { state, nextAlarm } = await Desk.send("GET_STATE"); currentState = state;
    const totals = GCA.stats(state);
    for (const id of ["waiting", "redeemed", "skipped"]) el(`stat-${id}`).textContent = totals[id];
    el("stat-review").textContent = totals.errors;
    el("stat-deferred").textContent = "Code lỗi bỏ qua, không tự thử lại";
    el("account-name").textContent = state.account || "Chưa kết nối";
    el("run-status").textContent = ({ running: "ĐANG ĐỔI TỪNG CODE", paused: "ĐÃ TẠM DỪNG", done: "XONG HÀNG CHỜ", idle: "SẴN SÀNG" })[state.run.status];
    el("runner-symbol").textContent = state.run.status === "running" ? "▶" : state.run.status === "done" ? "✓" : "Ⅱ";
    el("run-reason").textContent = state.run.current ? `${state.run.current.code} · ${state.run.reason}` : state.run.reason;
    el("start").disabled = state.run.status === "running";
    el("pause").disabled = state.run.status !== "running";
    el("refresh").disabled = state.meta.crawling;
    el("refresh").textContent = state.meta.crawling ? "↻ Đang quét…" : "↻ Quét nguồn ngay";
    el("seed-info").textContent = `Bản cài có sẵn danh sách nguồn ngày ${Desk.date(state.meta.seededAt)}. Bấm Quét nguồn để cập nhật.`;
    el("crawl-summary").textContent = state.meta.crawling ? "Đang đọc dữ liệu công khai…" : `${state.meta.lastCrawlSummary || "Danh sách kèm theo chưa được đổi thử trên tài khoản."} · ${Desk.date(state.meta.lastCrawlFinishedAt || state.meta.lastCrawlAttemptAt || state.meta.lastCrawlAt)}`;
    const newCodes = state.meta.lastCrawlAddedCodes || [];
    el("crawl-result").hidden = !newCodes.length;
    el("crawl-added").textContent = `Đã tự lưu ${newCodes.length} code mới từ lượt quét${state.meta.crawling ? " đang chạy" : " vừa rồi"}.`;
    el("view-new-codes").textContent = `Xem ${newCodes.length} code mới →`;
    el("next-alarm").textContent = nextAlarm ? `Lần tới: ${Desk.date(nextAlarm.scheduledTime)}` : "Lịch đang tắt";
    if (!loadedSettings) {
      el("daily-enabled").checked = state.settings.dailyEnabled;
      el("auto-redeem").checked = state.settings.autoRedeem;
      el("daily-time").value = `${String(state.settings.dailyHour).padStart(2, "0")}:${String(state.settings.dailyMinute).padStart(2, "0")}`;
      el("delay").value = String(state.settings.delaySeconds); loadedSettings = true;
    }
    renderSources(); renderCodes();
  } catch (error) { Desk.message(error.message, true); }
}
function renderSources() {
  el("sources").replaceChildren();
  for (const source of currentState.sources) {
    const row = textNode("div", "", "source-row");
    const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = source.enabled; enabled.setAttribute("aria-label", `Bật nguồn ${source.name}`);
    enabled.addEventListener("change", () => action("SOURCE_TOGGLE", { id: source.id, enabled: enabled.checked }));
    const info = textNode("div", "", "source-info"); info.append(textNode("b", source.name));
    const link = textNode("a", source.url); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer"; info.append(link);
    info.append(textNode("p", source.error ? `Lỗi: ${source.error}` : source.lastChecked ? `Đã kiểm tra ${Desk.date(source.lastChecked)}${source.checkedArticles ? ` · ${source.checkedArticles} bài tin` : ""}` : "Sẽ quét khi cài xong và theo lịch hằng ngày.", source.error ? "source-error" : ""));
    if (source.warning) info.append(textNode("p", source.warning));
    const summary = textNode("div", "", "source-summary");
    summary.append(textNode("div", typeof source.found === "number" ? `${source.found} code tìm thấy` : "Chưa quét"), textNode("small", typeof source.added === "number" ? `+${source.added} mới` : ""));
    if (!["xemgi", "garena"].includes(source.id)) {
      const remove = textNode("button", "Bỏ nguồn", "row-action secondary"); remove.addEventListener("click", () => action("SOURCE_REMOVE", { id: source.id }, "Đã bỏ nguồn; các code đã lấy vẫn còn trong lịch sử.")); summary.append(remove);
    }
    row.append(enabled, info, summary); el("sources").append(row);
  }
}
function renderCodes() {
  if (!currentState) return;
  const filter = el("filter").value, search = el("search").value.trim().toLowerCase(), account = currentState.account;
  const newCodes = new Set(currentState.meta.lastCrawlAddedCodes || []);
  const records = Object.values(currentState.codes).filter(record => {
    if (search && !record.code.toLowerCase().includes(search)) return false;
    const status = GCA.codeStatus(record, account);
    if (filter === "all") return true;
    if (filter === "new") return newCodes.has(record.code);
    if (filter === "queue") return ["pending", "processing"].includes(status);
    if (filter === "archived") return ["used", "expired", "invalid", "exhausted", "account_limit", "dismissed", "skipped_error"].includes(status);
    return status === filter;
  }).sort((a, b) => Number(newCodes.has(b.code)) - Number(newCodes.has(a.code)) || b.firstSeen - a.firstSeen);
  page = Math.min(page, Math.max(0, Math.ceil(records.length / PAGE_SIZE) - 1));
  const items = records.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  el("codes").replaceChildren();
  for (const record of items) {
    const row = document.createElement("tr"), status = GCA.codeStatus(record, account), result = record.accounts[GCA.accountKey(account)];
    row.append(textNode("td", record.code, "code"));
    if (newCodes.has(record.code)) row.firstChild.append(textNode("span", "Mới từ lượt quét", "code-new"));
    const sourceCell = document.createElement("td"), source = record.sources[0];
    if (source?.url?.startsWith("https://")) {
      const link = textNode("a", source.name); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer"; sourceCell.append(link);
    } else sourceCell.textContent = source?.name || "Anh nhập";
    const statusCell = document.createElement("td"); statusCell.append(textNode("span", GCA.STATUS_LABELS[status] || status, `status ${status}`));
    const message = textNode("td", result?.reason || result?.message || (status === "pending" ? "Chưa thử trên Garena" : ""), "message");
    if (result?.at) message.append(document.createElement("br"), textNode("small", Desk.date(result.at)));
    const buttons = document.createElement("td");
    if (!["processing", "skipped_error"].includes(status)) {
      const canRestore = status !== "pending";
      const button = textNode("button", canRestore ? "Thử lại" : "Loại", "row-action");
      button.setAttribute("aria-label", `${canRestore ? "Thử lại" : "Loại"} ${record.code}`);
      button.addEventListener("click", () => action("CODE_ACTION", { code: record.code, action: canRestore ? "restore" : "dismiss" }, canRestore ? "Đã đưa code về hàng chờ. Bấm Bắt đầu đổi để chạy." : "Đã loại code; lần quét sau sẽ không thêm lại."));
      buttons.append(button);
    }
    row.append(sourceCell, statusCell, message, buttons); el("codes").append(row);
  }
  if (!items.length) { const row = document.createElement("tr"), cell = textNode("td", "Không có code trong mục này.", "empty"); cell.colSpan = 5; row.append(cell); el("codes").append(row); }
  el("code-count").textContent = `${records.length} code trong mục này · ${Object.keys(currentState.codes).length} code đã ghi nhận`;
  el("page-label").textContent = items.length ? `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + items.length} / ${records.length}` : "0 code";
  el("previous").disabled = page === 0; el("next").disabled = (page + 1) * PAGE_SIZE >= records.length;
}
el("open-site").addEventListener("click", () => action("OPEN_SITE", {}, "Đã mở trang Garena. Kiểm tra tài khoản rồi bấm Bắt đầu đổi."));
el("start").addEventListener("click", () => action("START", {}, "Đã mở lượt đổi trên Garena. Có thể đóng bảng này khi chạy."));
el("pause").addEventListener("click", () => action("PAUSE", {}, "Đã dừng lấy code tiếp theo. Kết quả code đang gửi vẫn được ghi nhận."));
el("refresh").addEventListener("click", async () => {
  const result = await action("REFRESH", {}, result => result.message || GCA.crawlSummary(result));
  if (result?.added) { el("search").value = ""; el("filter").value = "queue"; page = 0; renderCodes(); }
});
el("view-new-codes").addEventListener("click", () => {
  el("search").value = ""; el("filter").value = "new"; page = 0; renderCodes();
  el("ket-qua").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
});
el("import").addEventListener("click", async () => {
  const text = el("import-text").value;
  if (!text.trim()) { Desk.message("Anh dán danh sách code trước nhé.", true); return; }
  const result = await action("IMPORT", { text }, value => `Nhận dạng ${value.found} code, thêm ${value.added} code mới. Code trùng hoặc đã loại giữ nguyên lịch sử.`);
  if (result) el("import-text").value = "";
});
el("import-file").addEventListener("change", async event => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 2 * 1024 * 1024) { Desk.message("File tối đa 2 MB.", true); return; }
  try { el("import-text").value = await file.text(); Desk.message(`Đã đọc ${file.name}. Bấm Thêm vào hàng chờ.`); }
  catch (error) { Desk.message(error.message, true); }
});
el("save-settings").addEventListener("click", async () => {
  const [dailyHour, dailyMinute] = el("daily-time").value.split(":").map(Number);
  const result = await action("SAVE_SETTINGS", { settings: { dailyEnabled: el("daily-enabled").checked, autoRedeem: el("auto-redeem").checked, dailyHour, dailyMinute, delaySeconds: Number(el("delay").value) } }, "Đã lưu lịch theo giờ Việt Nam.");
  if (result) { loadedSettings = false; await refresh(); }
});
const sourceSuggestions = GCASourceSuggestions.presets;
el("source-preset").addEventListener("change", () => {
  const preset = sourceSuggestions[el("source-preset").value];
  if (!preset) return;
  el("source-name").value = preset.name;
  el("source-url").value = preset.url;
  el("source-kind").value = "html";
  el("source-selector").value = preset.selector;
});
el("research-codes").addEventListener("click", () => {
  el("import-text").value = GCASourceSuggestions.priorityCodes.join("\n");
  el("import-text").focus();
  Desk.message(`Đã dán ${GCASourceSuggestions.priorityCodes.length} mã đối chiếu ngày ${GCASourceSuggestions.checkedAt}. Bấm Thêm vào hàng chờ để nhập; Garena sẽ xác nhận hiệu lực khi đổi.`);
});
el("add-source-toggle").addEventListener("click", () => { el("source-form").hidden = !el("source-form").hidden; });
el("source-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const url = GCA.publicUrl(el("source-url").value.trim());
    // Permission request is made directly from this user gesture.
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) { Desk.message("Chưa cấp quyền đọc nguồn. Nguồn chưa được thêm.", true); return; }
    const result = await action("SOURCE_ADD", { name: el("source-name").value.trim(), url: url.href, kind: el("source-kind").value, selector: el("source-selector").value.trim() }, "Đã thêm nguồn. Bấm Quét nguồn ngay để lấy code.");
    if (result) { el("source-form").reset(); el("source-form").hidden = true; }
  } catch (error) { Desk.message(error.message, true); }
});
el("search").addEventListener("input", () => { page = 0; renderCodes(); });
el("filter").addEventListener("change", () => { page = 0; renderCodes(); });
el("previous").addEventListener("click", () => { page--; renderCodes(); });
el("next").addEventListener("click", () => { page++; renderCodes(); });
el("export").addEventListener("click", () => {
  if (!currentState) return;
  const rows = Object.values(currentState.codes).map(record => ({ code: record.code, status: GCA.codeStatus(record, currentState.account), account: currentState.account, result: record.accounts[GCA.accountKey(currentState.account)] || null, sources: record.sources, firstSeen: record.firstSeen, lastSeen: record.lastSeen }));
  const date = new Date().toISOString().slice(0, 10); Desk.download(`garena-code-history-${date}.json`, JSON.stringify(rows, null, 2));
  Desk.message("Đã xuất lịch sử của tài khoản gần nhất thành file JSON.");
});
chrome.storage.onChanged.addListener((changes, area) => { if (area !== "local") return; clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 80); });
refresh();
