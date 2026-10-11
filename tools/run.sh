#!/usr/bin/env bash
# run.sh — run a tools/ script with the extracted Chromium libraries on the path.
#
# Headless Chromium needs ~30 shared libraries (glib, nss, ...) that are not
# present in a slim container and cannot be apt-installed without root.
# tools/fetch-syslibs.sh extracts them into .syslibs/root; this wrapper points
# the loader at them so `node tools/replay.mjs` just works.
#
#   ./tools/run.sh replay.mjs --record
#   ./tools/run.sh replay.mjs
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SYS="$ROOT/.syslibs/root"

if [ ! -d "$SYS" ]; then
  echo "run.sh: .syslibs/root missing — fetching Chromium libraries (no root needed)"
  "$ROOT/tools/fetch-syslibs.sh" \
    libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0
fi

export LD_LIBRARY_PATH="$SYS/usr/lib/x86_64-linux-gnu:$SYS/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$ROOT/.browsers}"

if [ ! -d "$PLAYWRIGHT_BROWSERS_PATH" ]; then
  echo "run.sh: no browser at $PLAYWRIGHT_BROWSERS_PATH"
  echo "  install with: PLAYWRIGHT_BROWSERS_PATH=$ROOT/.browsers npx playwright install chromium"
  exit 2
fi

cd "$ROOT/tools"
exec node "$@"
