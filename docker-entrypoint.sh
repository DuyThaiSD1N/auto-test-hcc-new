#!/bin/sh
set -e

# Render (va nhieu PaaS khac) tu cap cong qua bien PORT.
# Chay local khong co bien nay thi mac dinh 8000.
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT:-8000}" \
    --proxy-headers \
    --forwarded-allow-ips "*"
