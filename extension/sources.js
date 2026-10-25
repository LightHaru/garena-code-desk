(function (root) {
  "use strict";
  async function crawlSource(source, { fetchText, parseHtml, cache = {} }) {
    const { uniqueCodes } = root.GCA;
    const asJson = async url => JSON.parse(await fetchText(url));
    if (source.kind === "xemgi") {
      const warnings = [], values = [];
      try {
        const data = await asJson("https://xemgi.de/api/esports/codes");
        const game = data.codes?.find(item => item.gameId === "delta-force");
        if (!game || !Array.isArray(game.codes)) throw new Error("Nguồn API đã đổi cấu trúc.");
        values.push(...(game.specialCodes || []), ...game.codes);
      } catch (error) { warnings.push(`API: ${error.message}`); }
      // The visible page combines a canonical list and premium weapon packs.
      // Read the public static literals as JSON; downloaded JavaScript is never executed.
      try {
        const page = await fetchText(source.url);
        const entry = page.match(/src\s*=\s*["'](\/assets\/index-[A-Za-z0-9_-]+\.js)["']/);
        if (!entry) throw new Error("Không thấy module dữ liệu của trang.");
        const index = await fetchText(new URL(entry[1], source.url).href);
        const route = index.match(/(?:assets\/|\.\/)((?:EsportsPage|CodesPage|GiftcodesPage)-[A-Za-z0-9_-]+\.js)/);
        if (!route) throw new Error("Không thấy module danh sách code.");
        const routeUrl = new URL(route[1], new URL(entry[1], source.url)).href;
        const routeText = await fetchText(routeUrl);
        let codes = root.GCAParser.parseXemgiBundle(routeText);
        // A renamed data chunk must not require an extension update. Follow
        // same-origin static imports as text, with a fixed request budget.
        const modules = [...new Set([...routeText.matchAll(/from\s*["'](\.\/[A-Za-z0-9_-]+\.js)["']/g)].map(hit => hit[1]))]
          .filter(name => !/\/(?:vendor-|index-)/.test(name))
          .sort((a, b) => Number(/MatchErrorBoundary|code|data/i.test(b)) - Number(/MatchErrorBoundary|code|data/i.test(a)));
        let lastError;
        for (const name of modules.slice(0, 8)) {
          if (codes.length) break;
          try { codes = root.GCAParser.parseXemgiBundle(await fetchText(new URL(name, routeUrl).href)); }
          catch (error) { lastError = error; }
        }
        if (!codes.length) throw new Error(lastError?.message || "Module không còn danh sách giftcode nhận dạng được.");
        values.push(...codes);
      } catch (error) { warnings.push(`Danh sách trang: ${error.message}`); }
      if (!values.length) throw new Error(warnings.join(" ") || "Nguồn không trả về code.");
      return { codes: uniqueCodes(values), warning: warnings.join(" · "), partial: warnings.length > 0 };
    }
    if (source.kind === "garena") {
      const news = [], warnings = [];
      const feeds = [
        { url: "https://deltaforce.garena.vn/api/app/home", key: "news_items" },
        ...[1, 6, 7].map(id => ({ url: `https://deltaforce.garena.vn/api/app/news?page=1&category_id=${id}`, key: "items" }))
      ];
      const listings = await Promise.allSettled(feeds.map(async feed => {
        const data = await asJson(feed.url);
        if (!Array.isArray(data[feed.key])) throw new Error("Danh sách tin Garena đã đổi cấu trúc.");
        return data[feed.key];
      }));
      listings.forEach(result => {
        if (result.status === "fulfilled") news.push(...result.value);
        else warnings.push(result.reason.message);
      });
      if (!news.length && warnings.length) throw new Error(warnings.join(" · "));
      const seen = new Set(), picks = [];
      for (const item of news) {
        if (!item.display_id || seen.has(item.display_id)) continue;
        seen.add(item.display_id);
        picks.push({ ...item, codeTopic: /gift\s*code|cdkey|\bcode\b|mã quà|đổi quà|livestream|nhận quà/i.test(`${item.title} ${item.summary || ""}`) });
      }
      picks.sort((a, b) => new Date(b.publish_at || 0) - new Date(a.publish_at || 0));
      const ordered = [...new Map([...picks.filter(item => item.codeTopic).slice(0, 8), ...picks].map(item => [item.display_id, item])).values()];
      const found = [], provenance = [], nextCache = { ...cache };
      let checked = 0;
      for (const item of ordered.slice(0, 12)) {
        try {
          const url = `https://deltaforce.garena.vn/api/app/full-news?display_id=${encodeURIComponent(item.display_id)}`;
          const article = await asJson(url);
          if (typeof article.content !== "string") throw new Error("Chi tiết tin Garena thiếu nội dung.");
          const codes = await parseHtml(article.content);
          found.push(...codes);
          checked++;
          if (codes.length) provenance.push({ title: item.title, url: `https://deltaforce.garena.vn/news/tat-ca/${item.display_id}`, codes });
          nextCache[item.display_id] = Date.now();
        } catch (error) { warnings.push(`${item.title}: ${error.message}`); }
      }
      if (!checked && warnings.length) throw new Error(warnings.join(" · "));
      return { codes: uniqueCodes(found), checked, provenance, cache: nextCache, partial: warnings.length > 0,
        warning: warnings.length ? `Có ${warnings.length} phần tin chưa đọc được; đã giữ mã từ ${checked} bài đọc thành công. ${warnings.slice(0, 2).join(" · ")}` : "Đọc tin, sự kiện và giải đấu mới; tối đa 12 bài/lượt, ưu tiên bài có code. Chỉ đọc chữ công khai." };
    }
    const text = await fetchText(source.url);
    if (source.kind === "json" || source.kind === "text") {
      const codes = root.GCA.parseImport(text);
      if (!codes.length) throw new Error("Nguồn danh sách không trả về giftcode nhận dạng được.");
      return { codes };
    }
    if (source.kind === "html") {
      let codes, selectorError;
      try { codes = await parseHtml(text, source.selector || ""); }
      catch (error) { if (!source.autoExtract) throw error; selectorError = error; codes = []; }
      // Built-in lists also inspect giftcode tables and explicit code labels.
      // Union both readers so new rows outside the old selector are not missed.
      if (source.autoExtract && source.selector) codes = uniqueCodes([...codes, ...await parseHtml(text)]);
      // Empty or moved layouts must be visible as a source error, never a
      // successful "no new code" result that hides a broken selector.
      if (!codes.length) throw new Error("Không nhận dạng được giftcode trong trang/vùng đã chọn. Nguồn có thể đổi bố cục hoặc không còn danh sách code.");
      return { codes, warning: selectorError ? "Vùng cũ đã đổi; đã đọc code bằng bảng/nhãn giftcode trong trang." : "" };
    }
    throw new Error("Loại nguồn chưa được hỗ trợ.");
  }
  root.GCASources = { crawlSource };
  if (typeof module !== "undefined" && module.exports) module.exports = root.GCASources;
})(globalThis);
