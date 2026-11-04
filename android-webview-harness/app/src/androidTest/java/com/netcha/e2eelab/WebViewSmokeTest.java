package com.netcha.e2eelab;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.rule.ActivityTestRule;
import androidx.test.espresso.web.webdriver.Locator;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;
import static androidx.test.espresso.web.sugar.Web.onWebView;
import static androidx.test.espresso.web.webdriver.DriverAtoms.findElement;
import static androidx.test.espresso.web.webdriver.DriverAtoms.getText;
import static androidx.test.espresso.web.assertion.WebViewAssertions.webMatches;
import static org.hamcrest.Matchers.containsString;

@RunWith(AndroidJUnit4.class)
public final class WebViewSmokeTest {
    @Rule
    public ActivityTestRule<MainActivity> activityRule =
        new ActivityTestRule<>(MainActivity.class);

    @Test
    public void webViewLoadsMatrixSdkAndCryptoPrimitives() {
        onWebView()
            .withElement(findElement(Locator.ID, "status"))
            .check(webMatches(getText(),
                containsString("PASS: WebView compatible avec le chargement du laboratoire Matrix.")));
    }
}
