(function (root) {
  "use strict";
  // Public HTML reviewed on this date. Presence in a list is not redemption proof.
  const presets = {
    codemoi: { name: "Code Mới · Delta Force", url: "https://codemoi.net/games/delta-force/", kind: "html", selector: "code" },
    fpt: { name: "FPT Shop · Delta Force", url: "https://fptshop.com.vn/tin-tuc/danh-gia/code-delta-force-184570", kind: "html", selector: "#article-detail table tr:not(:first-child) > :first-child" },
    dienmayxanh: { name: "Điện máy XANH · Delta Force", url: "https://www.dienmayxanh.com/kinh-nghiem-hay/code-delta-force-garena-moi-nhat-1591472", kind: "html", selector: ".contentnews table tbody tr > td:first-child" }
  };
  for (const value of Object.values(presets)) Object.freeze(value);
  root.GCASourceSuggestions = Object.freeze({ checkedAt: "2026-10-18", presets: Object.freeze(presets), priorityCodes: Object.freeze(["WELCOMETODF", "DFVNA4T8Z6P3"]) });
})(globalThis);
