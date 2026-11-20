package win.tavernanacombie.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * Taverna na Combie para Android: abre o site numa tela própria, com tela cheia,
 * janela flutuante (PiP) e login com Google pelo navegador.
 */
public class MainActivity extends Activity {
    private static final String BASE = "https://tavernanacombie.win";
    private static final int BG = Color.parseColor("#12062A");

    private FrameLayout root;
    private WebView web;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        web = new WebView(this);
        web.setBackgroundColor(BG);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " TavernaApp/Android");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                enterFullscreen(view, callback);
            }

            @Override
            public void onHideCustomView() {
                exitFullscreen();
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            openIntent(getIntent(), true);
        }
    }

    private static boolean isOurHost(Uri u) {
        String h = u.getHost();
        return h != null && (h.equals("tavernanacombie.win") || h.endsWith(".tavernanacombie.win"));
    }

    /** true = o app cuida do link (não abre dentro da tela). */
    private boolean handleUrl(Uri u) {
        String path = u.getPath() == null ? "" : u.getPath();
        if (isOurHost(u)) {
            if (path.equals("/auth/google")) {
                // O Google não permite login dentro de apps: abre no navegador e volta para cá depois.
                openExternal(Uri.parse(BASE + "/auth/google?app=android"));
                return true;
            }
            return false;
        }
        openExternal(u);
        return true;
    }

    private void openExternal(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (Exception ignored) {
        }
    }

    private void openIntent(Intent intent, boolean firstLoad) {
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && "tavernanacombie".equals(data.getScheme())) {
            String code = data.getQueryParameter("code");
            web.loadUrl(BASE + "/auth/app-exchange?code=" + Uri.encode(code == null ? "" : code));
        } else if (data != null && isOurHost(data)) {
            web.loadUrl(data.toString());
        } else if (firstLoad) {
            web.loadUrl(BASE + "/");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openIntent(intent, false);
    }

    private void enterFullscreen(View view, WebChromeClient.CustomViewCallback callback) {
        if (customView != null) {
            callback.onCustomViewHidden();
            return;
        }
        customView = view;
        customCallback = callback;
        root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setVisibility(View.GONE);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    private void exitFullscreen() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        web.setVisibility(View.VISIBLE);
        if (customCallback != null) customCallback.onCustomViewHidden();
        customCallback = null;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    }

    /** Saiu do app assistindo uma sala: continua numa janelinha flutuante. */
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        String url = web.getUrl();
        if (url != null && url.contains("sala=")) {
            try {
                enterPictureInPictureMode();
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            exitFullscreen();
        } else if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
