import Foundation
import AVFoundation
import Capacitor

/// The device's media volume, so the app can say it is too low to hear when
/// the user taps play (the web view can't read it). No permission needed.
/// Android's twin: DeviceVolumePlugin.java.
@objc(DeviceVolumePlugin)
public class DeviceVolumePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeviceVolumePlugin"
    public let jsName = "DeviceVolume"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getVolume", returnType: CAPPluginReturnPromise)
    ]

    /// { volume: 0...1 } — the system output volume (the ringer switch doesn't
    /// mute media playback, so it is not part of it).
    @objc func getVolume(_ call: CAPPluginCall) {
        call.resolve(["volume": Double(AVAudioSession.sharedInstance().outputVolume)])
    }
}
