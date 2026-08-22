"""Trich cac helper ma content/fill-legacy.js can, keo theo ca phu thuoc bac cau.

Chay lai moi khi extension doi engine:

    python tools/extract-eform-helpers.py frontend/public/eform/engine/helpers.js         ["duong/dan/toi/auto-fill-hcc-extension"]

Sau do copy lai content/fill-legacy.js vao frontend/public/eform/engine/.
"""

import json
import re
import sys
from pathlib import Path

DEFAULT_EXT = r"c:/Users/admin/Desktop/ProjectSekai/auto-fill-hcc-extension (3)"
EXT = Path(sys.argv[2] if len(sys.argv) > 2 else DEFAULT_EXT)

SEEDS = [
    "sleep", "norm", "setNativeValue", "isVisible", "waitFor", "fieldCandidates",
    "findFormControl", "markFilled", "markUnfilled", "clearAutofillMarks",
    "_convertGreenToYellow", "injectAutofillStyles", "markAllEmptyFieldsRed",
    "FIELD_NAME_ALIASES", "LEGACY_MIRROR_FIELDS", "resolveAltNameGroups",
]

JS_GLOBALS = {
    "if", "for", "while", "switch", "catch", "return", "typeof", "function", "await", "new",
    "Promise", "Array", "Object", "String", "Number", "Boolean", "Set", "Map", "WeakMap",
    "JSON", "Math", "parseInt", "parseFloat", "setTimeout", "clearTimeout", "setInterval",
    "clearInterval", "console", "document", "window", "Event", "InputEvent", "MouseEvent",
    "KeyboardEvent", "FocusEvent", "CustomEvent", "RegExp", "Error", "Date", "isNaN", "of",
    "in", "do", "else", "try", "requestAnimationFrame", "CSS", "Node", "Element", "HTMLElement",
    "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "getComputedStyle",
    "Intl", "Symbol", "Reflect", "Proxy", "encodeURIComponent", "decodeURIComponent",
    "const", "let", "var", "class", "throw", "delete", "void", "yield", "this", "super",
    "true", "false", "null", "undefined", "NaN", "Infinity", "MutationObserver", "location",
    "navigator", "fetch", "URL", "Blob", "FormData", "AbortController", "structuredClone",
}


def strip_code(src: str) -> str:
    """Thay chuoi/comment bang khoang trang de dem ngoac va tim ten cho chinh xac."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            j = src.find("\n", i)
            j = n if j == -1 else j
            out.append(" " * (j - i))
            i = j
        elif c == "/" and nxt == "*":
            j = src.find("*/", i + 2)
            j = n if j == -1 else j + 2
            out.append("".join(ch if ch == "\n" else " " for ch in src[i:j]))
            i = j
        elif c in "\"'`":
            quote = c
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == quote:
                    j += 1
                    break
                j += 1
            out.append("".join(ch if ch == "\n" else " " for ch in src[i:j]))
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out)


DECL = re.compile(
    r"^(?:async\s+)?(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)", re.M
)


def top_level_decls(src: str) -> dict:
    """Tra ve {ten: (dong_bat_dau, dong_ket_thuc, ma_nguon)} cho khai bao o cap ngoai cung."""
    masked = strip_code(src)
    lines = src.splitlines()
    masked_lines = masked.splitlines()
    decls = {}

    for idx, line in enumerate(masked_lines):
        m = DECL.match(line)
        if not m:
            continue
        name = m.group(1)
        depth = 0
        end = idx
        for j in range(idx, len(masked_lines)):
            depth += masked_lines[j].count("{") + masked_lines[j].count("(") + masked_lines[j].count("[")
            depth -= masked_lines[j].count("}") + masked_lines[j].count(")") + masked_lines[j].count("]")
            end = j
            if depth <= 0 and j >= idx:
                break
        # keo theo cac dong comment ngay phia tren
        start = idx
        while start > 0 and (lines[start - 1].lstrip().startswith("//") or lines[start - 1].lstrip().startswith("*") or lines[start - 1].lstrip().startswith("/*")):
            start -= 1
        decls[name] = (start, end, "\n".join(lines[start:end + 1]))
    return decls


def refs_in(code: str) -> set:
    return set(re.findall(r"(?<![.\w$])([A-Za-z_$][\w$]*)", strip_code(code)))


def main():
    sources = {
        "content.js": (EXT / "content.js").read_text(encoding="utf-8"),
        "content/fill-angular.js": (EXT / "content" / "fill-angular.js").read_text(encoding="utf-8"),
    }
    tables = {path: top_level_decls(src) for path, src in sources.items()}

    def lookup(name):
        for path, table in tables.items():
            if name in table:
                return path, table[name]
        return None, None

    needed, queue, missing = {}, list(SEEDS), []
    while queue:
        name = queue.pop(0)
        if name in needed:
            continue
        path, entry = lookup(name)
        if entry is None:
            if name not in JS_GLOBALS:
                missing.append(name)
            continue
        needed[name] = (path, entry)
        for ref in refs_in(entry[2]):
            if ref not in needed and ref not in JS_GLOBALS and ref != name:
                if lookup(ref)[1] is not None:
                    queue.append(ref)

    order = []
    for path in sources:
        for name, (p, entry) in needed.items():
            if p == path:
                order.append((entry[0], name, p, entry[2]))
    order.sort()

    print(json.dumps({
        "so_helper": len(needed),
        "seed": len(SEEDS),
        "keo_theo": sorted(set(needed) - set(SEEDS)),
        "khong_tim_thay": sorted(set(missing)),
    }, ensure_ascii=False, indent=2))

    out = Path(sys.argv[1])
    parts = [
        "// === SINH TU DONG - dung: python tools/extract-eform-helpers.py ===",
        "// Trich cac helper ma content/fill-legacy.js can, tu:",
        "//   auto-fill-hcc-extension/content.js",
        "//   auto-fill-hcc-extension/content/fill-angular.js",
        "// KHONG sua tay file nay. Engine doi thi chay lai script de sinh lai.",
        "(() => {",
        '  "use strict";',
        "  const H = (window.__HCC__ = window.__HCC__ || {});",
        "",
    ]
    for _, name, path, code in order:
        parts.append(f"  // --- {name}  (tu {path}) ---")
        parts.append("\n".join("  " + l if l.strip() else l for l in code.splitlines()))
        parts.append("")
    parts.append("  Object.assign(H, {")
    for _, name, _p, _c in order:
        parts.append(f"    {name},")
    parts.append("  });")
    parts.append("})();")
    out.write_text("\n".join(parts) + "\n", encoding="utf-8")
    print("\nDa ghi:", out, "-", len(out.read_text(encoding='utf-8').splitlines()), "dong")


main()
