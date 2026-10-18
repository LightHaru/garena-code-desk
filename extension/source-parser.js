(function (root) {
  "use strict";
  const { validCode, uniqueCodes } = root.GCA;
  function parseHtml(html, selector = "") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script,style,iframe,noscript,svg,template").forEach(node => node.remove());
    if (selector) return uniqueCodes([...doc.querySelectorAll(selector)].flatMap(node => (node.textContent || "").trim().split(/[\s,;]+/)));
    const found = [];
    for (const node of doc.querySelectorAll("code,kbd,[data-giftcode]")) {
      const value = node.getAttribute("data-giftcode") || node.textContent.trim();
      if (validCode(value)) found.push(value);
    }
    for (const table of doc.querySelectorAll("table")) {
      const first = table.querySelector("tr");
      if (!/code|cdkey|mã quà/i.test(first?.textContent || "")) continue;
      for (const row of table.querySelectorAll("tr")) {
        const cell = row.querySelector("td");
        const value = cell?.textContent.trim();
        if (validCode(value)) found.push(value);
      }
    }
    const walker = doc.createTreeWalker(doc.body, 4), textParts = [];
    while (walker.nextNode()) textParts.push(walker.currentNode.textContent);
    const text = textParts.join("\n");
    for (const hit of text.matchAll(/\b(?:gift\s*code|cdkey|code|mã\s*quà)\s*[:=–-]\s*([A-Za-z0-9][A-Za-z0-9_-]{3,63})/gi)) {
      const value = hit[1];
      if (validCode(value) && (/[0-9]/.test(value) || value === value.toUpperCase())) found.push(value);
    }
    return uniqueCodes(found);
  }
  function parseXemgiBundle(text) {
    const match = text.match(/gameId:"delta-force",title:"Delta Force",updatedAt:"([^"]+)"[^{}]{0,300}?specialCodes:(\[[^\]]*\]),codes:(\[[^\]]*\])/);
    const values = match ? [...JSON.parse(match[2]), ...JSON.parse(match[3])] : [];
    for (const hit of text.matchAll(/weapon:"[^"]+",package:"[^"]+",code:"([^"]+)"/g)) values.push(hit[1]);
    return uniqueCodes(values);
  }
  root.GCAParser = { parseHtml, parseXemgiBundle };
  if (typeof module !== "undefined" && module.exports) module.exports = root.GCAParser;
})(globalThis);
