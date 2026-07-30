#!/bin/sh
set -eu
cd /workspace
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/health || curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/api/status; then
  exit 0
fi
export PORT=8080
npm run start >>/tmp/app-startup.log 2>&1 &
# Wait briefly for bind
i=0
while [ "$i" -lt 30 ]; do
  if curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8080/health 2>/dev/null || curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8080/api/status 2>/dev/null; then
    exit 0
  fi
  i=$((i + 1))
  sleep 0.3
done
exit 0
