#!/usr/bin/env bash
# Builds the native shell and launches it on a simulator, so both devices can be opened side by
# side without the dev server Capacitor's own runner expects.
#
#   ./scripts/run-sim.sh ipad    # iPad mini
#   ./scripts/run-sim.sh iphone  # iPhone 17 Pro
#
# Rebuilds apps/web/dist first; pass --no-build to reuse the current web assets.
set -euo pipefail

device="${1:-ipad}"
case "$device" in
  ipad) udid="F0D45DA3-2941-4879-92A2-DE7B92013322" ;;
  iphone) udid="2EBD93FB-803A-43F9-9EDE-754350323B0A" ;;
  *) echo "usage: $0 [ipad|iphone] [--no-build]" >&2; exit 2 ;;
esac
if [ "${2:-}" != "--no-build" ]; then
  (cd "$(dirname "$0")/../.." && bun run build:web >/dev/null)
fi

here="$(cd "$(dirname "$0")/.." && pwd)"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
simctl() { DEVELOPER_DIR="$DEVELOPER_DIR" /usr/bin/xcrun simctl "$@"; }

cd "$here"
bun run sync >/dev/null
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination "platform=iOS Simulator,id=$udid" \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build >/dev/null

simctl boot "$udid" 2>/dev/null || true
simctl bootstatus "$udid" -b >/dev/null
simctl install "$udid" build/Build/Products/Debug-iphonesimulator/App.app
simctl launch "$udid" studio.aibook.app
echo "Launched on $device ($udid)."
