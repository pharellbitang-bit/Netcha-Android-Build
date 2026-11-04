#!/usr/bin/env bash
set -Eeuo pipefail

mkdir -p build/reports
adb wait-for-device
adb logcat -c || true

# The emulator action has already waited for boot; verify PackageManager before Gradle.
ready=0
for attempt in $(seq 1 30); do
  boot="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  package_service="$(adb shell service check package 2>&1 || true)"
  if [[ "$boot" == "1" ]] && grep -q "found" <<<"$package_service"; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" != "1" ]]; then
  echo "FAIL: Android emulator or PackageManager did not become ready" >&2
  adb shell getprop sys.boot_completed || true
  adb shell service check package || true
  adb logcat -d -t 5000 > webview-logcat.txt || true
  exit 1
fi

trap 'adb logcat -d -t 12000 > webview-logcat.txt || true' EXIT
gradle --no-daemon --stacktrace connectedDebugAndroidTest
