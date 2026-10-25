(function (root) {
  "use strict";
  const { validCode, uniqueCodes } = root.GCA;
  const ignored = new Set(["code", "codes", "giftcode", "giftcodes", "cdkey", "cdkeys", "copy", "copied", "redeem", "expired", "active", "status", "none"]);
  const candidate = value => validCode(value) && !ignored.has(value.toLowerCase());
  const tokens = node => (node.textContent || "").trim().split(/[\s,;|]+/).filter(candidate);
  function parseHtml(html, selector = "") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script,style,iframe,noscript,svg,template").forEach(node => node.remove());
    if (selector) return uniqueCodes([...doc.querySelectorAll(selector)].flatMap(tokens));
    const found = [];
    for (const node of doc.querySelectorAll("code,kbd,[data-giftcode],[data-cdkey]")) {
      const value = node.getAttribute("data-giftcode") || node.getAttribute("data-cdkey");
      if (value ? candidate(value.trim()) : candidate(node.textContent.trim())) found.push((value || node.textContent).trim());
    }
    for (const table of doc.querySelectorAll("table")) {
      const first = table.querySelector("tr");
      const headers = [...(first?.querySelectorAll("th,td") || [])];
      const column = headers.findIndex(cell => /^(?:(?:gift\s*)?codes?\b|cd\s*-?\s*keys?\b|mã\s+(?:quà|đổi|giftcode|code))/i.test(cell.textContent.trim()) && !/\bbuild\b|loadout|gunsmith/i.test(cell.textContent));
      if (column < 0) continue;
      for (const row of table.querySelectorAll("tr")) {
        // The first row identifies this as a code table, including sites that
        // use <td> for headers. "Codes" must not become a giftcode candidate.
        if (row === first) continue;
        const cell = row.querySelectorAll("td")[column];
        if (cell) found.push(...tokens(cell));
      }
    }
    const walker = doc.createTreeWalker(doc.body, 4), textParts = [];
    while (walker.nextNode()) textParts.push(walker.currentNode.textContent);
    const text = textParts.join("\n");
    for (const hit of text.matchAll(/\b(?:gift\s*code|cdkey|code|mã\s*quà)\s*[:=–-]\s*([A-Za-z0-9][A-Za-z0-9_-]{3,63})/gi)) {
      const value = hit[1];
      if (candidate(value) && (/[0-9]/.test(value) || value === value.toUpperCase())) found.push(value);
    }
    return uniqueCodes(found);
  }
  function parseXemgiBundle(text) {
    const values = [];
    // Read JSON string arrays from the Delta Force section regardless of key
    // order, whitespace or the chunk's generated name. Never evaluate JS.
    for (const section of text.matchAll(/gameId\s*:\s*"delta-force"([\s\S]{0,80000}?)(?=gameId\s*:|$)/g)) {
      for (const hit of section[1].matchAll(/\b(?:specialCodes|codes)\s*:\s*(\[(?:\s*"(?:[^"\\]|\\.)*"\s*,?)*\s*\])/g)) {
        try { values.push(...JSON.parse(hit[1])); } catch {}
      }
    }
    for (const hit of text.matchAll(/weapon:"[^"]+",package:"[^"]+",code:"([^"]+)"/g)) values.push(hit[1]);
    return uniqueCodes(values);
  }
  root.GCAParser = { parseHtml, parseXemgiBundle };
  if (typeof module !== "undefined" && module.exports) module.exports = root.GCAParser;
})(globalThis);
