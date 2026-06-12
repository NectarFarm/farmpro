#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# FarmPro – Android APK builder
# Usage:  ./scripts/build-apk.sh [debug|release]
# ──────────────────────────────────────────────────────────────────────────────
set -e

MODE="${1:-debug}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "╔════════════════════════════════════════╗"
echo "║   FarmPro APK Builder — $MODE mode      "
echo "╚════════════════════════════════════════╝"
echo ""

# ── 1. Build static Next.js export ──────────────────────────────────────────
echo "▶ Step 1/3: Building Next.js static export…"
cd "$ROOT"
CAPACITOR_BUILD=1 pnpm build
echo "   ✔ Static export written to out/"

# ── 2. Capacitor sync ────────────────────────────────────────────────────────
echo "▶ Step 2/3: Syncing into Android project…"
npx cap sync android
echo "   ✔ Web assets copied to android/app/src/main/assets/public"

# ── 3. Gradle build ──────────────────────────────────────────────────────────
echo "▶ Step 3/3: Running Gradle (assemble${MODE^})…"
cd "$ROOT/android"

if [ "$MODE" = "release" ]; then
  ./gradlew assembleRelease
  APK_PATH="app/build/outputs/apk/release/app-release.apk"
else
  ./gradlew assembleDebug
  APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
fi

echo ""
echo "✅  APK built successfully!"
echo "   → $ROOT/android/$APK_PATH"
echo ""
echo "   Install on a connected device:"
echo "   adb install $ROOT/android/$APK_PATH"
echo ""
