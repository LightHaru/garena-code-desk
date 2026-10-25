"use strict";
importScripts("core.js", "source-parser.js", "sources.js");
const STORAGE_KEY = "garenaCodeDesk.v1";
const DAILY_ALARM = "discover-daily";
const WATCHDOG_ALARM = "redeem-watchdog";
const ATTEMPT_TIMEOUT = 45000;
const workerSetTimeout = setTimeout, workerClearTimeout = clearTimeout;
let serial = Promise.resolve(), initializing, refreshJob, creatingParser, startingRun;
let runnerTimer, runnerJob, lastRunnerWake = 0, scheduling = Promise.resolve();

// Timers belong to the extension worker, not the hidden Garena page. The saved
// queue and repeating alarm also recover progress when Chrome restarts the worker.
function scheduleRunner() {
  const task = scheduling.then(async () => {
    workerClearTimeout(runnerTimer); runnerTimer = null;
    const state = await readState();
    if (!state || state.run.status !== "running") {
      await chrome.alarms.clear(WATCHDOG_ALARM);
      await releaseRunTab();
      return;
    }
    if (!await chrome.alarms.get(WATCHDOG_ALARM)) await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 1 });
    await protectRunTab(state.run.tabId);
    const due = state.run.current ? state.run.current.at + ATTEMPT_TIMEOUT : Math.max(state.run.nextAt || 0, lastRunnerWake + 2000);
    const delay = Math.min(20000, Math.max(state.run.current ? 1000 : 0, due - Date.now()));
    runnerTimer = workerSetTimeout(() => {
      runnerTimer = null;
      pumpRunner().catch(error => console.error("Code Desk runner:", error.message));
    }, delay);
    runnerTimer.unref?.();
  });
  scheduling = task.catch(error => console.error("Code Desk schedule:", error.message));
  return task;
}
async function releaseRunTab() {
  const protection = (await readState())?.meta.protectedTab;
  if (!protection) return;
  try { await chrome.tabs.update(protection.tabId, { autoDiscardable: protection.previous }); } catch {}
  await mutate(state => { if (state.meta.protectedTab?.tabId === protection.tabId) delete state.meta.protectedTab; });
}
async function protectRunTab(tabId) {
  const state = await readState();
  if (state.meta.protectedTab?.tabId === tabId) return;
  await releaseRunTab();
  const tab = await chrome.tabs.get(tabId);
  await mutate(state => { state.meta.protectedTab = { tabId, previous: tab.autoDiscardable !== false }; });
  await chrome.tabs.update(tabId, { autoDiscardable: false });
}
async function pumpRunner() {
  if (runnerJob) return runnerJob;
  runnerJob = (async () => {
    await initialize();
    const state = await readState();
    if (state.run.status !== "running") return;
    const current = state.run.current;
    if (current) {
      if (Date.now() - current.at > 180000) {
        await mutate(s => {
          if (s.run.current?.attemptId !== current.attemptId) return;
          markUncertain(s, "Không nhận được kết quả sau 3 phút.");
          s.run.status = "paused"; s.run.reason = "Trang Garena không phản hồi; đã bỏ qua code vừa gửi và tạm dừng lượt.";
        });
      } else if (Date.now() - current.at >= ATTEMPT_TIMEOUT) {
        try { await chrome.tabs.sendMessage(state.run.tabId, { type: "ATTEMPT_TIMEOUT", attemptId: current.attemptId }); } catch {}
      }
      return;
    }
    if (state.run.nextAt > Date.now()) return;
    lastRunnerWake = Date.now();
    try { await chrome.tabs.sendMessage(state.run.tabId, { type: "RUN_AVAILABLE" }); }
    catch {
      let tab;
      try { tab = await chrome.tabs.get(state.run.tabId); } catch {}
      if (!tab || tab.status === "complete") await pauseRun("Trang Garena cần tải lại để nối với extension. Tải lại trang rồi bấm Tiếp tục.");
    }
  })().finally(async () => { runnerJob = null; await scheduleRunner(); });
  return runnerJob;
}

