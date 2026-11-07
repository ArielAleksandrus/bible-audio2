package live.nlabs.bible;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;

/** JS side: src/app/native/bulk-download.ts. */
@CapacitorPlugin(name = "BulkDownload")
public class BulkDownloadPlugin extends Plugin {

    @Override
    public void load() {
        BulkDownloadService.setListener(new BulkDownloadService.Listener() {
            @Override
            public void onProgress(String status, int total, int done, int failed) {
                notifyListeners("progress", snapshot(status, total, done, failed));
            }

            @Override
            public void onItemDone(String id, long size) {
                JSObject data = new JSObject();
                data.put("id", id);
                data.put("size", size);
                notifyListeners("itemDone", data);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        BulkDownloadService.setListener(null);
        super.handleOnDestroy();
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (BulkDownloadService.isRunning()) {
            call.resolve(currentSnapshot());
            return;
        }
        List<BulkDownloadService.Item> items;
        try {
            items = BulkDownloadService.parseItems(call.getArray("items"));
        } catch (JSONException | NullPointerException e) {
            call.reject("Invalid items", e);
            return;
        }

        BulkDownloadService.Strings strings = new BulkDownloadService.Strings();
        JSObject s = call.getObject("strings");
        if (s != null) {
            strings.title = s.optString("title", strings.title);
            strings.progress = s.optString("progress", strings.progress);
            strings.complete = s.optString("complete", strings.complete);
            strings.incomplete = s.optString("incomplete", strings.incomplete);
            strings.cancel = s.optString("cancel", strings.cancel);
        }

        try {
            BulkDownloadService.start(getContext(), items, strings);
        } catch (RuntimeException e) {
            // e.g. ForegroundServiceStartNotAllowedException if somehow called from background.
            call.reject("Could not start download service", e);
            return;
        }
        call.resolve(snapshot("running", items.size(), 0, 0));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        BulkDownloadService.cancel(getContext());
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(currentSnapshot());
    }

    private static JSObject currentSnapshot() {
        return snapshot(
                BulkDownloadService.status,
                BulkDownloadService.total,
                BulkDownloadService.done.get(),
                BulkDownloadService.failed.get());
    }

    private static JSObject snapshot(String status, int total, int done, int failed) {
        JSObject o = new JSObject();
        o.put("status", status);
        o.put("total", total);
        o.put("downloaded", done);
        o.put("failed", failed);
        return o;
    }
}
