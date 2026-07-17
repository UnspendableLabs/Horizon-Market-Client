#!/usr/bin/env bash
#
# deploy-testflight.sh — build the iOS app on EAS Build and ship it to TestFlight.
#
# Runs from apps/native (where eas.json lives) no matter where you call it from.
# The signing credentials (distribution certificate, provisioning profile) and the
# App Store Connect API key live on EAS servers, and export compliance is answered
# in the Info.plist (ITSAppUsesNonExemptEncryption), so re-runs are unattended:
# no Apple login, no 2FA, no per-build prompts.
#
# Build numbers auto-increment on EAS (appVersionSource: remote), so nothing to bump.
#
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  cat <<'EOF'
deploy-testflight.sh — build the iOS app on EAS and ship it to TestFlight.

Usage:
  ./deploy-testflight.sh                     Build (production) + submit to TestFlight
  ./deploy-testflight.sh --no-submit         Build only, skip the TestFlight upload
  ./deploy-testflight.sh --profile preview   Build an internal ad-hoc IPA (no submit)
  ./deploy-testflight.sh -m "message"        Attach a message to the build
  ./deploy-testflight.sh -y                  Skip the confirmation prompt
  ./deploy-testflight.sh --clear-cache       Rebuild with EAS's build cache cleared (fresh pod install)
  ./deploy-testflight.sh --ci                Fully non-interactive (fails instead of prompting)

Note on --clear-cache:
  Use it when a build that runs fine locally crashes on TestFlight — a stale EAS
  CocoaPods cache can leave a dynamic framework (e.g. RNWorklets.framework) linked
  but NOT embedded in the IPA, so dyld fails at launch. Clearing the cache forces a
  clean pod install, matching a local `expo prebuild --clean` build.
EOF
}

PROFILE="production"
SUBMIT=1
ASSUME_YES=0
NON_INTERACTIVE=0
CLEAR_CACHE=0
MESSAGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)    PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    --no-submit)  SUBMIT=0; shift ;;
    -m|--message) MESSAGE="${2:?--message needs a value}"; shift 2 ;;
    -y|--yes)     ASSUME_YES=1; shift ;;
    --clear-cache) CLEAR_CACHE=1; shift ;;
    --ci)         NON_INTERACTIVE=1; ASSUME_YES=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 1 ;;
  esac
done

# TestFlight only accepts store builds; the preview profile is internal ad-hoc.
if [[ "$PROFILE" != "production" && $SUBMIT -eq 1 ]]; then
  echo "ℹ️  '$PROFILE' is not a store profile — building only (no TestFlight submit)."
  SUBMIT=0
fi

# --- Preflight ---------------------------------------------------------------
command -v eas  >/dev/null 2>&1 || { echo "❌ EAS CLI not found. Install:  npm install -g eas-cli" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "❌ node not found." >&2; exit 1; }
eas whoami      >/dev/null 2>&1 || { echo "❌ Not logged in to Expo. Run:  eas login" >&2; exit 1; }

echo "👤 Expo:    $(eas whoami)"
echo "📦 Profile: $PROFILE"
echo "🚀 Submit:  $([[ $SUBMIT -eq 1 ]] && echo 'TestFlight' || echo 'no (build only)')"
echo "🧹 Cache:   $([[ $CLEAR_CACHE -eq 1 ]] && echo 'cleared (fresh pod install)' || echo 'reused')"

if [[ $ASSUME_YES -ne 1 ]]; then
  read -r -p "Start iOS cloud build? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

# --- Build (+ auto-submit) ---------------------------------------------------
args=(build --platform ios --profile "$PROFILE")
[[ $NON_INTERACTIVE -eq 1 ]] && args+=(--non-interactive)
[[ $CLEAR_CACHE -eq 1 ]]     && args+=(--clear-cache)
[[ -n "$MESSAGE" ]]          && args+=(--message "$MESSAGE")
[[ $SUBMIT -eq 1 ]]          && args+=(--auto-submit)

echo "▶  eas ${args[*]}"
eas "${args[@]}"

echo ""
echo "✅ Done."
if [[ $SUBMIT -eq 1 ]]; then
  app_id="$(node -p "require('./eas.json').submit.production.ios.ascAppId" 2>/dev/null || true)"
  [[ -n "${app_id:-}" ]] && echo "   TestFlight → https://appstoreconnect.apple.com/apps/${app_id}/testflight/ios"
  echo "   Apple processes the build in ~5-10 min, then testers are notified."
fi
