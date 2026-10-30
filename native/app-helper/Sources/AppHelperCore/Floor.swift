import Foundation

/// Apps that no setting may ever close: the household would lock itself out of the Mac.
public enum Floor {
    static let ids: Set<String> = [
        "com.apple.finder", "com.apple.dock", "com.apple.loginwindow", "com.apple.systemuiserver",
        "com.apple.systempreferences", "com.apple.activitymonitor", "com.apple.softwareupdate",
        "com.apple.installer", "com.apple.timemachine", "com.apple.screensharing",
        "com.apple.remotedesktop", "com.apple.screensharing.agent", "io.tailscale.ipn.macos",
        "com.tailscale.ipn.macos", "com.teamviewer.teamviewer", "com.anydesk.anydesk",
        "com.parsec.parsecd", "com.microsoft.rdc.macos",
    ]
    static let prefixes = ["ai.maipai.", "com.maipai."]
    public static let helperBundleId = "ai.maipai.app-helper"

    public static func refuses(_ bundleId: String) -> Bool {
        let id = bundleId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if id.isEmpty || id == helperBundleId { return true }
        if ids.contains(id) { return true }
        return prefixes.contains { id.hasPrefix($0) }
    }
}
