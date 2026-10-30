from pathlib import Path

res = Path("android/app/src/main/res")
(res / "drawable").mkdir(parents=True, exist_ok=True)
(res / "values").mkdir(parents=True, exist_ok=True)
(res / "mipmap-anydpi").mkdir(parents=True, exist_ok=True)
(res / "mipmap-anydpi-v26").mkdir(parents=True, exist_ok=True)

foreground = """<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#FFFFFFFF"
        android:pathData="M28,78 L28,30 L39,30 L69,64 L69,30 L80,30 L80,78 L69,78 L39,44 L39,78 Z"/>
    <circle android:fillColor="#FF62E6D4" android:cx="82" android:cy="27" android:radius="4"/>
</vector>
"""
(res / "drawable/netcha_launcher_foreground.xml").write_text(foreground, encoding="utf-8")
(res / "values/netcha_launcher_colors.xml").write_text(
    """<resources><color name="netcha_launcher_background">#116B83</color></resources>""",
    encoding="utf-8",
)
adaptive = """<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/netcha_launcher_background"/>
    <foreground android:drawable="@drawable/netcha_launcher_foreground"/>
</adaptive-icon>
"""
(res / "mipmap-anydpi-v26/ic_launcher.xml").write_text(adaptive, encoding="utf-8")
(res / "mipmap-anydpi-v26/ic_launcher_round.xml").write_text(adaptive, encoding="utf-8")
legacy = """<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#FF116B83" android:pathData="M0,0h108v108h-108z"/>
    <path android:fillColor="#FFFFFFFF"
        android:pathData="M28,78 L28,30 L39,30 L69,64 L69,30 L80,30 L80,78 L69,78 L39,44 L39,78 Z"/>
    <circle android:fillColor="#FF62E6D4" android:cx="82" android:cy="27" android:radius="4"/>
</vector>
"""
(res / "mipmap-anydpi/ic_launcher.xml").write_text(legacy, encoding="utf-8")
(res / "mipmap-anydpi/ic_launcher_round.xml").write_text(legacy, encoding="utf-8")
print("Icônes Netcha adaptive et legacy installées.")
