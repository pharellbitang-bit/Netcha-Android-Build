# Netcha Android build

This public repository contains only the Android wrapper and the workflow used to build a test APK for the existing Netcha web application.

- Live app: https://gentle-tranquility-production-db0a.up.railway.app/
- Android application ID: `com.netcha.app`
- Build output: GitHub Actions artifact `netcha-android-debug-apk`
- This is a debug APK for testing, not a signed Play Store release.

The private Netcha backend source and database are not copied into this repository. NetchaPlus is not part of this project.

## Build

Open the Actions tab and run **Build Netcha Android APK**, or push a commit to `main`. After a successful run, download the `netcha-android-debug-apk` artifact from that workflow run.
