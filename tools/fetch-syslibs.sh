#!/usr/bin/env bash
# Fetch + extract the shared libraries headless Chromium needs, without root.
# Extracts into .syslibs/root and leaves LD_LIBRARY_PATH usage to run.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/.syslibs"
MIRROR="${MIRROR:-http://deb.debian.org/debian}"
SUITE="${SUITE:-bookworm}"
ARCH=amd64
mkdir -p "$WORK/debs" "$WORK/root"

IDX="$WORK/Packages.txt"
if [ ! -s "$IDX" ]; then
  echo "== fetching package index"
  curl -sf "$MIRROR/dists/$SUITE/main/binary-$ARCH/Packages.gz" | gunzip > "$IDX"
fi

# resolve package -> Filename by walking Requires/Depends closure
declare -A SEEN FILES
resolve() {
  local pkg="$1"
  [ -n "${SEEN[$pkg]:-}" ] && return 0
  SEEN[$pkg]=1
  local entry
  entry=$(awk -v P="$pkg" '
    $0=="Package: "P {f=1}
    f && /^Filename:/ {print FILENAME_LINE=$2; exit}
    f && /^$/ {exit}
  ' "$IDX")
  [ -z "$entry" ] && { echo "  !! not found: $pkg" >&2; return 0; }
  FILES[$pkg]="$entry"
  # deps: Depends: + Pre-Depends:, strip versions/alternatives
  local deps
  deps=$(awk -v P="$pkg" '
    $0=="Package: "P {f=1}
    f && /^(Depends|Pre-Depends):/ {print substr($0, index($0,":")+2)}
    f && /^$/ {exit}
  ' "$IDX" | tr ',' '\n' | sed 's/([^)]*)//g; s/|/\n/g; s/^ *//; s/ *$//' | grep -v '^$' || true)
  for d in $deps; do resolve "$d"; done
}

for p in "$@"; do resolve "$p"; done

echo "== resolved ${#FILES[@]} packages"
for pkg in "${!FILES[@]}"; do
  f=$(basename "${FILES[$pkg]}")
  if [ -s "$WORK/debs/$f" ]; then echo "  have $f"; continue; fi
  echo "  get  $f"
  curl -sf "$MIRROR/${FILES[$pkg]}" -o "$WORK/debs/$f" || echo "  !! download failed $f" >&2
done

echo "== extracting"
for d in "$WORK"/debs/*.deb; do
  [ -s "$d" ] || continue
  dpkg-deb -x "$d" "$WORK/root" 2>/dev/null || {
    # fall back to ar+tar if dpkg-deb unavailable
    tmp=$(mktemp -d); (cd "$tmp" && ar x "$d" && tar xf data.tar.* -C "$WORK/root")
    rm -rf "$tmp"
  }
done
echo "== done. libs under $WORK/root"
find "$WORK/root" -name '*.so*' | wc -l
