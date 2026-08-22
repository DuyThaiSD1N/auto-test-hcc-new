"""Tao / cap nhat tai khoan dang nhap cua Auto Test HCC trong MongoDB.

Ung dung khong co dang ky tu do, tai khoan tao bang script nay.

    python tools/seed_user.py --username canbo1 --password 'MatKhau123' --name 'Nguyen Van A'
    python tools/seed_user.py --username sep --password 'MatKhau123' --name 'Quan tri' --role admin
    python tools/seed_user.py --list
    python tools/seed_user.py --delete canbo1

Ten dang nhap khong phan biet hoa thuong. Chay lai voi cung --username la DOI MAT KHAU.
Script doc cau hinh Mongo tu backend/.env (APP_MONGO_URI, APP_MONGO_DB).
"""

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Console Windows mac dinh cp1252 -> in ten tieng Viet se vo. Ep UTF-8 ngay tu dau.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"

# Settings doc file .env theo thu muc lam viec -> chuyen vao backend/ truoc khi import
os.chdir(BACKEND_DIR)
sys.path.insert(0, str(BACKEND_DIR))

from app.config import get_settings  # noqa: E402
from app.security import hash_password  # noqa: E402

ROLES = ("admin", "tester")


def main() -> int:
    parser = argparse.ArgumentParser(description="Quan ly tai khoan Auto Test HCC")
    parser.add_argument("--username", help="Ten dang nhap")
    parser.add_argument("--password", help="Mat khau")
    parser.add_argument("--name", help="Ho ten hien thi")
    parser.add_argument("--role", default="tester", choices=ROLES, help="Quyen (mac dinh tester)")
    parser.add_argument("--list", action="store_true", help="Liet ke tai khoan dang co")
    parser.add_argument("--delete", metavar="USERNAME", help="Xoa mot tai khoan")
    args = parser.parse_args()

    settings = get_settings()
    if not settings.mongo_enabled:
        print("Chua dat APP_MONGO_URI trong backend/.env - khong co CSDL de luu tai khoan.")
        return 1

    try:
        from pymongo import MongoClient
    except ImportError:
        print("Thieu pymongo. Chay: backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt")
        return 1

    client = MongoClient(settings.mongo_uri, serverSelectionTimeoutMS=settings.mongo_timeout_ms)
    users = client[settings.mongo_db].users
    users.create_index("username", unique=True)

    if args.list:
        rows = list(users.find({}, {"username": 1, "full_name": 1, "role": 1, "updated_at": 1}))
        if not rows:
            print("Chua co tai khoan nao trong CSDL.")
            print(f"Tai khoan mac dinh tu bien moi truong van dung duoc: {settings.default_username}")
            return 0
        print(f"{len(rows)} tai khoan:")
        for row in rows:
            print(f"  {row['username']:20} {row.get('role', ''):8} {row.get('full_name') or ''}")
        return 0

    if args.delete:
        result = users.delete_one({"username": args.delete.strip().lower()})
        print("Da xoa." if result.deleted_count else "Khong tim thay tai khoan do.")
        return 0 if result.deleted_count else 1

    if not args.username or not args.password:
        parser.error("Can --username va --password (hoac dung --list / --delete)")

    username = args.username.strip().lower()
    if len(args.password) < 6:
        print("Mat khau nen dai it nhat 6 ky tu.")
        return 1

    now = datetime.now(tz=timezone.utc)
    result = users.update_one(
        {"username": username},
        {
            "$set": {
                "full_name": args.name or username,
                "role": args.role,
                "password_hash": hash_password(args.password),
                "updated_at": now,
            },
            "$setOnInsert": {"username": username, "created_at": now},
        },
        upsert=True,
    )
    action = "Tao moi" if result.upserted_id else "Cap nhat"
    print(f"{action} tai khoan: {username} (role={args.role})")
    print(f"CSDL: {settings.mongo_db} tai {settings.mongo_uri}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
