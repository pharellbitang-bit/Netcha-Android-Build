package com.netcha.realwebviewtest;

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
public final class NetchaShellTest {
    @Rule
    public ActivityTestRule<MainActivity> activityRule =
        new ActivityTestRule<>(MainActivity.class);

    private String evaluate(String javascript) throws Exception {
        MainActivity activity = activityRule.getActivity();
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>("");
        activity.runOnUiThread(() -> {
            WebView webView = activity.getWebViewForTest();
            if (webView == null) {
                latch.countDown();
                return;
            }
            webView.evaluateJavascript(javascript, (ValueCallback<String>) value -> {
                result.set(value == null ? "" : value);
                latch.countDown();
            });
        });
        assertTrue("WebView JavaScript callback timed out", latch.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private String waitFor(String javascript, String expected) throws Exception {
        long deadline = System.currentTimeMillis() + 60000;
        String value = "";
        while (System.currentTimeMillis() < deadline) {
            value = evaluate(javascript);
            if (value.contains(expected)) return value;
            Thread.sleep(300);
        }
        return value;
    }

    @Test
    public void loadsRealNetchaShellAndAccountInterface() throws Exception {
        String state = waitFor(
            "({title:document.title,app:!!document.querySelector('main.app'),nav:!!document.querySelector('nav.bottom'),auth:!!document.getElementById('netchaAuthTrigger'),modal:!!document.getElementById('netchaAuthModal'),feed:!!document.querySelector('section#feed.screen')})",
            "\"auth\":true"
        );
        assertTrue("Netcha local shell or account UI did not load: " + state,
            state.contains("\"app\":true")
            && state.contains("\"nav\":true")
            && state.contains("\"auth\":true")
            && state.contains("\"modal\":true")
            && state.contains("\"feed\":true"));
    }

    @Test
    public void accountModalOpensAndLoginTabWorks() throws Exception {
        waitFor("document.getElementById('netchaAuthTrigger') ? 'READY' : 'WAIT'", "READY");
        assertTrue("Account trigger did not open the real Netcha modal",
            evaluate("(function(){document.getElementById('netchaAuthTrigger').click();return document.getElementById('netchaAuthModal').classList.contains('is-open')})()").contains("true"));
        assertTrue("Login tab is missing or not selectable",
            evaluate("(function(){document.getElementById('netchaLoginTab').click();return !document.getElementById('netchaLoginForm').hidden})()").contains("true"));
    }

    @Test
    public void mainNavigationContainsRealNetchaScreens() throws Exception {
        String state = waitFor(
            "Array.from(document.querySelectorAll('nav.bottom [data-screen]')).map(e=>e.getAttribute('data-screen')).join(',')",
            "profile"
        );
        assertTrue("Expected Netcha navigation screens missing: " + state,
            state.contains("feed") && state.contains("explore")
            && state.contains("friends") && state.contains("profile"));
    }
}
