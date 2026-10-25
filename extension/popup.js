"use strict";
let busy = false;
async function refresh() {
  try {
    const { state } = await Desk.send("GET_STATE"), total = GCA.stats(state);
    for (const id of ["waiting", "redeemed", "skipped"]) document.getElementById(id).textContent = total[id];
    document.getElementById("account").textContent = state.account ? `Tài khoản gần nhất: ${state.account}` : "Đăng nhập tài khoản chơi game trên Garena";
    document.getElementById("run-status").textContent = ({ running: "ĐANG TỰ ĐỔI", paused: "ĐÃ TẠM DỪNG", done: "ĐÃ XONG HÀNG CHỜ", idle: "SẴN SÀNG" })[state.run.status];
    document.getElementById("run-reason").textContent = state.run.reason;
    document.getElementById("current-code").textContent = state.run.current?.code || `Đã xử lý ${state.run.processed || 0} code trong lượt này`;
    document.getElementById("schedule").textContent = state.settings.dailyEnabled ? `${String(state.settings.dailyHour).padStart(2, "0")}:${String(state.settings.dailyMinute).padStart(2, "0")} · VN` : "Lịch đang tắt";
    document.getElementById("last-crawl").textContent = `Lần quét: ${Desk.date(state.meta.lastCrawlFinishedAt || state.meta.lastCrawlAttemptAt || state.meta.lastCrawlAt)}`;
    document.getElementById("crawl-summary").textContent = state.meta.lastCrawlSummary;
    document.getElementById("pause").disabled = state.run.status !== "running";
    document.getElementById("start").disabled = busy || state.run.status === "running";
    document.getElementById("quick-start").disabled = busy || state.run.status === "running" || state.meta.crawling;
  } catch (error) { Desk.message(error.message, true); }
}
for (const [id, type] of [["quick-start", "REFRESH_START"], ["start", "START"], ["pause", "PAUSE"]]) {
  document.getElementById(id).addEventListener("click", async () => {
    busy = true; await refresh(); Desk.message(type === "REFRESH_START" ? "Đang quét nguồn và mở Garena…" : "Đang xử lý…");
    try { await Desk.send(type); Desk.message(type === "PAUSE" ? "Đã dừng sau code đang nhận kết quả." : "Đã mở lượt đổi trên Garena."); }
    catch (error) { Desk.message(error.message, true); }
    finally { busy = false; await refresh(); }
  });
}
document.getElementById("manager").addEventListener("click", () => chrome.runtime.openOptionsPage());
chrome.storage.onChanged.addListener(() => refresh());
refresh();
