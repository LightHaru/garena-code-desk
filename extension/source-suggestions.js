(function (root) {
  "use strict";
  // Public HTML reviewed on this date. Presence in a list is not redemption proof.
  const presets = {
    codemoi: { name: "Code Mới · Delta Force", url: "https://codemoi.net/games/delta-force/", kind: "html", selector: "code" },
    download: { name: "Download.com.vn · Delta Force", url: "https://download.com.vn/code-game-delta-force-195638", kind: "html", selector: "" },
    dienmayxanh: { name: "Điện máy XANH · Delta Force", url: "https://www.dienmayxanh.com/kinh-nghiem-hay/code-delta-force-garena-moi-nhat-1591472", kind: "html", selector: "" },
    rankga: { name: "RankGA · Delta Force", url: "https://rankga.com/code-delta-force/", kind: "html", selector: "" }
  };
  for (const value of Object.values(presets)) Object.freeze(value);
  root.GCASourceSuggestions = Object.freeze({ checkedAt: "2026-10-25", presets: Object.freeze(presets) });
})(globalThis);
