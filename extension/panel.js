(function (root) {
  "use strict";
  function create({ onStart, onPause, onOpen }) {
    const host = document.createElement("div");
    host.id = "cc-garena-code-desk";
    host.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483500;max-width:calc(100vw - 36px);";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
      :host{all:initial}*{box-sizing:border-box}[hidden]{display:none!important}
      .box{font:14px/1.5 system-ui,sans-serif;width:334px;max-width:calc(100vw - 36px);background:#111e26;color:#eaf4f0;border:1px solid #365047;border-radius:17px;padding:17px;box-shadow:0 12px 45px #0005}
      .top,.state-row,.progress-label,.bottom{display:flex;justify-content:space-between;gap:10px;align-items:center}.title{font-size:15px}.brand,.mini{color:#8da69e;font-size:10px;letter-spacing:.03em}.mini{margin-top:3px;font-size:11px;letter-spacing:0}.state-row{margin-top:14px;gap:6px}.status{font-size:10px;letter-spacing:.05em;color:#e0f3b5;background:#253a32;border-radius:6px;padding:4px 7px;white-space:nowrap}.status[data-state=paused]{color:#f2cd8b;background:#3c3025}.account{font-size:11px;color:#9ab2a8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:12px 0}.count{background:#192b32;border:1px solid #294047;border-radius:10px;padding:9px 4px;text-align:center}.number{display:block;font-size:22px;font-weight:750;line-height:1.2;font-variant-numeric:tabular-nums}.count span{display:block;font-size:10px;color:#adbfba;margin-top:4px}.count.success .number{color:#e0f3b5}
      .progress-label{font-size:11px;color:#9eb4aa;margin-bottom:5px}.progress-label b{font-size:12px;color:#dce9e1;font-variant-numeric:tabular-nums}progress{display:block;width:100%;height:6px;border:0;border-radius:20px;overflow:hidden;background:#283d42;accent-color:#d4eda7}progress::-webkit-progress-bar{background:#283d42}progress::-webkit-progress-value{background:#d4eda7;border-radius:20px}
      .scope{font-size:10px;color:#819b90;line-height:1.5;margin:7px 0 0}.message{font-size:12px;line-height:1.55;color:#c1d2cb;overflow-wrap:anywhere;margin:12px 0;min-height:19px}.note{font-size:10px;color:#98afa4;margin:0 0 12px;line-height:1.5}.buttons{display:flex;gap:8px}button{font:650 13px system-ui,sans-serif;border:0;border-radius:9px;padding:10px 13px;cursor:pointer;background:#e0f3b5;color:#19291c}button:focus-visible{outline:2px solid #c7e49d;outline-offset:3px}button:disabled{opacity:.48;cursor:default}.start{flex:1}.stop{background:#293e47;color:#eaf4f0;min-width:71px}.hide{padding:3px 8px;background:transparent;color:#adbbb6;font-size:20px;line-height:1}.bottom{margin-top:12px;align-items:flex-start}.open{padding:0;background:transparent;color:#bed692;font-size:11px;text-align:left}.hint{font-size:10px;line-height:1.5;color:#859e92;max-width:155px;text-align:right}
      .box{font-family:"Segoe UI",system-ui,sans-serif;width:352px;background:#141a10;color:#e9efdf;border:1px solid #596c3c;border-top:3px solid #ed7a38;border-radius:2px;padding:17px;box-shadow:0 10px 30px #0006}
      .title{font-family:"Bahnschrift","Arial Narrow",sans-serif;font-size:19px;font-weight:750;letter-spacing:.3px}.brand{color:#94a779;font-size:9px;letter-spacing:1.1px;margin-bottom:4px}.brand span{color:#c1cdb0;letter-spacing:0;margin-left:4px}.mini{color:#a8bc8c}.state-row{margin-top:15px}.status{border-radius:1px;background:#26371a;border:1px solid #536b37;color:#d4edaf;font-size:9px;padding:4px 6px}.status[data-state=paused]{background:#352d1d;border-color:#715732;color:#ebc38e}.account{color:#a9b69a;font-size:10px;max-width:165px}.counts{gap:0;border:1px solid #3d4a2d;margin:13px 0}.count{padding:10px 3px;border:0;border-right:1px solid #3d4a2d;background:#1c2416;border-radius:0}.count:last-child{border-right:0}.number{font-family:"Bahnschrift","Arial Narrow",sans-serif;font-size:25px;font-weight:500;color:#e3ecd6}.count:first-child .number,.count.success .number{color:#c4f547}.count span{color:#a4b393;font-size:9px}.progress-label{font-size:10px;color:#9daf85}.progress-label b{color:#d5e2c2}progress{height:5px;border-radius:0;background:#303d23;accent-color:#c4f547}progress::-webkit-progress-bar{background:#303d23}progress::-webkit-progress-value{background:#c4f547;border-radius:0}.scope{color:#81966b;font-size:9px}.message{font-size:11px;color:#bacaab;margin:12px 0}.note{color:#b7a97c;font-size:10px}.buttons button{border-radius:2px;background:#c4f547;font-size:12px;font-weight:750;min-height:38px;color:#19250a}.buttons .stop{background:#27311e;border:1px solid #4a5b35;color:#dfc3a4}.hide{border:1px solid #3d4e2b;border-radius:1px;padding:2px 7px;color:#aabc92;font-size:17px}.open{color:#c4dc9f;font-size:10px}.hint{font-size:9px;color:#82976b}.channels{display:flex;gap:15px;flex-wrap:wrap;margin-top:13px;padding-top:10px;border-top:1px solid #344428}.channels a{font:10px "Segoe UI",sans-serif;color:#96b478;text-decoration:none}.channels a:hover{color:#c4f547;text-decoration:underline}.channels a:focus-visible{outline:2px solid #c4f547;outline-offset:3px}
      @media(max-width:360px){.box{padding:13px}.number{font-size:22px}.hint{max-width:125px}}
    </style><section class="box" aria-label="Garena Code Desk">
      <div class="top"><div><div class="brand">CỦ CẢI · CODE DESK <span>1.1.0</span></div><b class="title">ĐỔI QUÀ TỰ ĐỘNG</b><div class="mini" hidden></div></div><button class="hide" aria-label="Thu gọn" aria-expanded="true">−</button></div>
      <div class="body"><div class="state-row"><span class="status" data-state="idle">ĐANG KẾT NỐI</span><span class="account"></span></div>
      <div class="counts" aria-label="Bộ đếm code"><div class="count"><b class="number" data-count="processed">0</b><span>Đã xử lý</span></div><div class="count"><b class="number" data-count="waiting">0</b><span>Còn chờ</span></div><div class="count success"><b class="number" data-count="redeemed">0</b><span>Đã nhận</span></div><div class="count"><b class="number" data-count="skipped">0</b><span>Bỏ qua</span></div></div>
      <div class="progress-label"><span>Tiến độ lượt này</span><b class="progress-text">0 / 0</b></div><progress max="1" value="0" aria-label="Tiến độ lượt đổi code"></progress>
      <p class="scope">Đã xử lý: lượt này · Các số còn lại: lịch sử tài khoản.</p><p class="message" role="status" aria-live="polite">Đang đọc hàng chờ…</p><p class="note" hidden></p>
      <div class="buttons"><button class="start" disabled>Bắt đầu</button><button class="stop" disabled>Dừng</button></div>
      <div class="bottom"><button class="open">Bảng quản lý ↗</button><span class="hint">Có thể dùng tab khác.<br>Giữ tab Garena mở.</span></div><nav class="channels" aria-label="Kênh Củ Cải Phẫn Nộ"><a href="https://www.tiktok.com/@cucaiphannodf" target="_blank" rel="noopener noreferrer">TikTok ↗</a><a href="https://www.youtube.com/@CucaiDF" target="_blank" rel="noopener noreferrer">YouTube ↗</a><a href="https://www.facebook.com/profile.php?id=61594886253423" target="_blank" rel="noopener noreferrer">Facebook ↗</a></nav></div>
    </section>`;
    document.documentElement.appendChild(host);
    let view, pending = "", minimized = false;
    const node = selector => shadow.querySelector(selector);
    function setMessage(message) { node(".message").textContent = message; }
    function render(next) {
      if (next && view && next.revision < view.revision) return;
      if (next) view = next;
      if (!view) return;
      const stats = view.stats || {}, processed = view.processed || 0, total = view.progressTotal || 0;
      for (const [key, value] of Object.entries({ processed, waiting: stats.waiting || 0, redeemed: stats.redeemed || 0, skipped: stats.skipped || 0 })) node(`[data-count="${key}"]`).textContent = value;
      node(".status").textContent = ({ running: "ĐANG CHẠY", paused: "ĐÃ DỪNG", done: "HOÀN TẤT", other: "CHẠY Ở TAB KHÁC", idle: "SẴN SÀNG" })[view.status] || "SẴN SÀNG";
      node(".status").dataset.state = view.status;
      node(".account").textContent = view.account || "Chưa đăng nhập Garena";
      node(".account").title = view.account || "";
      node(".progress-text").textContent = `${processed} / ${total}`;
      node("progress").max = Math.max(1, total); node("progress").value = Math.min(processed, total);
      node("progress").setAttribute("aria-valuetext", `Đã xử lý ${processed} trong ${total} code của lượt này`);
      node(".start").textContent = pending === "start" ? "Đang bắt đầu…" : view.running ? "Đang chạy…" : view.status === "paused" ? "Tiếp tục" : view.status === "other" ? "Chạy ở tab khác" : "Bắt đầu";
      node(".start").disabled = !!pending || !view.canStart;
      node(".stop").disabled = !!pending || !view.running;
      node(".stop").textContent = pending === "pause" ? "Đang dừng…" : "Dừng";
      const notes = [];
      if (stats.deferred) notes.push(`${stats.deferred} code chờ đến giờ thử lại`);
      if (stats.review) notes.push(`${stats.review} code cần kiểm tra`);
      node(".note").textContent = notes.join(" · "); node(".note").hidden = !notes.length;
      node(".mini").textContent = `${processed} đã xử lý · ${stats.waiting || 0} còn chờ`;
      setMessage(view.busy && !view.running ? "Đang chờ kết quả code vừa gửi…" : view.reason || "Bấm Bắt đầu để đổi các code trong hàng chờ.");
    }
    async function action(kind, callback) {
      if (pending) return;
      pending = kind; render();
      try { await callback(); } catch (error) { setMessage(error.message || "Chưa thực hiện được thao tác."); }
      finally { pending = ""; if (view) { node(".start").disabled = !view.canStart; node(".stop").disabled = !view.running; node(".start").textContent = view.running ? "Đang chạy…" : view.status === "paused" ? "Tiếp tục" : view.status === "other" ? "Chạy ở tab khác" : "Bắt đầu"; node(".stop").textContent = "Dừng"; } }
    }
    node(".start").addEventListener("click", () => action("start", onStart));
    node(".stop").addEventListener("click", () => action("pause", onPause));
    node(".open").addEventListener("click", () => Promise.resolve().then(onOpen).catch(error => setMessage(error.message)));
    node(".hide").addEventListener("click", () => {
      minimized = !minimized;
      node(".body").hidden = minimized; node(".mini").hidden = !minimized;
      node(".hide").textContent = minimized ? "+" : "−";
      node(".hide").setAttribute("aria-label", minimized ? "Mở rộng" : "Thu gọn");
      node(".hide").setAttribute("aria-expanded", String(!minimized));
    });
    return Object.freeze({ render, setMessage });
  }
  root.GCAPanel = Object.freeze({ create });
})(globalThis);
