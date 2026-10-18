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
        const entry = page.match(/src="(\/assets\/index-[A-Za-z0-9_-]+\.js)"/);
        if (!entry) throw new Error("Không thấy module dữ liệu của trang.");
        const index = await fetchText(new URL(entry[1], source.url).href);
        const route = index.match(/(?:assets\/|\.\/)(EsportsPage-[A-Za-z0-9_-]+\.js)/);
        if (!route) throw new Error("Không thấy module danh sách code.");
        const routeUrl = new URL(route[1], new URL(entry[1], source.url)).href;
        const routeText = await fetchText(routeUrl);
        const dataModule = routeText.match(/from"\.\/(MatchErrorBoundary-[A-Za-z0-9_-]+\.js)"/);
        if (!dataModule) throw new Error("Module nguồn đã thay đổi tên/cấu trúc.");
        const bundle = await fetchText(new URL(dataModule[1], routeUrl).href);
        const codes = root.GCAParser.parseXemgiBundle(bundle);
        if (!codes.length) throw new Error("Module không còn danh sách giftcode nhận dạng được.");
        values.push(...codes);
      } catch (error) { warnings.push(`Danh sách trang: ${error.message}`); }
      if (!values.length) throw new Error(warnings.join(" ") || "Nguồn không trả về code.");
      return { codes: uniqueCodes(values), warning: warnings.join(" · ") };
    }
    if (source.kind === "garena") {
      const home = await asJson("https://deltaforce.garena.vn/api/app/home");
      if (!Array.isArray(home.news_items)) throw new Error("API tin Garena đã đổi cấu trúc.");
      const news = [...home.news_items];
      // First page includes current news even when the home page contains pinned old items.
      const listing = await asJson("https://deltaforce.garena.vn/api/app/news?page=1&category_id=1");
      if (Array.isArray(listing.items)) news.unshift(...listing.items);
      const seen = new Set(), picks = [];
      for (const item of news) {
        if (!item.display_id || seen.has(item.display_id)) continue;
        seen.add(item.display_id);
        picks.push({ ...item, codeTopic: /gift\s*code|cdkey|\bcode\b|mã quà|đổi quà|livestream|nhận quà/i.test(`${item.title} ${item.summary || ""}`) });
      }
      picks.sort((a, b) => new Date(b.publish_at || 0) - new Date(a.publish_at || 0));
      const ordered = [...new Map([...picks.filter(item => item.codeTopic).slice(0, 4), ...picks].map(item => [item.display_id, item])).values()];
      const found = [], provenance = [], nextCache = { ...cache };
      let checked = 0;
      for (const item of ordered.slice(0, 8)) {
        const url = `https://deltaforce.garena.vn/api/app/full-news?display_id=${encodeURIComponent(item.display_id)}`;
        const article = await asJson(url);
        if (typeof article.content !== "string") throw new Error("Chi tiết tin Garena thiếu nội dung.");
        const codes = await parseHtml(article.content);
        found.push(...codes);
        checked++;
        if (codes.length) provenance.push({ title: item.title, url: `https://deltaforce.garena.vn/news/tat-ca/${item.display_id}`, codes });
        nextCache[item.display_id] = Date.now();
      }
      return { codes: uniqueCodes(found), checked, provenance, cache: nextCache, warning: "Chỉ quét bài công khai có chữ; code trong ảnh/livestream/bình luận Facebook cần bổ sung thủ công." };
    }
    const text = await fetchText(source.url);
    if (source.kind === "json" || source.kind === "text") return { codes: root.GCA.parseImport(text) };
    if (source.kind === "html") return { codes: await parseHtml(text, source.selector || "") };
    throw new Error("Loại nguồn chưa được hỗ trợ.");
  }
  root.GCASources = { crawlSource };
  if (typeof module !== "undefined" && module.exports) module.exports = root.GCASources;
})(globalThis);
