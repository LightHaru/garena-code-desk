(function () {
  "use strict";
  if (globalThis.__ccCodeDeskContent) return;
  globalThis.__ccCodeDeskContent = true;
  let working = false, paused = false, panel, wakeRequested = false, activeAttempt, activeTracker;
  const sleep = ms => command("PAGE_DELAY", { ms });
  async function command(type, payload = {}) {
    const reply = await chrome.runtime.sendMessage({ type, ...payload });
    if (!reply?.ok) throw new Error(reply?.error || "Extension chưa phản hồi. Mở lại bảng điều khiển.");
    return reply;
  }
  function visible(node) {
    if (!node || !node.isConnected) return false;
    const css = getComputedStyle(node);
    return css.display !== "none" && css.visibility !== "hidden" && Number(css.opacity) !== 0 && node.getClientRects().length > 0;
  }
  function clickPageControl(node) {
    // Remove the script URL before Chrome starts anchor activation. Cancelling
    // the click alone still produced CSP reports from the isolated world.
    const anchor = node.closest("a[href]");
    if (anchor?.protocol !== "javascript:") { node.click(); return; }
    const href = anchor.getAttribute("href");
    const preventScriptNavigation = event => event.preventDefault();
    anchor.removeAttribute("href");
    node.addEventListener("click", preventScriptNavigation, true);
    try { node.click(); }
    finally {
      node.removeEventListener("click", preventScriptNavigation, true);
      // Preserve a new destination if the site's handler assigned one.
      if (!anchor.hasAttribute("href")) anchor.setAttribute("href", href);
    }
  }
  function blockers() {
    if ([...document.querySelectorAll('iframe[src*="captcha"],iframe[src*="challenge"],.g-recaptcha,.h-captcha,[id*="captcha"]')].some(visible)) return "Trang đang yêu cầu xác minh. Anh xử lý trên Garena rồi bấm Tiếp tục.";
    if (visible(document.querySelector("#onetrust-banner-sdk"))) return "Đóng/chọn tùy chọn cookie trên Garena rồi bấm Tiếp tục.";
    return "";
  }
  function siteStatus() {
    const block = blockers();
    const input = document.querySelector(".state-after .exc-input");
    const account = document.querySelector("#logined .username")?.textContent.trim() || "";
    const ready = !block && visible(document.querySelector("#logined")) && visible(input) && visible(document.querySelector(".btn-exchange")) && !!account;
    return { ready, account, reason: block || (ready ? "" : "Anh đăng nhập tài khoản chơi Delta Force trên trang Garena rồi bấm Tiếp tục. Đăng nhập Chrome và Garena là hai phiên riêng.") };
  }
  function mountPanel() {
    if (panel) return;
    panel = GCAPanel.create({
      onStart: async () => { await command("START_HERE", { site: siteStatus() }); await refreshPanel(); },
      onPause: async () => { await command("PAUSE_RUN"); paused = true; await refreshPanel(); },
      onOpen: () => command("OPEN_MANAGER")
    });
  }
  function setPanel(text) { mountPanel(); panel.setMessage(text); }
  async function refreshPanel() {
    const reply = await command("PANEL_STATE", { account: siteStatus().account });
    mountPanel(); panel.render(reply.view);
    return reply.view;
  }
  function observeAttempt(attempt) {
    const started = Date.now();
    const initial = new Map();
    const selectors = "#diaTips,#superTips";
    for (const node of document.querySelectorAll(selectors)) initial.set(node, { text: node.textContent, visible: visible(node) });
    let finish, completed = false, timer, observer, domTimer;
    const promise = new Promise(resolve => { finish = resolve; });
    function settle(result) {
      if (completed) return;
      completed = true;
      clearTimeout(timer); clearTimeout(domTimer); observer.disconnect(); window.removeEventListener("message", onNetwork);
      finish(result);
    }
    function onNetwork(event) {
      const data = event.data;
      if (event.source !== window || event.origin !== location.origin || !data || data.channel !== "cc-garena-redeem-result-v1") return;
      if (data.code !== attempt.code || data.startedAt < started || data.at < started) return;
      if (typeof data.httpStatus !== "number") return;
      const serverCode = typeof data.serverCode === "number" ? data.serverCode : undefined;
      // A 200 response without the expected schema must be inspected, never treated as success.
      settle({ serverCode, httpStatus: data.httpStatus, message: String(data.message || "").slice(0, 600) });
    }
    observer = new MutationObserver(() => {
      const block = blockers();
      if (block) { settle({ message: block }); return; }
      for (const node of document.querySelectorAll(selectors)) {
        const before = initial.get(node), text = node.textContent.trim();
        if (text && visible(node) && (!before?.visible || text !== before.text?.trim())) {
          clearTimeout(domTimer);
          // Prefer the exact numeric response when the page updates its toast first.
          domTimer = setTimeout(() => settle({ message: text }), 500);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("message", onNetwork);
    timer = setTimeout(() => settle({ message: "Không nhận được kết quả rõ ràng sau 30 giây." }), 30000);
    return { promise, cancel: () => settle({ message: "Lượt dừng trước khi bấm Đổi." }), timeout: () => settle({ message: "Không nhận được kết quả rõ ràng; giữ code để kiểm tra." }) };
  }
  async function execute(attempt) {
    const status = siteStatus();
    if (!status.ready || status.account !== attempt.account) throw new Error(status.reason || "Tài khoản đã đổi; dừng để kiểm tra.");
    const oldDialog = document.querySelector("#diaTips");
    if (visible(oldDialog)) {
      const close = oldDialog.querySelector(".btn-close");
      if (!close) throw new Error("Hãy đóng thông báo cũ của Garena trước khi tiếp tục.");
      clickPageControl(close);
      await sleep(250);
      if (visible(oldDialog)) throw new Error("Không đóng được thông báo cũ. Anh đóng thủ công rồi tiếp tục.");
    }
    const input = document.querySelector(".exc-input"), button = document.querySelector(".btn-exchange");
    const tracker = observeAttempt(attempt);
    activeTracker = tracker;
    const allowed = await command("CLICKED", { attemptId: attempt.attemptId });
    if (!allowed.allowed || paused) { tracker.cancel(); await command("ABANDON", { attemptId: attempt.attemptId }); return null; }
    const current = siteStatus();
    if (!current.ready || current.account !== attempt.account) { tracker.cancel(); await command("ABANDON", { attemptId: attempt.attemptId }); throw new Error(current.reason || "Tài khoản đã thay đổi."); }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, attempt.code);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    clickPageControl(button);
    return tracker.promise;
  }
  async function run() {
    if (working) return;
    working = true; paused = false;
    let attempt;
    try {
      let site = siteStatus();
      // Give the site's login-state initialization a bounded opportunity to finish.
      for (let i = 0; !site.ready && !blockers() && i < 12; i++) { await sleep(500); site = siteStatus(); }
      const attached = await command("ATTACH", { site });
      if (!attached.run) return;
      setPanel(`Tài khoản: ${site.account}. Đang lấy code tiếp theo…`);
      if (!paused) {
        const status = siteStatus();
        if (!status.ready) throw new Error(status.reason);
        const reply = await command("CLAIM", { runId: attached.runId, account: status.account });
        if (reply.waitMs) return;
        attempt = reply.next;
        if (!attempt) return;
        activeAttempt = attempt;
        setPanel(`Đang đổi ${attempt.code} · ${attempt.account}`);
        const result = await execute(attempt);
        if (!result) return;
        const saved = await command("RESULT", { attemptId: attempt.attemptId, code: attempt.code, result });
        setPanel(`${attempt.code}: ${GCA.STATUS_LABELS[GCA.classify(result).status]}`);
        attempt = null;
        if (!saved.continue) return;
      }
    } catch (error) {
      setPanel(error.message);
      try { await command("RUN_PROBLEM", { attemptId: attempt?.attemptId, reason: error.message }); } catch {}
    } finally {
      working = false;
      activeTracker?.cancel();
      activeAttempt = null; activeTracker = null;
      try { await refreshPanel(); } catch {}
      if (wakeRequested) { wakeRequested = false; queueMicrotask(run); }
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message.type === "RUN_AVAILABLE") { if (working) wakeRequested = true; else run(); respond({ ok: true }); }
    if (message.type === "RUN_PAUSED") { paused = true; respond({ ok: true }); }
    if (message.type === "PANEL_UPDATE") { mountPanel(); panel.render(message.view); respond({ ok: true }); }
    if (message.type === "SITE_STATUS") respond({ ok: true, site: siteStatus() });
    if (message.type === "ATTEMPT_TIMEOUT") { if (activeAttempt?.attemptId === message.attemptId) activeTracker?.timeout(); respond({ ok: true }); }
    return false;
  });
  // Show controls on a passive visit; no code is submitted before a start action.
  mountPanel();
  refreshPanel().then(view => { if (view.running) run(); }).catch(error => setPanel(error.message));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshPanel().catch(() => {}); });
  window.addEventListener("focus", () => refreshPanel().catch(() => {}));
  const loginNode = document.querySelector("#logined");
  if (loginNode) new MutationObserver(() => refreshPanel().catch(() => {})).observe(loginNode, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style"] });
})();
