/* Observe the existing page's redemption response. Never issue requests or read credentials. */
(function () {
  "use strict";
  if (window.__ccCodeDeskObserver) return;
  window.__ccCodeDeskObserver = true;
  const metadata = new WeakMap();
  function identify(raw) {
    try {
      const url = new URL(String(raw), location.href);
      if (url.origin !== "https://sg-act.playerinfinite.com" || url.pathname !== "/api/proxy/present/CdkV2/RedeemCDKey") return null;
      const code = url.searchParams.get("cdkey");
      return code && /^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$/.test(code) ? { code } : null;
    } catch { return null; }
  }
  function emit(meta, httpStatus, data) {
    if (!meta) return;
    // Deliberately forward only giftcode, status, numeric result and a short message.
    const result = { code: meta.code, httpStatus: Number(httpStatus), at: Date.now(), startedAt: meta.startedAt };
    if (data && typeof data.code === "number") result.serverCode = data.code;
    if (data && typeof data.msg === "string") result.message = data.msg.slice(0, 600);
    window.postMessage({ channel: "cc-garena-redeem-result-v1", ...result }, location.origin);
  }
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    const meta = identify(url);
    if (meta) metadata.set(this, meta); else metadata.delete(this);
    return Reflect.apply(open, this, [method, url, ...args]);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const meta = metadata.get(this);
    if (meta) {
      meta.startedAt = Date.now();
      this.addEventListener("loadend", () => {
        try {
          const data = this.responseType === "json" ? this.response : (!this.responseType || this.responseType === "text") ? JSON.parse(this.responseText) : null;
          emit(meta, this.status, data);
        } catch { emit(meta, this.status, null); }
      }, { once: true });
    }
    return Reflect.apply(send, this, args);
  };
  const originalFetch = window.fetch;
  window.fetch = async function (input, ...args) {
    const meta = identify(typeof input === "string" || input instanceof URL ? input : input?.url);
    if (meta) meta.startedAt = Date.now();
    try {
      const response = await Reflect.apply(originalFetch, this, [input, ...args]);
      if (meta) response.clone().json().then(data => emit(meta, response.status, data)).catch(() => emit(meta, response.status, null));
      return response;
    } catch (error) { if (meta) emit(meta, 0, null); throw error; }
  };
})();