async function readState() {
  return (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
}
function mutate(fn) {
  const task = serial.then(async () => {
    const state = await readState();
    if (!state) throw new Error("Extension đang khởi tạo. Vui lòng thử lại.");
    const result = await fn(state);
    state.meta.revision = (state.meta.revision || 0) + 1;
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
    const numbers = GCA.stats(state);
    await chrome.action.setBadgeText({ text: state.run.status === "running" ? "▶" : numbers.waiting ? String(numbers.waiting) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: state.run.status === "paused" ? "#b46a17" : "#147b61" });
    if (state.run.tabId) {
      try { await chrome.tabs.sendMessage(state.run.tabId, { type: "PANEL_UPDATE", view: panelSnapshot(state, state.run.tabId, state.run.accountName || state.account) }); } catch {}
    }
    return result;
  });
  serial = task.catch(error => console.error("Code Desk:", error.message));
  return task;
}
async function initialize() {
  if (initializing) return initializing;
  initializing = (async () => {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    let state = await readState();
    if (!state) {
      state = GCA.freshState();
      const seed = await (await fetch(chrome.runtime.getURL("seed.json"))).json();
      const groups = seed.sources || [{ name: "XemGì · bản kèm khi cài", url: "https://xemgi.de/codes", codes: seed.codes }];
      for (const source of groups) GCA.mergeCodes(state, source.codes, source, seed.fetchedAt);
      state.meta.seededAt = seed.fetchedAt;
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    }
    if (state.meta.runnerSchema !== 3) {
      state.meta.noRetryMigrated = GCA.migrateNoRetry(state);
      state.meta.runnerSchema = 3;
      // A previous pause can still describe the retired retry policy.
      if (state.run.status !== "running" && !state.run.current && state.meta.noRetryMigrated) state.run.reason = `Đã bỏ qua ${state.meta.noRetryMigrated} kết quả lỗi/chờ cũ; không tự thử lại. Có thể chạy các code còn lại.`;
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    }
    const upgradedSources = GCA.upgradeSources(state);
    if (state.meta.crawling) {
      // A newly started worker has no refreshJob to finish an interrupted scan.
      // Keep already saved codes and release the UI so a new scan can be started.
      state.meta.crawling = false;
      state.meta.lastCrawlSummary = "Lượt quét trước bị gián đoạn. Code đã lưu được giữ lại; bấm Quét nguồn ngay để kiểm tra tiếp.";
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    } else if (upgradedSources) await chrome.storage.local.set({ [STORAGE_KEY]: state });
    await ensureDailyAlarm(state);
  })().catch(error => { initializing = undefined; throw error; });
  return initializing;
}
async function ensureDailyAlarm(state) {
  if (!state.settings.dailyEnabled) { await chrome.alarms.clear(DAILY_ALARM); return; }
  const when = GCA.nextDailyAt(Date.now(), state.settings.dailyHour, state.settings.dailyMinute);
  const existing = await chrome.alarms.get(DAILY_ALARM);
  if (!existing || Math.abs(existing.scheduledTime - when) > 60000) await chrome.alarms.create(DAILY_ALARM, { when });
}
async function fetchText(rawUrl) {
  const url = GCA.publicUrl(rawUrl);
  const origin = `${url.origin}/*`;
  if (!await chrome.permissions.contains({ origins: [origin] })) throw new Error(`Chưa được cấp quyền đọc ${url.hostname}.`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url.href, { method: "GET", credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const maxBytes = 3 * 1024 * 1024;
    if (Number(response.headers.get("Content-Length")) > maxBytes) throw new Error("Trang nguồn vượt 3 MB.");
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Trang nguồn vượt 3 MB."); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  } finally { clearTimeout(timer); }
}
async function parseHtml(html, selector = "") {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL("offscreen.html")] });
  if (!contexts.length) {
    if (!creatingParser) creatingParser = chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["DOM_PARSER"], justification: "Đọc chữ giftcode trong trang nguồn công khai; không chạy script của nguồn." }).finally(() => { creatingParser = null; });
    await creatingParser;
  }
  const result = await chrome.runtime.sendMessage({ target: "parser", html, selector });
  if (!result?.ok) throw new Error(result?.error || "Không đọc được trang nguồn.");
  return result.codes;
}
async function refreshSources() {
  await initialize();
  if (refreshJob) return refreshJob;
  refreshJob = (async () => {
    const start = Date.now();
    const sources = (await readState()).sources.filter(item => item.enabled);
    await mutate(state => { state.meta.crawling = true; state.meta.lastCrawlAttemptAt = start; state.meta.lastCrawlAddedCodes = []; state.meta.lastCrawlSummary = "Đang quét; code mới được tự lưu vào hàng chờ…"; });
    const summary = { added: 0, found: 0, errors: 0, sources: sources.length, completed: 0, partial: 0 };
    for (const source of sources) {
      try {
        const result = await GCASources.crawlSource(source, { fetchText, parseHtml, cache: source.cache || {} });
        await mutate(state => {
          const current = state.sources.find(item => item.id === source.id);
          if (!current || !current.enabled) return;
          const merged = GCA.mergeCodes(state, result.codes, source);
          // Persist the new records and their scan list together, before reading
          // the next source. Neither an open dashboard nor an import click is needed.
          state.meta.lastCrawlAddedCodes.push(...merged.addedCodes);
          Object.assign(current, { lastChecked: Date.now(), found: merged.found, added: merged.added, error: "", warning: result.warning || "", checkedArticles: result.checked || 0 });
          if (result.cache) current.cache = result.cache;
          summary.completed++;
          if (result.partial) summary.partial++;
          for (const article of result.provenance || []) GCA.mergeCodes(state, article.codes, { name: article.title, url: article.url });
          summary.added += merged.added; summary.found += merged.found;
        });
      } catch (error) {
        summary.errors++;
        await mutate(state => {
          const current = state.sources.find(item => item.id === source.id);
          if (current) Object.assign(current, { lastChecked: Date.now(), error: String(error.message).slice(0, 500) });
        });
      }
    }
    await mutate(state => {
      state.meta.crawling = false;
      if (summary.completed && !summary.errors && !summary.partial) state.meta.lastCrawlAt = Date.now();
      state.meta.lastCrawlFinishedAt = Date.now();
      summary.message = GCA.crawlSummary(summary);
      state.meta.lastCrawlSummary = summary.message;
    });
    return summary;
  })().finally(() => { refreshJob = null; });
  return refreshJob;
}
async function findOrCreateTab(active = true, preferredTabId) {
  const tabs = await chrome.tabs.query({ url: "https://redeem.df.garena.sg/vi/cdkgarena.html*" });
  const state = await readState();
  if (preferredTabId !== undefined && !tabs.some(item => item.id === preferredTabId)) throw new Error("Mở đúng trang đổi quà Garena rồi bấm Bắt đầu.");
  const tab = tabs.find(item => item.id === preferredTabId) || tabs.find(item => item.id === state.run.tabId) || tabs[0];
  if (tab) { if (active) await chrome.tabs.update(tab.id, { active: true }); return tab; }
  return chrome.tabs.create({ url: GCA.REDEEM_URL, active });
}
async function startRun(active = true, preferredTabId, resumeAccount = "") {
  if (startingRun) {
    const result = await startingRun;
    if (preferredTabId !== undefined && result.tabId !== preferredTabId) throw new Error("Đang có lượt chạy ở tab Garena khác.");
    return result;
  }
  startingRun = startRunNow(active, preferredTabId, resumeAccount).finally(() => { startingRun = null; });
  return startingRun;
}
async function startRunNow(active, preferredTabId, resumeAccount) {
  await initialize();
  const state = await readState();
  if (preferredTabId !== undefined && state.run.status === "running" && state.run.tabId !== preferredTabId) throw new Error("Đang có lượt chạy ở tab Garena khác.");
  if (preferredTabId !== undefined && state.run.status !== "running" && state.run.current) throw new Error("Đợi code vừa gửi có kết quả rồi bấm Tiếp tục.");
  const tab = await findOrCreateTab(active, preferredTabId);
  if (state.run.status !== "running") {
    await mutate(s => {
      if (s.run.status === "paused" && resumeAccount && s.run.accountName === resumeAccount && !s.run.current) {
        s.run.status = "running"; s.run.tabId = tab.id; s.run.reason = "Đang tiếp tục các code còn lại…";
        return;
      }
      // Never repeat an uncertain request after a closed/reloaded tab.
      if (s.run.current) markUncertain(s, "Lượt trước gián đoạn trước khi xác nhận kết quả.");
      s.run = { id: crypto.randomUUID(), status: "running", tabId: tab.id, accountName: "", reason: "Đang chờ trang Garena…", processed: 0, startedAt: Date.now(), current: null, nextAt: 0 };
    });
  }
  await scheduleRunner();
  lastRunnerWake = Date.now();
  try { await chrome.tabs.sendMessage(tab.id, { type: "RUN_AVAILABLE" }); }
  catch {
    // A Garena tab opened before extension installation has no content scripts yet.
    // Reload that completed tab once; its existing Garena session is kept by the browser.
    const current = await chrome.tabs.get(tab.id);
    if (current.status === "complete") await chrome.tabs.reload(tab.id);
  }
  return { tabId: tab.id };
}
function markUncertain(state, reason) {
  const current = state.run.current;
  if (current && Object.hasOwn(state.codes, current.code) && state.run.accountName) {
    const record = state.codes[current.code], key = GCA.accountKey(state.run.accountName);
    const prior = record.accounts[key] || {};
    const notClicked = current.clicked === false;
    record.accounts[key] = { ...prior, status: notClicked ? "pending" : "skipped_error", attempts: Math.max(0, (prior.attempts || 0) - (notClicked ? 1 : 0)), at: Date.now(), message: reason, reason: notClicked ? reason : GCA.skipError(reason).reason, nextRetryAt: 0 };
  }
  state.run.current = null;
}
async function pauseRun(reason = "Anh đã dừng. Có thể tiếp tục các code còn lại.") {
  const tabId = await mutate(state => { state.run.status = "paused"; state.run.reason = reason; return state.run.tabId; });
  await scheduleRunner();
  if (tabId) { try { await chrome.tabs.sendMessage(tabId, { type: "RUN_PAUSED" }); } catch {} }
}
function requireRun(state, sender) {
  if (!sender.tab || sender.frameId !== 0 || sender.tab.id !== state.run.tabId) throw new Error("Tab này không giữ lượt đổi code.");
}
async function attachRunner(message, sender) {
  return mutate(state => {
    if (!sender.tab || sender.frameId !== 0 || sender.tab.id !== state.run.tabId || state.run.status !== "running") return { run: false };
    if (state.run.current) {
      markUncertain(state, "Trang đã tải lại khi đang đổi.");
      state.run.status = "paused"; state.run.reason = "Lượt trước bị gián đoạn; code đã gửi được bỏ qua, code chưa bấm vẫn chờ.";
      return { run: false };
    }
    if (!message.site.ready || !message.site.account) {
      state.run.status = "paused";
      state.run.reason = message.site.reason || "Hãy đăng nhập tài khoản chơi game ngay trên trang Garena rồi bấm Tiếp tục.";
      return { run: false };
    }
    const account = String(message.site.account).trim().slice(0, 160);
    if (state.run.accountName && state.run.accountName !== account) {
      state.run.status = "paused"; state.run.reason = "Tài khoản trên trang vừa thay đổi. Bấm bắt đầu lại cho tài khoản mới.";
      return { run: false };
    }
    state.run.accountName = account; state.account = account;
    state.run.reason = `Đang đổi cho ${account}`;
    return { run: true, runId: state.run.id };
  });
}
async function claimCode(message, sender) {
  return mutate(state => {
    requireRun(state, sender);
    if (state.run.status !== "running" || message.runId !== state.run.id) return { next: null };
    if (state.run.current) return { next: null };
    if (message.account !== state.run.accountName) {
      state.run.status = "paused"; state.run.reason = "Tên tài khoản trên Garena đã thay đổi."; return { next: null };
    }
    const now = Date.now();
    if (state.run.nextAt > now) return { waitMs: state.run.nextAt - now };
    const record = Object.values(state.codes).find(item => GCA.eligible(item, state.account, now));
    if (!record) {
      state.run.status = "done";
      state.run.reason = "Đã xử lý xong hàng chờ. Code lỗi đã bỏ qua, không tự thử lại.";
      return { next: null };
    }
    const attemptId = crypto.randomUUID();
    const key = GCA.accountKey(state.account), prior = record.accounts[key] || {};
    record.accounts[key] = { ...prior, status: "processing", attempts: (prior.attempts || 0) + 1, at: now };
    state.run.current = { code: record.code, attemptId, at: now, clicked: false };
    return { next: { code: record.code, attemptId, account: state.account } };
  });
}
async function clicked(message, sender) {
  return mutate(state => {
    requireRun(state, sender);
    if (state.run.status !== "running" || state.run.current?.attemptId !== message.attemptId) return { allowed: false };
    state.run.current.clicked = true;
    return { allowed: true };
  });
}
async function abandon(message, sender) {
  return mutate(state => {
    requireRun(state, sender);
    if (state.run.current?.attemptId !== message.attemptId) return { accepted: false };
    state.run.current.clicked = false;
    markUncertain(state, "Đã dừng trước khi bấm Đổi; code vẫn trong hàng chờ.");
    return { accepted: true };
  });
}
async function saveResult(message, sender) {
  return mutate(state => {
    requireRun(state, sender);
    const current = state.run.current;
    if (!current || current.attemptId !== message.attemptId || current.code !== message.code) return { accepted: false };
    const decision = GCA.applyResult(state, current.code, state.run.accountName, message.result);
    state.run.current = null; state.run.processed++;
    state.run.nextAt = Date.now() + Math.max(3, state.settings.delaySeconds) * 1000;
    if (decision.pause) { state.run.status = "paused"; state.run.reason = decision.reason; }
    else if (state.run.status === "running") state.run.reason = `Vừa xử lý ${message.code}: ${GCA.STATUS_LABELS[decision.status]}`;
    return { accepted: true, continue: state.run.status === "running" };
  });
}
function checkUI(sender) {
  const allowed = ["options.html", "popup.html"];
  if (sender.tab?.url?.startsWith(GCA.REDEEM_URL) || !allowed.some(path => sender.url === chrome.runtime.getURL(path))) throw new Error("Lệnh này chỉ dùng trong bảng điều khiển extension.");
}
function panelSnapshot(state, tabId, account = "") {
  const assigned = state.run.tabId === tabId;
  account = String(account || (assigned ? state.run.accountName : "") || "").trim().slice(0, 160);
  const running = assigned && state.run.status === "running";
  const other = !assigned && state.run.status === "running";
  const busy = assigned && !!state.run.current;
  const processed = assigned ? state.run.processed || 0 : 0;
  const ready = Object.values(state.codes).filter(record => GCA.eligible(record, account)).length;
  return {
    revision: state.meta.revision || 0,
    assigned, running, busy, canStart: !running && !other && !(state.run.current && state.run.status !== "running"),
    status: other ? "other" : assigned ? state.run.status : "idle", account,
    reason: other ? "Đang đổi ở tab Garena khác. Dừng lượt đó trước khi bắt đầu tại đây." : busy && running ? `Đang đổi ${state.run.current.code}` : assigned ? state.run.reason : "Bấm Bắt đầu để đổi các code trong hàng chờ.",
    processed, stats: GCA.stats(state, account), progressTotal: processed + ready + (busy ? 1 : 0)
  };
}
async function handle(message, sender) {
  await initialize();
  if (sender.id !== chrome.runtime.id) throw new Error("Nguồn gửi lệnh không hợp lệ.");
  const runnerCommands = ["ATTACH", "CLAIM", "CLICKED", "ABANDON", "RESULT", "RUN_PROBLEM", "RUN_STATE", "PAUSE_RUN", "OPEN_MANAGER", "PAGE_DELAY", "PANEL_STATE", "START_HERE"];
  if (runnerCommands.includes(message.type)) {
    if (!sender.tab || sender.frameId !== 0 || !sender.url?.startsWith(GCA.REDEEM_URL)) throw new Error("Lệnh đổi code chỉ dùng trên trang Garena.");
    switch (message.type) {
      case "PANEL_STATE": return { view: panelSnapshot(await readState(), sender.tab.id, message.account) };
      case "START_HERE": {
        if (!message.site?.ready || !message.site.account) throw new Error(message.site?.reason || "Đăng nhập Garena và đóng hộp cookie rồi bấm Bắt đầu.");
        return startRun(false, sender.tab.id, String(message.site.account).trim().slice(0, 160));
      }
      case "ATTACH": { const result = await attachRunner(message, sender); await scheduleRunner(); return result; }
      case "CLAIM": { const result = await claimCode(message, sender); await scheduleRunner(); return result; }
      case "CLICKED": return clicked(message, sender);
      case "ABANDON": { const result = await abandon(message, sender); await scheduleRunner(); return result; }
      case "RESULT": { const result = await saveResult(message, sender); await scheduleRunner(); return result; }
      case "PAGE_DELAY": {
        if (sender.frameId !== 0) throw new Error("Chỉ dùng trên trang Garena chính.");
        await new Promise(resolve => workerSetTimeout(resolve, Math.min(1000, Math.max(0, Number(message.ms) || 0))));
        return {};
      }
      case "PAUSE_RUN": { const state = await readState(); requireRun(state, sender); await pauseRun(); return {}; }
      case "OPEN_MANAGER": { await chrome.runtime.openOptionsPage(); return {}; }
      case "RUN_STATE": { const state = await readState(); requireRun(state, sender); return { running: state.run.status === "running", current: state.run.current?.code, reason: state.run.reason, processed: state.run.processed }; }
      case "RUN_PROBLEM": {
        await mutate(state => {
          requireRun(state, sender);
          if (state.run.current && message.attemptId !== state.run.current.attemptId) return;
          markUncertain(state, message.reason);
          state.run.status = "paused"; state.run.reason = String(message.reason).slice(0, 500);
        });
        await scheduleRunner();
        return {};
      }
    }
  }
  checkUI(sender);
  switch (message.type) {
    case "GET_STATE": return { state: await readState(), nextAlarm: await chrome.alarms.get(DAILY_ALARM) };
    case "IMPORT": return mutate(state => {
      const values = Array.isArray(message.codes) ? GCA.uniqueCodes(message.codes) : GCA.parseImport(message.text);
      if (values.length > 10000 || Object.keys(state.codes).length + values.filter(code => !Object.hasOwn(state.codes, code)).length > 10000) throw new Error("Giới hạn 10.000 code trong một extension.");
      return GCA.mergeCodes(state, values, { name: "Anh nhập", url: "manual" });
    });
    case "REFRESH": return refreshSources();
    case "START": return startRun();
    case "REFRESH_START": { const crawl = await refreshSources(); await startRun(); return { crawl }; }
    case "PAUSE": { await pauseRun(); return {}; }
    case "OPEN_SITE": return findOrCreateTab();
    case "SAVE_SETTINGS": {
      await mutate(state => {
        const value = message.settings || {};
        state.settings = {
          dailyEnabled: !!value.dailyEnabled, autoRedeem: !!value.autoRedeem,
          dailyHour: Math.min(23, Math.max(0, Math.floor(Number(value.dailyHour) || 0))),
          dailyMinute: Math.min(59, Math.max(0, Math.floor(Number(value.dailyMinute) || 0))),
          delaySeconds: Math.min(60, Math.max(3, Math.floor(Number(value.delaySeconds) || 5)))
        };
      });
      await ensureDailyAlarm(await readState()); return {};
    }
    case "SOURCE_TOGGLE": return mutate(state => {
      const source = state.sources.find(item => item.id === message.id);
      if (source) source.enabled = !!message.enabled;
    });
    case "SOURCE_ADD": {
      const url = GCA.publicUrl(message.url);
      if (!["json", "text", "html"].includes(message.kind)) throw new Error("Chọn loại nguồn phù hợp.");
      if (!await chrome.permissions.contains({ origins: [`${url.origin}/*`] })) throw new Error("Anh cần cấp quyền đọc tên miền này khi thêm nguồn.");
      return mutate(state => {
        if (state.sources.length >= 20) throw new Error("Tối đa 20 nguồn.");
        if (state.sources.some(item => item.url === url.href)) throw new Error("Nguồn này đã có trong danh sách.");
        state.sources.push({ id: crypto.randomUUID(), kind: message.kind, name: String(message.name || url.hostname).slice(0, 160), url: url.href, selector: String(message.selector || "").slice(0, 300), enabled: true });
      });
    }
    case "SOURCE_REMOVE": return mutate(state => { state.sources = state.sources.filter(item => item.id !== message.id); });
    case "CODE_ACTION": return mutate(state => {
      if (state.run.current?.code === message.code) throw new Error("Đợi code đang nhập có kết quả rồi mới sửa.");
      const record = Object.hasOwn(state.codes, message.code) ? state.codes[message.code] : null;
      if (!record) throw new Error("Không tìm thấy code.");
      if (message.action === "restore") {
        if (record.accounts[GCA.accountKey(state.account)]?.status === "skipped_error") throw new Error("Code lỗi đã được bỏ qua; không đưa lại vào hàng chờ.");
        record.globalStatus = "active";
        delete record.accounts[GCA.accountKey(state.account)];
      } else if (message.action === "dismiss") record.globalStatus = "dismissed";
    });
    default: throw new Error("Lệnh chưa được hỗ trợ.");
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target === "parser") return false;
  handle(message, sender).then(value => respond({ ok: true, ...value }), error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.runtime.onInstalled.addListener(() => {
  initialize().then(() => refreshSources()).catch(error => console.error(error.message));
});
chrome.runtime.onStartup.addListener(() => {
  initialize().then(async () => {
    const state = await readState();
    if (state.meta.crawling && !refreshJob) await mutate(s => { s.meta.crawling = false; });
    if (state.run.status === "running") await pauseRun("Chrome vừa mở lại. Bấm tiếp tục để kiểm tra tài khoản và đổi tiếp.");
    if (GCA.dailyDue(state)) await runDaily();
  }).catch(error => console.error(error.message));
});
async function runDaily() {
  await refreshSources();
  const state = await readState();
  if (state.settings.autoRedeem && state.run.status !== "running") await startRun(false);
  await ensureDailyAlarm(await readState());
}
chrome.alarms.onAlarm.addListener(alarm => {
  return initialize().then(async () => {
    if (alarm.name === DAILY_ALARM) await runDaily();
    if (alarm.name === WATCHDOG_ALARM) {
      await pumpRunner();
    }
  }).catch(error => console.error(error.message));
});
chrome.tabs.onRemoved.addListener(tabId => {
  initialize().then(() => mutate(state => {
    if (state.run.tabId === tabId && state.run.status === "running") {
      markUncertain(state, "Tab đổi quà đã đóng khi đang xử lý.");
      state.run.status = "paused"; state.run.reason = "Tab Garena đã đóng. Bấm tiếp tục để mở lại.";
    }
  })).then(() => scheduleRunner()).catch(error => console.error(error.message));
});
initialize().then(() => scheduleRunner()).catch(error => console.error("Không khởi tạo được Code Desk:", error.message));
