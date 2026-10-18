/* Shared data rules; no credentials or network access. */
(function (root) {
  "use strict";
  const DAY = 86400000;
  const REDEEM_URL = "https://redeem.df.garena.sg/vi/cdkgarena.html";
  const STATUS_LABELS = {
    pending: "Chờ đổi", processing: "Đang đổi", redeemed: "Đã nhận quà", used: "Đã dùng",
    expired: "Hết hạn", invalid: "Không hợp lệ", exhausted: "Hết lượt", account_limit: "Đã đủ gói",
    skipped_error: "Đã bỏ qua", review: "Cần kiểm tra", dismissed: "Đã loại"
  };
  function validCode(value) {
    return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$/.test(value) && /[A-Za-z]/.test(value);
  }
  function uniqueCodes(values) {
    return [...new Set(values.filter(validCode))];
  }
  function parseImport(text) {
    const raw = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!raw) return [];
    if (/^[\[{]/.test(raw)) {
      const data = JSON.parse(raw);
      const list = Array.isArray(data) ? data : data.codes;
      if (!Array.isArray(list)) throw new Error("JSON cần là mảng code hoặc đối tượng có trường codes.");
      return uniqueCodes(list.map(item => typeof item === "string" ? item.trim() : item?.code?.trim()));
    }
    // Accept lists/CSV, preserving case. Prose and gun build strings are rejected as whole tokens.
    return uniqueCodes(raw.split(/[\s,;|]+/).map(item => item.replace(/^[\s"'`]+|[\s"'`]+$/g, "")));
  }
  function freshState(now = Date.now()) {
    return {
      version: 1, codes: {}, account: "", settings: { dailyEnabled: true, dailyHour: 9, dailyMinute: 0, autoRedeem: false, delaySeconds: 5 },
      sources: [
        { id: "xemgi", kind: "xemgi", name: "XemGì · Delta Force", url: "https://xemgi.de/codes", enabled: true },
        { id: "garena", kind: "garena", name: "Garena Việt Nam · Tin chính thức", url: "https://deltaforce.garena.vn/", enabled: true }
      ],
      run: { status: "idle", reason: "Sẵn sàng", processed: 0 },
      meta: { createdAt: now, lastCrawlAt: 0, crawling: false, lastCrawlSummary: "", seededAt: 0 }
    };
  }
  function mergeCodes(state, values, source, now = Date.now()) {
    const addedCodes = [];
    const list = uniqueCodes(values);
    for (const code of list) {
      let record = Object.hasOwn(state.codes, code) ? state.codes[code] : null;
      if (!record) {
        record = { code, firstSeen: now, lastSeen: now, globalStatus: "active", sources: [], accounts: {} };
        state.codes[code] = record;
        addedCodes.push(code);
      }
      record.lastSeen = now;
      if (source && !record.sources.some(item => item.url === source.url)) {
        record.sources.push({ name: String(source.name).slice(0, 160), url: String(source.url).slice(0, 2048) });
      }
      // An archived record is a tombstone. A crawl never reactivates it.
    }
    return { added: addedCodes.length, found: list.length, addedCodes };
  }
  function accountKey(account) { return `u:${account}`; }
  function codeStatus(record, account) {
    return record.globalStatus !== "active" ? record.globalStatus : (record.accounts[accountKey(account)]?.status || "pending");
  }
  function eligible(record, account, now = Date.now()) {
    if (record.globalStatus !== "active") return false;
    const result = record.accounts[accountKey(account)];
    if (!result) return true;
    // Only unattempted or explicitly restored codes can enter a new claim.
    // Historical retry timestamps never make a failed code eligible again.
    return result.status === "pending";
  }
  function stats(state, account = state.account) {
    const totals = { total: 0, waiting: 0, redeemed: 0, skipped: 0, errors: 0, review: 0, deferred: 0 };
    for (const record of Object.values(state.codes)) {
      const status = codeStatus(record, account);
      totals.total++;
      if (status === "redeemed") totals.redeemed++;
      else if (["pending", "processing"].includes(status)) totals.waiting++;
      else if (status === "review") totals.review++;
      else totals.skipped++;
      if (status === "skipped_error") totals.errors++;
    }
    return totals;
  }
  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase();
  }
  function skipError(reason, pause = false) {
    return { status: "skipped_error", pause, reason: `${reason} Đã bỏ qua code; không tự thử lại.` };
  }
  function classify({ serverCode, httpStatus, message = "" } = {}) {
    const numeric = serverCode !== null && serverCode !== undefined && serverCode !== "" ? Number(serverCode) : NaN;
    if (httpStatus === 429) return skipError("Garena giới hạn tốc độ. Tạm dừng lượt; chờ ít nhất 15 phút trước khi tiếp tục các code còn lại.", true);
    if ([401, 403].includes(httpStatus)) return skipError("Tạm dừng lượt: cần đăng nhập hoặc xác minh trên trang Garena.", true);
    if (httpStatus >= 500 || httpStatus === 0) return skipError("Tạm dừng lượt: kết nối/máy chủ đang lỗi.", true);
    if (numeric === 400073) return skipError("Garena báo cấu hình gói quà lỗi.");
    if (numeric === 400069) return skipError("CDKey chưa mở thời gian đổi.");
    if (numeric === 503701) return skipError("Tạm dừng lượt: Garena báo lỗi mạng.", true);
    if (numeric === 300001) return skipError("Tạm dừng lượt: phiên đăng nhập đã hết hạn.", true);
    if (numeric === 503001) return skipError("Tạm dừng lượt: tài khoản chưa có quyền/điều kiện đổi quà.", true);
    const codes = {
      0: ["redeemed", "Garena xác nhận đổi thành công."],
      400053: ["account_limit", "Tài khoản đã đủ lượt nhận gói này."],
      400054: ["invalid", "Garena báo CDKey không hợp lệ."],
      400067: ["exhausted", "CDKey đã hết lượt đổi."],
      400068: ["account_limit", "Tài khoản đã đạt giới hạn của nhóm CDKey."],
      400070: ["expired", "Thời gian đổi CDKey đã kết thúc."],
      400072: ["used", "Tài khoản đã đổi CDKey này."]
    };
    if (Object.hasOwn(codes, numeric)) {
      const [status, reason] = codes[numeric];
      return { status, reason, pause: false };
    }
    // Unknown numeric responses are never replaced by a guessed text result.
    if (Number.isFinite(numeric)) return skipError(`Phản hồi Garena chưa biết (${numeric}).`);
    const text = normalize(message);
    if (/captcha|recaptcha|xac minh|verification|security check|too many|qua nhanh|qua nhieu|rate limit|thuong xuyen|frequen/.test(text)) {
      return skipError("Tạm dừng lượt: cần chờ hoặc xác minh trực tiếp trên trang Garena.", true);
    }
    if (/dang nhap|log.?in|sign.?in|phien.*het han/.test(text)) return skipError("Tạm dừng lượt: cần đăng nhập lại Garena.", true);
    if (/error_hint_400073|(?:cau hinh.*(?:goi qua|qua)|(?:goi qua|qua).*cau hinh)|(?:gift|cd.?key|pack).*(?:config|configuration).*error/.test(text)) return skipError("Garena báo cấu hình gói quà lỗi.");
    if (/chua.*(?:bat dau|mo doi)|not yet available|not started|error_hint_400069/.test(text)) return skipError(message);
    if (/het han|expired|period.*ended|error_hint_400070/.test(text)) return { status: "expired", reason: message };
    if (/het luot|da het so luong|redemption limit.*reached|error_hint_400067/.test(text)) return { status: "exhausted", reason: message };
    if (/khong the doi them|gioi han.*nhom|error_hint_400068/.test(text)) return { status: "account_limit", reason: message };
    if (/da doi roi|da (?:su dung|nhan|doi)|already.*(?:redeem|claim|used)|error_hint_400072/.test(text) && !/thanh cong/.test(text)) return { status: "used", reason: message };
    if (/khong hop le|invalid (?:cd.?key|code)|cd.?key.*invalid/.test(text)) return { status: "invalid", reason: message };
    if (/(?:doi|nhan|redeem|claim).*(?:thanh cong|success)|successfully claimed/.test(text) && !/khong|chua|failed|unsuccess/.test(text)) return { status: "redeemed", reason: message };
    if (/loi mang|network|thu lai sau|try again later|timeout|khong nhan duoc ket qua|chua nhan duoc ket qua/.test(text)) return skipError(`Tạm dừng lượt: ${message}`, true);
    return skipError(message || "Chưa nhận được kết quả rõ ràng.", !text);
  }
  function applyResult(state, code, account, raw, now = Date.now()) {
    const record = state.codes[code];
    if (!record) throw new Error("Không tìm thấy code trong lượt đang chạy.");
    const decision = classify(raw);
    const prior = record.accounts[accountKey(account)] || {};
    const status = decision.status;
    if (["expired", "invalid", "exhausted"].includes(status)) record.globalStatus = status;
    record.accounts[accountKey(account)] = {
      status, attempts: prior.attempts || 1, at: now, message: String(raw.message || decision.reason).slice(0, 600),
      reason: decision.reason, serverCode: raw.serverCode ?? null, httpStatus: raw.httpStatus ?? null,
      nextRetryAt: 0
    };
    return decision;
  }
  function migrateNoRetry(state) {
    let migrated = 0;
    for (const record of Object.values(state.codes)) {
      for (const result of Object.values(record.accounts)) {
        if (!["retry", "future", "review"].includes(result.status)) continue;
        const decision = classify({ serverCode: result.serverCode, httpStatus: result.httpStatus, message: result.message || result.reason });
        result.status = "skipped_error";
        result.reason = decision.status === "skipped_error" ? decision.reason : skipError("Lượt cũ chưa đổi được code.").reason;
        result.nextRetryAt = 0;
        delete result.deferredRunId;
        migrated++;
      }
    }
    return migrated;
  }
  function nextDailyAt(now, hour, minute) {
    const shifted = new Date(now + 7 * 3600000);
    let target = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), hour - 7, minute);
    if (target <= now) target += DAY;
    return target;
  }
  function dailyDue(state, now = Date.now()) {
    if (!state.settings.dailyEnabled) return false;
    const today = nextDailyAt(now, state.settings.dailyHour, state.settings.dailyMinute) - DAY;
    return Number(state.meta.lastCrawlAt || state.meta.lastCrawlAttemptAt || 0) < today;
  }
  function publicUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Nguồn cần là URL HTTPS công khai, không chứa tài khoản/mật khẩu.");
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) throw new Error("Nguồn cần dùng tên miền công khai.");
    return url;
  }
  const api = { DAY, REDEEM_URL, STATUS_LABELS, validCode, uniqueCodes, parseImport, freshState, mergeCodes, accountKey, codeStatus, eligible, stats, normalize, skipError, classify, applyResult, migrateNoRetry, nextDailyAt, dailyDue, publicUrl };
  root.GCA = Object.freeze(api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
