// === SINH TU DONG - dung: python tools/extract-eform-helpers.py ===
// Trich cac helper ma content/fill-legacy.js can, tu:
//   auto-fill-hcc-extension/content.js
//   auto-fill-hcc-extension/content/fill-angular.js
// KHONG sua tay file nay. Engine doi thi chay lai script de sinh lai.
(() => {
  "use strict";
  const H = (window.__HCC__ = window.__HCC__ || {});

  // --- ALT_NAME_GROUPS  (tu content/fill-angular.js) ---
  // ChaHoTen (ô gộp họ tên cha) và ChaHo+ChaChuDem+ChaTen (ô tách) là 2 cách biểu diễn THAY THẾ trên
  // các phiên bản form khác nhau. BE phát cả hai để chạy được mọi bản; nếu MỘT bên đã điền thì bên kia
  // (không tồn tại trên form này) KHÔNG tính là "không khớp" — gỡ khỏi notFound và cộng vào filled.
  const ALT_NAME_GROUPS = [
    { combined: "ChaHoTen", split: ["ChaHo", "ChaChuDem", "ChaTen"] },
  ];

  // --- resolveAltNameGroups  (tu content/fill-angular.js) ---
  function resolveAltNameGroups(result, fields) {
    const emitted = new Set((fields || []).map((f) => f.name));
    const errors = new Set(result.errors || []);
    for (const g of ALT_NAME_GROUPS) {
      const notFound = new Set(result.notFound || []);
      const isFilled = (n) => emitted.has(n) && !notFound.has(n) && !errors.has(n);
      const toClear = [];
      if (g.split.some(isFilled) && notFound.has(g.combined)) toClear.push(g.combined);
      if (isFilled(g.combined)) for (const s of g.split) if (notFound.has(s)) toClear.push(s);
      for (const n of toClear) {
        result.notFound = result.notFound.filter((x) => x !== n);
        result.filled++;
      }
    }
  }

  // --- sleep  (tu content.js) ---
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- norm  (tu content.js) ---
  const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

  // --- waitFor  (tu content.js) ---
  async function waitFor(fn, timeout = 3000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  // --- injectAutofillStyles  (tu content.js) ---
  // Bôi xanh/đỏ component đã điền/không điền được, để dễ nhận biết trên UI.
  function injectAutofillStyles() {
    if (document.getElementById("autofill-style")) return;
    const st = document.createElement("style");
    st.id = "autofill-style";
    st.textContent = `
      .autofill-filled {
        background-color: #e8f5e9 !important;
        outline: 2px solid #4caf50 !important;
        outline-offset: 1px !important;
        border-radius: 3px !important;
        transition: background-color 0.3s, outline 0.3s;
      }
      .autofill-not-filled {
        background-color: #ffebee !important;
        outline: 2px solid #e53935 !important;
        outline-offset: 1px !important;
        border-radius: 3px !important;
        transition: background-color 0.3s, outline 0.3s;
      }
      .autofill-default {
        background-color: #fff8e1 !important;
        outline: 2px solid #f9a825 !important;
        outline-offset: 1px !important;
        border-radius: 3px !important;
        transition: background-color 0.3s, outline 0.3s;
      }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  // --- clearAutofillMarks  (tu content.js) ---
  function clearAutofillMarks() {
    document.querySelectorAll(".autofill-filled, .autofill-not-filled, .autofill-default").forEach((el) => {
      el.classList.remove("autofill-filled");
      el.classList.remove("autofill-not-filled");
      el.classList.remove("autofill-default");
    });
  }

  // --- markFilled  (tu content.js) ---
  function markFilled(el) {
    if (el && el.classList) {
      el.classList.remove("autofill-not-filled");
      // Giữ viền vàng (giá trị mặc định) — không đè thành xanh.
      if (!el.classList.contains("autofill-default")) el.classList.add("autofill-filled");
    }
  }

  // --- _convertGreenToYellow  (tu content.js) ---
  // Tô VIỀN VÀNG cho các field có default=true (giá trị BE điền mặc định, không từ giấy tờ).
  // Chạy SAU markAngularMarks: đổi mọi mark XANH bên trong container của field sang VÀNG
  // (vì các hàm điền tô xanh ở element khác nhau, không cố định 1 chỗ).
  function _convertGreenToYellow(container) {
    if (!container) return;
    const targets = [];
    if (container.classList && container.classList.contains("autofill-filled")) targets.push(container);
    if (container.querySelectorAll) targets.push(...container.querySelectorAll(".autofill-filled"));
    targets.forEach((el) => {
      el.classList.remove("autofill-filled");
      el.classList.remove("autofill-not-filled");
      el.classList.add("autofill-default");
    });
  }

  // --- markUnfilled  (tu content.js) ---
  function markUnfilled(el) {
    if (el && el.classList && !el.classList.contains("autofill-filled")) {
      el.classList.add("autofill-not-filled");
    }
  }

  // --- isVisible  (tu content.js) ---
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    if ((rect.width > 0 || rect.height > 0) && el.getClientRects().length > 0) return true;
    return el.offsetParent !== null;
  }

  // --- ARROW_RE  (tu content.js) ---
  // Header dropdown thường có icon ▼/▲ ở cuối; lọc bỏ trước khi so.
  const ARROW_RE = /[▲▼▾▿]/g;

  // --- isPlaceholderText  (tu content.js) ---
  function isPlaceholderText(t) {
    const s = (t || "").replace(ARROW_RE, "").trim().toLowerCase();
    if (!s) return true;
    if (s.startsWith("chọn ") || s.startsWith("chon ")) return true;
    if (/^-+\s*chọn\s*-*$/.test(s)) return true;       // -- Chọn -- / Chọn / ---
    if (s.includes("vui lòng chọn")) return true;       // Vui lòng chọn dữ liệu
    return false;
  }

  // --- markAllEmptyFieldsRed  (tu content.js) ---
  // Quét toàn bộ component trong frame; ô nào còn rỗng/-- Chọn -- → mark đỏ.
  // Đã filled (xanh) thì markUnfilled bỏ qua (không đè).
  function markAllEmptyFieldsRed() {
    // x-input + x-input-number + x-date + x-date-text: kiểm tra giá trị input
    document.querySelectorAll("x-input, x-input-number").forEach((c) => {
      if (!isVisible(c)) return;
      const inp = c.querySelector("input");
      if (!inp || !inp.value || !inp.value.trim()) markUnfilled(inp?.parentElement || c);
    });
    document.querySelectorAll("x-date").forEach((c) => {
      if (!isVisible(c)) return;
      const day = c.querySelector('input[name$="-day"]');
      const month = c.querySelector('input[name$="-month"]');
      const year = c.querySelector('input[name$="-year"]');
      const filled = [day, month, year].every((x) => x && x.value && x.value.trim());
      if (!filled) markUnfilled((day || month || year)?.parentElement || c);
    });
    document.querySelectorAll("x-date-text").forEach((c) => {
      if (!isVisible(c)) return;
      const day = c.querySelector('input[id$="-day"]');
      const month = c.querySelector('input[id$="-month"]');
      const year = c.querySelector('input[id$="-year"]');
      const filled = [day, month, year].every((x) => x && x.value && x.value.trim());
      const target = (day || month || year)?.parentElement || c;
      if (!filled) {
        markUnfilled(target);
      } else {
        // Đã có đủ giá trị (điền ở pass sau / form tự điền) → gỡ vệt đỏ pass-1, tô xanh.
        c.classList.remove("autofill-not-filled");
        markFilled(target);
        markFilled(c);
      }
    });
    // x-radio: chưa có checkbox nào checked
    document.querySelectorAll("x-radio").forEach((c) => {
      if (!isVisible(c)) return;
      if (!c.querySelector('input[type="checkbox"]:checked')) markUnfilled(c);
    });
    // x-select / x-select-default: header hiển thị "-- Chọn --" hoặc "Vui lòng chọn..."
    const checkSelectHeader = (header) => {
      if (!header || !isVisible(header)) return;
      if (isPlaceholderText(header.textContent)) markUnfilled(header);
    };
    document.querySelectorAll("x-select").forEach((c) => {
      if (!isVisible(c)) return;
      checkSelectHeader(c.querySelector(".input-field-select"));
    });
    document.querySelectorAll("x-select-default").forEach((c) => {
      if (!isVisible(c)) return;
      checkSelectHeader(c.querySelector("div[tabindex]"));
    });
    // x-select-area: từng sub-widget + ô địa chỉ
    document.querySelectorAll("x-select-area").forEach((c) => {
      if (!isVisible(c)) return;
      c.querySelectorAll('[id^="custom-select-"]').forEach((w) => {
        checkSelectHeader(w.querySelector(".input-field-select"));
      });
      const addr = c.querySelector("input.input-field");
      if (addr && isVisible(addr.parentElement || addr) && (!addr.value || !addr.value.trim())) {
        markUnfilled(addr.parentElement || addr);
      }
    });
  }

  // --- dispatchInputEvent  (tu content.js) ---
  function dispatchInputEvent(el, type, init = {}) {
    const EventCtor = typeof InputEvent === "function" && type === "input" ? InputEvent : Event;
    try {
      el.dispatchEvent(new EventCtor(type, { bubbles: true, ...init }));
    } catch {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    }
  }

  // --- keyToKeyCode  (tu content.js) ---
  function keyToKeyCode(key) {
    switch (key) {
      case "Enter": return 13;
      case "Tab": return 9;
      case "Escape": return 27;
      case "Backspace": return 8;
      case "ArrowDown": return 40;
      case "ArrowUp": return 38;
      default:
        return typeof key === "string" && key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
    }
  }

  // --- dispatchKeyboardEvent  (tu content.js) ---
  function dispatchKeyboardEvent(el, type, key) {
    const keyCode = keyToKeyCode(key);
    try {
      const ev = new KeyboardEvent(type, { bubbles: true, cancelable: true, key });
      // KeyboardEvent constructor bỏ qua keyCode/which → ép qua getter. Nhiều lib (Choices.js,
      // jQuery-based) chốt phím Enter bằng event.keyCode === 13, thiếu nó thì nhánh Enter chết.
      if (keyCode) {
        Object.defineProperty(ev, "keyCode", { get: () => keyCode });
        Object.defineProperty(ev, "which", { get: () => keyCode });
      }
      el.dispatchEvent(ev);
    } catch {
      el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    }
  }

  // --- setNativeValue  (tu content.js) ---
  // Set value qua native setter để framework (React/web-component) nhận biết thay đổi.
  // Với input thường, có thể bật typing/commit để giống thao tác nhập tay hơn
  // (một số form mirror field ở keyup/blur thay vì chỉ input/change).
  function setNativeValue(el, value, options = {}) {
    const text = String(value ?? "");
    const key = text.slice(-1) || "Unidentified";
    if (options.typing && typeof el.focus === "function") el.focus();
    if (options.typing) {
      dispatchKeyboardEvent(el, "keydown", key);
      dispatchKeyboardEvent(el, "keypress", key);
      dispatchInputEvent(el, "beforeinput", { data: text, inputType: "insertReplacementText" });
    }
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, text);
    else el.value = text;
    dispatchInputEvent(el, "input", { data: text, inputType: "insertReplacementText" });
    if (options.typing) {
      dispatchKeyboardEvent(el, "keyup", key);
      el.dispatchEvent(new Event("compositionend", { bubbles: true }));
    }
    if (options.change !== false) el.dispatchEvent(new Event("change", { bubbles: true }));
    if (options.commit) el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // --- LEGACY_MIRROR_FIELDS  (tu content.js) ---
  const LEGACY_MIRROR_FIELDS = [
    ["SoDinhDanhC", "SoGiayToDinhDanhC"],
    ["SoDinhDanhC", "SoGiayToTuyThanC"],
    ["SoDinhDanhC", "NYC_SoGiayToTuyThan"],
    ["NYC_SoDinhDanh", "NYC_SoGiayToTuyThan"],
    ["NYC_SoDinhDanh", "SoGiayToDinhDanhC"],
    ["SoDinhDanhC1", "SoGiayToDinhDanhC1"],
    ["SoDinhDanhC1", "SoGiayToTuyThanC1"],
    ["SoDinhDanhCha", "SoGiayToDinhDanhCha"],
    ["SoDinhDanhMe", "SoGiayToDinhDanhMe"],
    ["SoDinhDanh_BenNam", "SoGiayToDinhDanh_BenNam"],
    ["SoDinhDanh_BenNu", "SoGiayToDinhDanh_BenNu"],
    ["SoDinhDanh", "SoGiayToDinhDanh"],
  ];

  // --- FIELD_NAME_ALIASES  (tu content.js) ---
  const FIELD_NAME_ALIASES = {
    LoaiDangKy: ["loaiDangKy"],
    loaiDangKy: ["LoaiDangKy"],
    SoGiayToDinhDanhC1: ["SoGiayToTuyThanC1", "SoDinhDanhC1"],
    SoGiayToTuyThanC1: ["SoGiayToDinhDanhC1", "SoDinhDanhC1"],
  };

  // --- fieldCandidates  (tu content.js) ---
  function fieldCandidates(f) {
    const names = [
      f.name,
      ...(Array.isArray(f.aliases) ? f.aliases : []),
      ...(FIELD_NAME_ALIASES[f.name] || []),
    ];
    return names.filter(Boolean).filter((n, i, arr) => arr.indexOf(n) === i);
  }

  // --- findFormControl  (tu content.js) ---
  function findFormControl(names) {
    for (const n of names) {
      const el = document.querySelector(`[formcontrolname="${CSS.escape(n)}"]`);
      if (el) return el;
    }
    const wanted = new Set(names.map((n) => String(n).toLowerCase()));
    return Array.from(document.querySelectorAll("[formcontrolname]")).find((node) =>
      wanted.has(String(node.getAttribute("formcontrolname") || "").toLowerCase())
    ) || null;
  }

  Object.assign(H, {
    ALT_NAME_GROUPS,
    resolveAltNameGroups,
    sleep,
    norm,
    waitFor,
    injectAutofillStyles,
    clearAutofillMarks,
    markFilled,
    _convertGreenToYellow,
    markUnfilled,
    isVisible,
    ARROW_RE,
    isPlaceholderText,
    markAllEmptyFieldsRed,
    dispatchInputEvent,
    keyToKeyCode,
    dispatchKeyboardEvent,
    setNativeValue,
    LEGACY_MIRROR_FIELDS,
    FIELD_NAME_ALIASES,
    fieldCandidates,
    findFormControl,
  });
})();
