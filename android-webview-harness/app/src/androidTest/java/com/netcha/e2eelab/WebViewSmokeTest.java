package com.netcha.e2eelab;

import android.webkit.ValueCallback;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.rule.ActivityTestRule;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.assertTrue;

@RunWith(AndroidJUnit4.class)
public final class WebViewSmokeTest {
    @Rule
    public ActivityTestRule<MainActivity> activityRule =
        new ActivityTestRule<>(MainActivity.class);

    @Test
    public void webViewLoadsMatrixSdkAndCryptoPrimitives() throws Exception {
        MainActivity activity = activityRule.getActivity();
        long deadline = System.currentTimeMillis() + 90000;
        String result = "";
        while (System.currentTimeMillis() < deadline) {
            CountDownLatch latch = new CountDownLatch(1);
            AtomicReference<String> value = new AtomicReference<>("");
            activity.runOnUiThread(() -> {
                WebView webView = activity.getWebViewForTest();
                if (webView != null) {
                    webView.evaluateJavascript(
                        "(function(){return document.getElementById('status')?.textContent || '';})()",
                        (ValueCallback<String>) returned -> {
                            value.set(returned == null ? "" : returned);
                            latch.countDown();
                        });
                } else {
                    latch.countDown();
                }
            });
            assertTrue("WebView JavaScript callback timed out", latch.await(5, TimeUnit.SECONDS));
            result = value.get();
            if (result.contains("PASS: WebView compatible avec le chargement du laboratoire Matrix.")
                    || result.contains("FAIL: une ou plusieurs capacités WebView manquent.")) {
                break;
            }
            Thread.sleep(500);
        }
        assertTrue("WebView did not finish the Matrix capability checks; last status: " + result,
            result.contains("PASS: WebView compatible avec le chargement du laboratoire Matrix."));
    }
}
