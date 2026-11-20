package win.tavernanacombie.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.database.Cursor;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
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

    // Atualização dentro do app
    private static final String UPDATE_PREFIX = "https://github.com/leoaltoe-dot/taverna-na-combie/releases/download/";
    private final Handler ui = new Handler(Looper.getMainLooper());
    private long downloadId = -1;
    private File pendingApk;
    private BroadcastReceiver downloadReceiver;

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
        s.setUserAgentString(s.getUserAgentString() + " TavernaApp/Android/" + appVersion());
        web.addJavascriptInterface(new Bridge(), "TavernaAndroid");
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

    // ---------- Atualização ----------
    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0";
        }
    }

    /** Ponte usada pela página: window.TavernaAndroid.installUpdate(url). */
    private class Bridge {
        @JavascriptInterface
        public String version() {
            return appVersion();
        }

        @JavascriptInterface
        public void installUpdate(final String url) {
            ui.post(() -> startUpdateDownload(url));
        }
    }

    private void jsProgress(int pct) {
        web.evaluateJavascript("window.tavernaUpdateProgress && window.tavernaUpdateProgress(" + pct + ")", null);
    }

    private void startUpdateDownload(String url) {
        if (url == null || !url.startsWith(UPDATE_PREFIX) || !url.endsWith(".apk") || downloadId != -1) return;
        try {
            File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            File apk = new File(dir, "Taverna-na-Combie-update.apk");
            if (apk.exists()) apk.delete();
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url))
                    .setTitle(getString(R.string.app_name))
                    .setDescription("Baixando atualização")
                    .setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                    .setDestinationUri(Uri.fromFile(apk));
            pendingApk = apk;
            downloadId = dm.enqueue(req);
            watchDownload(dm);
        } catch (Exception e) {
            downloadId = -1;
            jsProgress(-1);
        }
    }

    private void watchDownload(final DownloadManager dm) {
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                if (i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -2) == downloadId) finishDownload(dm);
            }
        };
        IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(downloadReceiver, f, Context.RECEIVER_EXPORTED);
        else registerReceiver(downloadReceiver, f);
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (downloadId == -1) return;
                try (Cursor cur = dm.query(new DownloadManager.Query().setFilterById(downloadId))) {
                    if (cur != null && cur.moveToFirst()) {
                        long got = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        long total = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        if (total > 0) jsProgress((int) Math.min(99, got * 100 / total));
                    }
                } catch (Exception ignored) {
                }
                ui.postDelayed(this, 500);
            }
        }, 500);
    }

    private void finishDownload(DownloadManager dm) {
        int status = -1;
        try (Cursor cur = dm.query(new DownloadManager.Query().setFilterById(downloadId))) {
            if (cur != null && cur.moveToFirst()) status = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
        } catch (Exception ignored) {
        }
        downloadId = -1;
        try { unregisterReceiver(downloadReceiver); } catch (Exception ignored) { }
        downloadReceiver = null;
        if (status != DownloadManager.STATUS_SUCCESSFUL || pendingApk == null || !pendingApk.exists()) {
            pendingApk = null;
            jsProgress(-1);
            return;
        }
        jsProgress(100);
        installPending();
    }

    private void installPending() {
        if (pendingApk == null) return;
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            // Primeira vez: o Android pede para liberar "instalar apps desta fonte" para a Taverna.
            Toast.makeText(this, "Permita instalar atualizações da Taverna e volte para o app.", Toast.LENGTH_LONG).show();
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            return; // continua no onResume
        }
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", pendingApk);
        Intent install = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        pendingApk = null;
        try {
            startActivity(install);
        } catch (Exception e) {
            jsProgress(-1);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pendingApk != null && pendingApk.exists() && downloadId == -1) installPending();
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
        if (downloadReceiver != null) { try { unregisterReceiver(downloadReceiver); } catch (Exception ignored) { } }
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
