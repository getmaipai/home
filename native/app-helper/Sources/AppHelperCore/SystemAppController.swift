import AppKit
import Darwin

/// Talks to the real Mac. The only way an app is asked to quit is `NSRunningApplication.terminate()`,
/// the same request the app's own Quit menu item makes.
public final class SystemAppController: AppController {
    public init() {}

    func apps(_ id: String) -> [NSRunningApplication] {
        NSRunningApplication.runningApplications(withBundleIdentifier: id).filter { !$0.isTerminated }
    }

    public func list() -> [RunningApp] {
        let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
        return NSWorkspace.shared.runningApplications.compactMap { a in
            guard a.activationPolicy == .regular, let id = a.bundleIdentifier, !a.isTerminated else { return nil }
            return RunningApp(bundleId: id, name: a.localizedName ?? id,
                              bytes: footprint(a.processIdentifier), frontmost: a.processIdentifier == front)
        }
    }

    public func requestQuit(bundleId: String) -> Bool {
        var sent = false
        for a in apps(bundleId) { if a.terminate() { sent = true } }
        return sent
    }

    public func isRunning(bundleId: String) -> Bool { !apps(bundleId).isEmpty }

    public func reopen(bundleId: String) -> Bool {
        // A moment after a quit the system can still list the app; give it one beat to catch up.
        if isRunning(bundleId: bundleId) { pump(seconds: 0.5) }
        guard !isRunning(bundleId: bundleId),
              let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else { return false }
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = false
        NSWorkspace.shared.openApplication(at: url, configuration: cfg, completionHandler: nil)
        return true
    }

    public func pump(seconds: Double) {
        // run(until:) returns at once when the loop has no sources, so wait out the full time ourselves.
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if !RunLoop.current.run(mode: .default, before: end) { Thread.sleep(forTimeInterval: 0.02) }
        }
    }

    func footprint(_ pid: pid_t) -> Int64 {
        var total = own(pid)
        var kids = [pid_t](repeating: 0, count: 512)
        let n = proc_listchildpids(pid, &kids, Int32(kids.count * MemoryLayout<pid_t>.size))
        if n > 0 { for k in kids.prefix(Int(n)) where k > 0 { total += own(k) } }
        return total
    }

    func own(_ pid: pid_t) -> Int64 {
        var info = rusage_info_v4()
        let rc = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V4, $0) }
        }
        return rc == 0 ? Int64(info.ri_phys_footprint) : 0
    }
}
