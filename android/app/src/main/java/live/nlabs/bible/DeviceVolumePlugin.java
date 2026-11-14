package live.nlabs.bible;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The device's media volume, so the app can say it is too low to hear when
 * the user taps play (the WebView can't read it). No permission needed.
 * iOS twin: DeviceVolumePlugin.swift.
 */
@CapacitorPlugin(name = "DeviceVolume")
public class DeviceVolumePlugin extends Plugin {
    /** { volume: 0..1 } of the media stream (the one the chapters play on, Bluetooth included). */
    @PluginMethod
    public void getVolume(PluginCall call) {
        AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        JSObject result = new JSObject();
        if (audio == null) {
            result.put("volume", 1.0);
        } else {
            int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int current = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
            result.put("volume", max > 0 ? (double) current / max : 1.0);
        }
        call.resolve(result);
    }
}
