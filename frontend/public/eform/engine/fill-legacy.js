// Engine fill form LEGACY (web-component x-*). Tách từ content.js — dùng namespace window.__HCC__.
(() => {
  const H = window.__HCC__ || (window.__HCC__ = {});
  const { sleep, norm, setNativeValue, isVisible, waitFor, fieldCandidates, findFormControl, markFilled, markUnfilled, clearAutofillMarks, _convertGreenToYellow, injectAutofillStyles, markAllEmptyFieldsRed, FIELD_NAME_ALIASES, LEGACY_MIRROR_FIELDS } = H;

function findNamedElement(tag, names) {
  for (const n of names) {
    const el = document.querySelector(`${tag}[name="${CSS.escape(n)}"]`);
    if (el) return { el, usedName: n };
  }
  const wanted = new Set(names.map((n) => String(n).toLowerCase()));
  const el = Array.from(document.querySelectorAll(tag)).find((node) =>
    wanted.has(String(node.getAttribute("name") || "").toLowerCase())
  );
  return { el: el || null, usedName: el?.getAttribute("name") || names[0] };
}

function findLegacyInputByName(name) {
  const names = [name, ...(FIELD_NAME_ALIASES[name] || [])];
  const input = findNamedElement("input", names).el;
  const container = findNamedElement("x-input", names).el || findNamedElement("x-input-number", names).el;
  return input || (container && (findNamedElement("input", names).el || container.querySelector("input")));
}

function requestedFieldName(fields, name) {
  const field = fields.find((f) => fieldCandidates(f).includes(name));
  return field ? field.name : null;
}

function removeResultName(list, name) {
  return Array.isArray(list) ? list.filter((n) => n !== name) : list;
}

async function applyLegacyMirrorFields(fields, result, filledNames) {
  for (const [sourceName, targetName] of LEGACY_MIRROR_FIELDS) {
    const sourceInput = findLegacyInputByName(sourceName);
    const sourceValue = sourceInput?.value?.trim();
    if (!sourceValue) continue;

    const targetInput = findLegacyInputByName(targetName);
    if (targetInput) {
      if (targetInput.value !== sourceValue) {
        setNativeValue(targetInput, sourceValue, { typing: true, commit: true });
        await sleep(50);
      }
      markFilled(targetInput.parentElement || targetInput);
    }

    const requestedName = requestedFieldName(fields, targetName);
    if (!requestedName) continue;

    // Một số phiên bản form không render field "số giấy tờ" riêng; nó được derive
    // từ số định danh sau khi nhập tay. Khi source đã có giá trị thì coi field mirror
    // là đã được xử lý, tránh báo "Không khớp" giả.
    result.notFound = removeResultName(result.notFound, targetName);
    result.notFound = removeResultName(result.notFound, requestedName);
    result.errors = removeResultName(result.errors, targetName);
    result.errors = removeResultName(result.errors, requestedName);
    if (!filledNames.has(requestedName)) {
      result.filled++;
      filledNames.add(requestedName);
    }
  }
}

async function fillForm(fields) {
  injectAutofillStyles();
  clearAutofillMarks();
  const result = { filled: 0, notFound: [], errors: [] };
  const filledNames = new Set();

  for (const f of fields) {
    // Tên cần thử: name chính + các alias (form khác phiên bản có thể đổi tên field).
    const candidates = fieldCandidates(f);

    // "raw": input trần theo name (vd SoLuong nằm trong x-select-area, không có x-input bọc)
    if (f.comp === "raw") {
      const el = findNamedElement("input", candidates).el;
      if (el) {
        setNativeValue(el, f.value, { typing: true, commit: true });
        markFilled(el.parentElement || el);
        result.filled++;
        filledNames.add(f.name);
      }
      else { result.notFound.push(f.name); console.warn(`[AutoFill] Không tìm thấy input[name="${f.name}"]`); }
      continue;
    }
    // Tìm container theo name chính rồi tới alias; ghi nhận tên KHỚP để filler dùng đúng.
    const found = findNamedElement(f.comp, candidates);
    const container = found.el;
    const usedName = found.usedName;
    if (!container) {
      result.notFound.push(f.name);
      console.warn(`[AutoFill] Không tìm thấy ${f.comp}[name="${f.name}"] (kể cả alias)`);
      continue;
    }
    const ff = usedName === f.name ? f : { ...f, name: usedName };
    try {
      let ok = false;
      switch (f.comp) {
        case "x-input": ok = fillInput(container, ff); break;
        case "x-input-number": ok = fillInput(container, ff); break; // inner <input type="number">
        case "x-date": ok = fillDate(container, ff); break;
        case "x-date-text": ok = fillDateText(container, ff); break;
        case "x-radio":
          ok = fillRadio(container, ff);
          if (ok) await sleep(200); // chờ vùng phụ thuộc (vd địa danh) render
          break;
        case "x-select": ok = await fillSelect(container, ff); break;
        case "x-select-default": ok = await fillSelectDefault(container, ff); break;
        case "x-select-area": ok = await fillSelectArea(container, ff); break;
      }
      // Việc đánh dấu xanh giờ do từng filler tự làm cho element thực sự nhận giá trị,
      // tránh tô cả khối x-select-area khi chỉ có vài sub-widget được điền.
      if (ok) {
        result.filled++;
        filledNames.add(f.name);
      }
      else {
        result.notFound.push(f.name);
        markUnfilled(container);
        console.warn(`[AutoFill] Không điền được ${f.name}`);
      }
    } catch (e) {
      result.errors.push(f.name);
      console.warn(`[AutoFill] Lỗi điền ${f.name}:`, e);
    }
  }

  // Pass 2: form (web-component) đôi khi re-render Section II sau khi điền field khác →
  // xoá mất ô text/date đã điền (vd Họ tên / ngày sinh con). Chờ ổn định rồi điền LẠI ô nào bị trống.
  await sleep(400);
  await reapplyEmptyTextFields(fields);
  await applyLegacyMirrorFields(fields, result, filledNames);
  // Pass 3: x-date-text trong eform render ô con (day/month/year) TRỄ → thử lại có chờ.
  await retryLateDateTextFields(fields, result, filledNames);

  // Quét toàn bộ form: ô nào còn rỗng (chưa được fill) → mark đỏ.
  markAllEmptyFieldsRed();
  // Field mặc định (default=true) → đổi viền XANH sang VÀNG (chạy sau cùng để không bị đè).
  markLegacyDefaultsYellow(fields);
  H.resolveAltNameGroups(result, fields);
  console.log("[AutoFill] Kết quả:", result);
  return result;
}

function markLegacyDefaultsYellow(fields) {
  for (const f of fields || []) {
    if (!f || !f.default) continue;
    // "raw": input trần theo name → đổi vàng ở parent (đúng phần tử nhánh fill đã tô xanh).
    if (f.comp === "raw") {
      const el = findNamedElement("input", fieldCandidates(f)).el;
      if (el) _convertGreenToYellow(el.parentElement || el);
      continue;
    }
    const found = findNamedElement(f.comp, fieldCandidates(f));
    if (found.el) _convertGreenToYellow(found.el);
  }
}

async function reapplyEmptyTextFields(fields) {
  const SIMPLE = ["x-input", "x-input-number", "x-date", "x-date-text", "raw"];
  for (const f of fields) {
    if (!SIMPLE.includes(f.comp)) continue;
    const names = fieldCandidates(f);

    if (f.comp === "raw") {
      const el = findNamedElement("input", names).el;
      if (el && (!el.value || !el.value.trim())) setNativeValue(el, f.value);
      continue;
    }
    const found = findNamedElement(f.comp, names);
    const container = found.el;
    const usedName = found.usedName;
    if (!container) continue;
    const inp = container.querySelector("input");
    if (inp && inp.value && inp.value.trim()) continue; // còn giá trị → bỏ qua
    const ff = usedName === f.name ? f : { ...f, name: usedName };
    if (f.comp === "x-date") fillDate(container, ff);
    else if (f.comp === "x-date-text") fillDateText(container, ff);
    else fillInput(container, ff);
  }
}

async function retryLateDateTextFields(fields, result, filledNames) {
  const targets = fields.filter(
    (f) => f.comp === "x-date-text" && f.value && !filledNames.has(f.name)
  );
  if (!targets.length) return;

  const pending = () => targets.some((f) => !filledNames.has(f.name));
  for (let round = 0; round < 8 && pending(); round++) {
    for (const f of targets) {
      if (filledNames.has(f.name)) continue;
      const found = findNamedElement(f.comp, fieldCandidates(f));
      const c = found.el;
      if (!c) continue;

      const year = c.querySelector('input[id$="-year"]');
      if (year && year.value && year.value.trim()) {
        // Đã có giá trị (ta/form điền) → coi như xong.
        markFilled(c.querySelector('input[id$="-day"]')?.parentElement || c);
        markFilled(c);
      } else if (c.querySelector('input[id$="-day"]')) {
        const ff = found.usedName === f.name ? f : { ...f, name: found.usedName };
        if (!fillDateText(c, ff)) continue;
        markFilled(c);
      } else {
        continue; // ô con chưa render → chờ vòng sau
      }
      result.notFound = removeResultName(result.notFound, f.name);
      result.filled++;
      filledNames.add(f.name);
    }
    if (pending()) await sleep(500);
  }
}

function fillInput(container, f) {
  const escaped = CSS.escape(f.name);
  const containers = Array.from(document.querySelectorAll(`x-input[name="${escaped}"], x-input-number[name="${escaped}"]`));
  const targets = containers.length ? containers : [container];
  let any = false;
  for (const target of targets) {
    const el = target.querySelector(`input[name="${escaped}"]`) || target.querySelector("input");
    if (!el) continue;
    setNativeValue(el, f.value, { typing: true, commit: true });
    markFilled(el.parentElement || el);
    any = true;
  }
  return any;
}

function fillDate(container, f) {
  const [dd, mm, yyyy] = f.value.split("/");
  if (!dd || !mm || !yyyy) return false;
  const day = container.querySelector(`input[name="${f.name}-day"]`);
  const month = container.querySelector(`input[name="${f.name}-month"]`);
  const year = container.querySelector(`input[name="${f.name}-year"]`);
  const dateInput = container.querySelector(`input[name="${f.name}-name-date-input"]`);
  let any = false;
  if (day) { setNativeValue(day, dd); any = true; }
  if (month) { setNativeValue(month, mm); any = true; }
  if (year) { setNativeValue(year, yyyy); any = true; }
  if (dateInput) { setNativeValue(dateInput, `${yyyy}-${mm}-${dd}`); any = true; }
  if (any) markFilled((day || month || year)?.parentElement || container);
  return any;
}

function fillDateText(container, f) {
  const day = container.querySelector('input[id$="-day"]');
  const month = container.querySelector('input[id$="-month"]');
  const year = container.querySelector('input[id$="-year"]');
  const raw = String(f.value || "").trim();
  let dd = "", mm = "", yyyy = "";

  const full = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const yearOnly = raw.match(/^\d{4}$/);
  if (full) {
    dd = full[1].padStart(2, "0");
    mm = full[2].padStart(2, "0");
    yyyy = full[3];
  } else if (yearOnly) {
    yyyy = raw;
  } else {
    return false;
  }

  let any = false;
  if (day && dd) { setNativeValue(day, dd, { typing: true, commit: true }); any = true; }
  if (month && mm) { setNativeValue(month, mm, { typing: true, commit: true }); any = true; }
  if (year && yyyy) { setNativeValue(year, yyyy, { typing: true, commit: true }); any = true; }
  if (any) markFilled((day || month || year)?.parentElement || container);
  return any;
}

function fillRadio(container, f) {
  const boxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
  if (!boxes.length) return false;
  const wanted = norm(String(f.value));
  const target = boxes.find((b) => {
    if (b.id.toLowerCase().endsWith("-" + String(f.value).toLowerCase())) return true;
    const label = container.querySelector(`label[for="${CSS.escape(b.id)}"]`);
    return label && norm(label.textContent) === wanted;
  });
  if (!target) return false;
  boxes.forEach((b) => {
    if (b !== target && b.checked) {
      b.checked = false;
      b.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  if (!target.checked) target.click();
  target.checked = true;
  target.dispatchEvent(new Event("change", { bubbles: true }));
  const lbl = container.querySelector(`label[for="${CSS.escape(target.id)}"]`);
  markFilled(lbl || target);
  return true;
}

const isPlaceholderOpt = (t) =>
  !t || t.includes("không tìm thấy") || t === "-- chọn --" || t === "-- chon --";

async function pickInWidget(root, value) {
  const header = root.querySelector(".input-field-select");
  if (!header) return false;
  header.click();
  const want = norm(value);
  const getOpts = () => {
    const box = root.querySelector(".input-field-select-options");
    return box ? Array.from(box.querySelectorAll("div")) : [];
  };
  const match = () => {
    const opts = getOpts().filter((o) => !isPlaceholderOpt(norm(o.textContent)));
    return opts.find((o) => norm(o.textContent) === want) ||
           opts.find((o) => norm(o.textContent).includes(want));
  };

  // Chờ option thật xuất hiện (list có thể load AJAX sau khi mở)
  await waitFor(() => getOpts().some((o) => !isPlaceholderOpt(norm(o.textContent))), 3000);

  // 1) Thử khớp trên danh sách ĐẦY ĐỦ (không gõ search) — quan trọng cho Quốc gia,
  //    vì bộ lọc của dropdown có thể khắt khe dấu/hoa-thường và lọc sạch hết.
  let target = match();

  // 2) Nếu chưa thấy và có ô tìm kiếm: lọc rồi khớp; nếu lọc ra rỗng thì xóa search, quét lại.
  if (!target) {
    const search = root.querySelector('input[placeholder="Tìm kiếm..."]');
    if (search) {
      setNativeValue(search, value);
      await waitFor(() => match() ||
        getOpts().some((o) => norm(o.textContent).includes("không tìm thấy")), 2000);
      target = match();
      if (!target) { setNativeValue(search, ""); await sleep(400); target = match(); }
    } else {
      await waitFor(() => match(), 1500);
      target = match();
    }
  }

  if (!target) {
    console.warn(`[AutoFill] pickInWidget: không khớp "${value}". Option hiện có:`,
      getOpts().map((o) => o.textContent.trim()).filter(Boolean).slice(0, 20));
    header.click();
    markUnfilled(root.querySelector(".input-field-select") || root);
    return false;
  }
  target.click();
  await sleep(150);
  markFilled(root.querySelector(".input-field-select") || root);
  return true;
}

async function fillSelect(container, f) {
  const cs = container.querySelector('[id^="custom-select-"]');
  if (!cs) return false;
  return pickInWidget(cs, f.value);
}

function normalizeAreaValue(v) {
  if (!v) return {};
  if (!Array.isArray(v.selects)) return v;
  const out = { diaChi: v.diaChi };
  for (const s of v.selects) {
    const n = norm(s);
    if (!n) continue;
    if (n === "việt nam" || n.includes("quốc gia") || n.includes("country")) out.quocGia = s;
    else if (n.includes("tỉnh") || n.includes("thành phố") || /\btp\b/.test(n)) out.tinh = s;
    else if (n.includes("xã") || n.includes("phường") || n.includes("thị trấn")) out.xa = s;
  }
  return out;
}

function areaRoleOf(widget) {
  const ctx = norm(widget.parentElement ? widget.parentElement.textContent : "");
  if (ctx.includes("tỉnh") || ctx.includes("thành phố")) return "tinh";
  if (ctx.includes("xã") || ctx.includes("phường")) return "xa";
  return "quocGia";
}

function hasDivorceDecisionAreaValue(data) {
  return !!(
    data &&
    (
      data.soBanAnQuyetDinhLyHon ||
      data.ngayCapBanAnQuyetDinhLyHon ||
      data.coQuanCapBanAnQuyetDinhLyHon ||
      data.voChongHoTen  // area "đang có vợ/chồng" (=2): thêm tên vợ/chồng
    )
  );
}

function selectAreaTextControls(container) {
  const controls = [];
  for (const node of container.querySelectorAll("x-input, x-input-number, textarea, input")) {
    const tag = node.tagName.toLowerCase();
    if (tag === "input") {
      const type = String(node.getAttribute("type") || "").toLowerCase();
      const name = String(node.getAttribute("name") || "");
      if (type === "hidden" || type === "file" || type === "checkbox" || type === "radio") continue;
      if (node.closest("x-input, x-input-number, x-date")) continue;
      if (/-day$|-month$|-year$|-name-date-input$/.test(name)) continue;
    }
    controls.push(node);
  }
  return controls;
}

function setGenericTextControl(control, value) {
  if (!control || value == null || value === "") return false;
  const input = control.matches?.("textarea,input")
    ? control
    : control.querySelector("input, textarea");
  if (!input) return false;
  setNativeValue(input, value, { typing: true, commit: true });
  markFilled(input.parentElement || input);
  return true;
}

function selectAreaDateControls(container) {
  const controls = Array.from(container.querySelectorAll("x-date"));
  if (controls.length) return controls;
  const dateInputs = Array.from(container.querySelectorAll('input[type="date"], input[id$="-day"], input[name$="-day"]'))
    .filter((node) => !node.closest("x-input, x-input-number"));
  return dateInputs.map((node) => node.closest("div") || node.parentElement || node);
}

function setGenericDateControl(control, value) {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!control || !m) return false;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3];
  const day = control.querySelector?.('input[id$="-day"], input[name$="-day"]');
  const month = control.querySelector?.('input[id$="-month"], input[name$="-month"]');
  const year = control.querySelector?.('input[id$="-year"], input[name$="-year"]');
  const dateInput = control.querySelector?.('input[type="date"], input[id$="-id-date-input"], input[name$="-name-date-input"]');
  let any = false;
  if (day) { setNativeValue(day, dd, { typing: true, commit: true }); any = true; }
  if (month) { setNativeValue(month, mm, { typing: true, commit: true }); any = true; }
  if (year) { setNativeValue(year, yyyy, { typing: true, commit: true }); any = true; }
  if (dateInput) { setNativeValue(dateInput, `${yyyy}-${mm}-${dd}`, { typing: true, commit: true }); any = true; }
  if (any) markFilled((day || month || year || dateInput)?.parentElement || control);
  return any;
}

function isPlainSelectAreaValue(value) {
  if (value == null) return false;
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim() !== "";
  }
  return false;
}

function selectAreaPlainTextInput(container, name) {
  const directNames = [name, `Nhap${name}`].filter(Boolean);
  for (const n of directNames) {
    const input = container.querySelector(`input[name="${CSS.escape(n)}"]`);
    if (input) return input;
  }
  return (
    container.querySelector('input[name^="Nhap"]') ||
    container.querySelector('input[placeholder*="Nhập"]') ||
    container.querySelector("input.input-field")
  );
}

function fillPlainTextSelectArea(container, f) {
  const text = String(f.value ?? "").trim();
  if (!text) return false;
  const input = selectAreaPlainTextInput(container, f.name);
  if (!input) return false;
  setNativeValue(input, text, { typing: true, commit: true });
  const display = input.parentElement?.querySelector(".hidden");
  if (display) display.textContent = text;
  markFilled(input.parentElement || input);
  return true;
}

function fillDivorceDecisionAreaByKnownNames(container, data) {
  let any = false;
  // Area "đang có vợ/chồng" (=2) có thêm ô tên vợ/chồng; area ly hôn/góa (=3/=4) không có ô này.
  const spouseInput = container.querySelector('input[name="voChongHoTen"]');
  if (spouseInput && data.voChongHoTen) {
    setNativeValue(spouseInput, data.voChongHoTen, { typing: true, commit: true });
    markFilled(spouseInput.parentElement || spouseInput);
    any = true;
  }
  const numberInput = container.querySelector('input[name="soGiayTo"]');
  if (numberInput && data.soBanAnQuyetDinhLyHon) {
    setNativeValue(numberInput, data.soBanAnQuyetDinhLyHon, { typing: true, commit: true });
    markFilled(numberInput.parentElement || numberInput);
    any = true;
  }

  const dateValue = String(data.ngayCapBanAnQuyetDinhLyHon || "").trim();
  const dateMatch = dateValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dateMatch) {
    const dd = dateMatch[1].padStart(2, "0");
    const mm = dateMatch[2].padStart(2, "0");
    const yyyy = dateMatch[3];
    const day = container.querySelector('input[name="ngayCapGiayTo-day"]');
    const month = container.querySelector('input[name="ngayCapGiayTo-month"]');
    const year = container.querySelector('input[name="ngayCapGiayTo-year"]');
    const dateInput = container.querySelector('input[name="ngayCapGiayTo-name-date-input"]');
    if (day) { setNativeValue(day, dd, { typing: true, commit: true }); any = true; }
    if (month) { setNativeValue(month, mm, { typing: true, commit: true }); any = true; }
    if (year) { setNativeValue(year, yyyy, { typing: true, commit: true }); any = true; }
    if (dateInput) { setNativeValue(dateInput, `${yyyy}-${mm}-${dd}`, { typing: true, commit: true }); any = true; }
    if (day || month || year || dateInput) markFilled((day || month || year || dateInput).parentElement || container);
  }

  const agencyInput = container.querySelector('input[name="coQuanCapGiayTo"]');
  if (agencyInput && data.coQuanCapBanAnQuyetDinhLyHon) {
    setNativeValue(agencyInput, data.coQuanCapBanAnQuyetDinhLyHon, { typing: true, commit: true });
    markFilled(agencyInput.parentElement || agencyInput);
    any = true;
  }
  return any;
}

async function fillDivorceDecisionArea(container, data) {
  await waitFor(() => container.querySelector("x-input, x-date, input, textarea"), 3500);
  const byName = fillDivorceDecisionAreaByKnownNames(container, data);
  if (byName) return true;

  const textControls = selectAreaTextControls(container);
  const dateControls = selectAreaDateControls(container);
  let any = false;

  // Form động của tình trạng hôn nhân render 3 control theo thứ tự:
  // Số Bản án/Quyết định ly hôn -> Ngày cấp -> Cơ quan cấp.
  if (data.soBanAnQuyetDinhLyHon) {
    any = setGenericTextControl(textControls[0], data.soBanAnQuyetDinhLyHon) || any;
  }
  if (data.ngayCapBanAnQuyetDinhLyHon) {
    any = setGenericDateControl(dateControls[0], data.ngayCapBanAnQuyetDinhLyHon) || any;
  }
  if (data.coQuanCapBanAnQuyetDinhLyHon) {
    any = setGenericTextControl(textControls[1], data.coQuanCapBanAnQuyetDinhLyHon) || any;
  }
  return any;
}

async function fillSelectArea(container, f) {
  if (isPlainSelectAreaValue(f.value)) {
    await waitFor(() => selectAreaPlainTextInput(container, f.name), 1500);
    return fillPlainTextSelectArea(container, f);
  }

  const data = normalizeAreaValue(f.value);
  if (hasDivorceDecisionAreaValue(data)) {
    return fillDivorceDecisionArea(container, data);
  }
  // Area thường được hiện ra sau khi tick radio "Trong nước" ngay trước đó →
  // sub-widget có thể chưa kịp render. Chờ tối đa 1.5s.
  await waitFor(() => container.querySelector('[id^="custom-select-"]'), 1500);
  const widgets = Array.from(container.querySelectorAll('[id^="custom-select-"]'));
  const byRole = {};
  for (const w of widgets) {
    const r = areaRoleOf(w);
    if (r && !byRole[r]) byRole[r] = w;
  }
  let any = false;
  for (const role of ["quocGia", "tinh", "xa"]) {
    const w = byRole[role];
    const val = data[role];
    if (!w || !val) continue;
    const ok = await pickInWidget(w, val);
    if (ok) { any = true; await sleep(700); } // chờ tầng dưới load qua AJAX
  }
  if (data.diaChi) {
    const addr = container.querySelector("input.input-field");
    if (addr) { setNativeValue(addr, data.diaChi); markFilled(addr.parentElement || addr); any = true; }
  }
  return any;
}

async function fillSelectDefault(container, f) {
  const cs = container.querySelector('[id^="custom-select-default-"]');
  if (!cs) return false;
  const header = cs.querySelector("div[tabindex]");
  if (!header) return false;
  header.click();
  await sleep(350);
  const want = norm(f.value);
  const cands = Array.from(cs.querySelectorAll("div, li")).filter(
    (d) => d !== header && d.childElementCount <= 1 && norm(d.textContent)
  );
  let target = cands.find((d) => norm(d.textContent) === want);
  if (!target) target = cands.find((d) => norm(d.textContent).includes(want));
  if (!target) {
    header.click();
    markUnfilled(header);
    return false;
  }
  target.click();
  await sleep(150);
  markFilled(header);
  return true;
}

  H.fillForm = fillForm;
})();
