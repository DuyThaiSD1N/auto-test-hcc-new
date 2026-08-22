"""Sinh frontend/public/eform/dia-ban.json tu du lieu dia danh chuan cua backend.

Nguon: auto-fill-hcc-backend/app/locations/data/vn_provinces_wards.json (34 tinh/thanh 2025).
Ket qua rut gon: { "<ten day du tinh>": ["<ten day du phuong/xa>", ...] } cho dropdown eForm.

    python tools/gen-diaban.py [duong/dan/vn_provinces_wards.json]
"""
import json
import sys
from pathlib import Path

DEFAULT_SRC = Path(
    r"C:/Users/admin/Documents/GitHub/auto-fill-hcc-v1_6/auto-fill-hcc-backend"
    r"/app/locations/data/vn_provinces_wards.json"
)
OUT = Path(__file__).resolve().parents[1] / "frontend" / "public" / "eform" / "dia-ban.json"


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.is_file():
        print(f"Khong tim thay nguon: {src}")
        return 1

    data = json.loads(src.read_text(encoding="utf-8"))
    provinces = data["provinces"] if isinstance(data, dict) else data

    out: dict[str, list[str]] = {}
    total_wards = 0
    for prov in provinces:
        # full_name = "Thanh pho Ha Noi" / "Tinh Lao Cai"; khop ca ten rut gon nho luat includes
        pname = prov.get("full_name") or prov.get("name")
        wards = [w.get("full_name") or w.get("name") for w in prov.get("wards", [])]
        wards = [w for w in wards if w]
        out[pname] = wards
        total_wards += len(wards)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Da ghi {OUT}")
    print(f"  {len(out)} tinh/thanh, {total_wards} phuong/xa, {OUT.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
