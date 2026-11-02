package live.nlabs.bible;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Downloads a batch of chapter MP3s (the full Bible) in a foreground service,
 * so it keeps going when the user leaves the app or locks the screen. The
 * WebView-driven queue in AudioDownloaderService stops as soon as Android
 * pauses or kills the WebView.
 *
 * Files land exactly where FilesystemAudioStorage (audio-storage.ts) expects
 * them: `<filesDir>/audios/<fileName>` (= Capacitor's Directory.Data). They
 * are written as `<fileName>.dl` and renamed when complete; JS only indexes
 * `.mp3`, and it deletes its own `.part` leftovers, so the two never collide.
 */
public class BulkDownloadService extends Service {
    private static final String TAG = "BulkDownload";

    static final String ACTION_START = "live.nlabs.bible.bulkdownload.START";
    static final String ACTION_CANCEL = "live.nlabs.bible.bulkdownload.CANCEL";

    private static final String CHANNEL_ID = "bulk_download";
    private static final int NOTIFICATION_ID = 7301;
    private static final int CONCURRENCY = 3;
    private static final int MAX_ATTEMPTS = 3;
    private static final long NOTIFY_INTERVAL_MS = 750;
    private static final String AUDIO_DIR = "audios";
    private static final String TMP_SUFFIX = ".dl";

    // ---- Job handed over by the plugin (a 1189-item list is too big to
    // ship comfortably in Intent extras). ----

    static final class Item {
        final String id;
        final String url;
        final String fileName;

        Item(String id, String url, String fileName) {
            this.id = id;
            this.url = url;
            this.fileName = fileName;
        }
    }

    static final class Strings {
        String title = "Downloading";
        /** Placeholders: {done}, {total}. */
        String progress = "{done} / {total}";
        String complete = "Download complete";
        /** Placeholder: {failed}. */
        String incomplete = "{failed} failed";
        String cancel = "Cancel";
    }

    interface Listener {
        void onProgress(String status, int total, int done, int failed);
        void onItemDone(String id, long size);
    }

    private static volatile List<Item> pendingItems;
    private static volatile Strings pendingStrings;
    private static volatile Listener listener;

    // ---- Shared state (read by the plugin's getStatus after a WebView restart). ----
    static volatile String status = "idle"; // idle | running | completed | error | cancelled
    static volatile int total = 0;
    static final AtomicInteger done = new AtomicInteger();
    static final AtomicInteger failed = new AtomicInteger();

    static void setListener(@Nullable Listener l) {
        listener = l;
    }

    static boolean isRunning() {
        return "running".equals(status);
    }

    static void start(Context context, List<Item> items, Strings strings) {
        pendingItems = items;
        pendingStrings = strings;
        Intent intent = new Intent(context, BulkDownloadService.class).setAction(ACTION_START);
        androidx.core.content.ContextCompat.startForegroundService(context, intent);
    }

    static void cancel(Context context) {
        if (!isRunning()) return;
        Intent intent = new Intent(context, BulkDownloadService.class).setAction(ACTION_CANCEL);
        context.startService(intent);
    }

    // ---- Service ----

    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private ExecutorService executor;
    private PowerManager.WakeLock wakeLock;
    private Strings strings = new Strings();
    private long lastNotifyAt = 0;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_CANCEL.equals(action)) {
            cancelled.set(true);
            if (executor != null) executor.shutdownNow();
            return START_NOT_STICKY;
        }

        List<Item> items = pendingItems;
        pendingItems = null;
        if (pendingStrings != null) strings = pendingStrings;

        if (items == null || isRunning()) {
            // Restarted by the system without a job, or a second start while
            // one is already running: nothing new to do. startForeground must
            // still be called after startForegroundService or the app crashes.
            goForeground(buildProgressNotification());
            if (!isRunning()) stopSelf();
            return START_NOT_STICKY;
        }

        total = items.size();
        done.set(0);
        failed.set(0);
        cancelled.set(false);
        status = "running";
        goForeground(buildProgressNotification());
        acquireWakeLock();
        emitProgress();

        new Thread(() -> runJob(items), "BulkDownload").start();
        return START_NOT_STICKY;
    }

    /** Android 15+: dataSync services get ~6 h per day; stop cleanly instead of crashing. */
    @Override
    public void onTimeout(int startId, int fgsType) {
        Log.w(TAG, "Foreground service timeout; stopping");
        cancelled.set(true);
        if (executor != null) executor.shutdownNow();
    }

    @Override
    public void onDestroy() {
        cancelled.set(true);
        if (executor != null) executor.shutdownNow();
        releaseWakeLock();
        super.onDestroy();
    }

    private void runJob(List<Item> items) {
        File dir = new File(getFilesDir(), AUDIO_DIR);
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        deleteLeftovers(dir);

        executor = Executors.newFixedThreadPool(CONCURRENCY);
        for (Item item : items) {
            executor.execute(() -> {
                if (cancelled.get()) return;
                File target = new File(dir, item.fileName);
                if (target.exists() && target.length() > 0) {
                    done.incrementAndGet();
                    maybeNotify();
                    return;
                }
                if (downloadWithRetry(item, dir, target)) {
                    done.incrementAndGet();
                    Listener l = listener;
                    if (l != null) l.onItemDone(item.id, target.length());
                } else if (!cancelled.get()) {
                    failed.incrementAndGet();
                }
                maybeNotify();
            });
        }
        executor.shutdown();
        try {
            //noinspection ResultOfMethodCallIgnored
            executor.awaitTermination(1, TimeUnit.DAYS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }

        if (cancelled.get()) status = "cancelled";
        else status = failed.get() == 0 ? "completed" : "error";
        main.post(this::finish);
    }

    private boolean downloadWithRetry(Item item, File dir, File target) {
        File tmp = new File(dir, item.fileName + TMP_SUFFIX);
        for (int attempt = 1; attempt <= MAX_ATTEMPTS && !cancelled.get(); attempt++) {
            try {
                downloadOnce(item.url, tmp);
                if (!tmp.renameTo(target)) throw new IOException("rename failed");
                return true;
            } catch (IOException e) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                Log.w(TAG, "Attempt " + attempt + " failed for " + item.id + ": " + e);
                if (attempt < MAX_ATTEMPTS && !cancelled.get()) {
                    SystemClock.sleep(attempt * 3000L);
                }
            }
        }
        return false;
    }

    private void downloadOnce(String url, File tmp) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(20_000);
        conn.setReadTimeout(30_000);
        try {
            int code = conn.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) throw new IOException("HTTP " + code);
            long expected = conn.getContentLengthLong();
            long written = 0;
            byte[] buf = new byte[64 * 1024];
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (cancelled.get()) throw new IOException("cancelled");
                    out.write(buf, 0, n);
                    written += n;
                }
            }
            if (written == 0 || (expected > 0 && written != expected)) {
                throw new IOException("truncated: " + written + "/" + expected);
            }
        } finally {
            conn.disconnect();
        }
    }

    private static void deleteLeftovers(File dir) {
        File[] files = dir.listFiles((d, name) -> name.endsWith(TMP_SUFFIX));
        if (files == null) return;
        for (File f : files) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    // ---- Progress / notifications ----

    private void maybeNotify() {
        long now = SystemClock.elapsedRealtime();
        synchronized (this) {
            if (now - lastNotifyAt < NOTIFY_INTERVAL_MS) return;
            lastNotifyAt = now;
        }
        main.post(() -> {
            if (!isRunning()) return;
            notificationManager().notify(NOTIFICATION_ID, buildProgressNotification());
            emitProgress();
        });
    }

    private void emitProgress() {
        Listener l = listener;
        if (l != null) l.onProgress(status, total, done.get(), failed.get());
    }

    private void finish() {
        releaseWakeLock();
        emitProgress();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        if (!"cancelled".equals(status)) {
            String text = "completed".equals(status)
                    ? strings.complete
                    : strings.incomplete.replace("{failed}", String.valueOf(failed.get()));
            Notification n = baseBuilder()
                    .setContentTitle(text)
                    .setOngoing(false)
                    .setAutoCancel(true)
                    .build();
            notificationManager().notify(NOTIFICATION_ID, n);
        }
        stopSelf();
    }

    private void goForeground(Notification notification) {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
    }

    private Notification buildProgressNotification() {
        int t = Math.max(total, 1);
        int d = done.get() + failed.get();
        String text = strings.progress
                .replace("{done}", String.valueOf(done.get()))
                .replace("{total}", String.valueOf(total));

        Intent cancelIntent = new Intent(this, BulkDownloadService.class).setAction(ACTION_CANCEL);
        PendingIntent cancelPi = PendingIntent.getService(
                this, 1, cancelIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return baseBuilder()
                .setContentTitle(strings.title)
                .setContentText(text)
                .setProgress(t, Math.min(d, t), total == 0)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .addAction(0, strings.cancel, cancelPi)
                .build();
    }

    private NotificationCompat.Builder baseBuilder() {
        ensureChannel();
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openPi = open == null ? null : PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_notification)
                .setColor(0xFF0F3D3E)
                .setContentIntent(openPi)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = notificationManager();
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, strings.title, NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private NotificationManager notificationManager() {
        return (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "bible:bulk-download");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(TimeUnit.HOURS.toMillis(6));
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    static List<Item> parseItems(org.json.JSONArray arr) throws org.json.JSONException {
        List<Item> items = new ArrayList<>(arr.length());
        for (int i = 0; i < arr.length(); i++) {
            org.json.JSONObject o = arr.getJSONObject(i);
            items.add(new Item(o.getString("id"), o.getString("url"), o.getString("fileName")));
        }
        return items;
    }
}
