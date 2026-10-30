import Foundation
import Testing
@testable import AppHelperCore

final class FakeController: AppController {
    var apps: [String: Bool] = [:]       // bundle id -> running
    var exitsOnQuit: Set<String> = []
    var log: [String] = []

    func list() -> [RunningApp] {
        log.append("list")
        return apps.filter { $0.value }.map { RunningApp(bundleId: $0.key, name: "App", bytes: 1_000_000_000, frontmost: false) }
    }
    func requestQuit(bundleId: String) -> Bool {
        log.append("requestQuit:\(bundleId)")
        if exitsOnQuit.contains(bundleId) { apps[bundleId] = false }
        return true
    }
    func isRunning(bundleId: String) -> Bool { apps[bundleId] ?? false }
    func reopen(bundleId: String) -> Bool { log.append("reopen:\(bundleId)"); apps[bundleId] = true; return true }
    func pump(seconds: Double) {}
}

func call(_ h: Handler, _ json: String) -> [String: Any] {
    let d = h.handle(line: Data(json.utf8))
    return (try? JSONSerialization.jsonObject(with: d) as? [String: Any]) ?? [:]
}

let floorIds = ["com.apple.finder", "com.apple.dock", "com.apple.loginwindow", "com.apple.systemuiserver",
                "com.apple.systempreferences", "com.apple.ActivityMonitor", "com.apple.SoftwareUpdate",
                "com.apple.installer", "com.apple.TimeMachine", "com.apple.ScreenSharing", "com.apple.RemoteDesktop",
                "io.tailscale.ipn.macos", "com.teamviewer.TeamViewer", "ai.maipai.home", "com.maipai.x",
                "  COM.APPLE.FINDER ", "", "ai.maipai.app-helper"]

@Test func floorAppsAreRefusedAndNeverAsked() {
    for id in floorIds {
        let c = FakeController(); c.apps[id] = true
        let h = Handler(controller: c)
        let q = call(h, "{\"op\":\"quit\",\"bundleId\":\"\(id)\"}")
        #expect(q["outcome"] as? String == "refused_floor", "\(id)")
        let r = call(h, "{\"op\":\"reopen\",\"bundleId\":\"\(id)\"}")
        #expect(r["ok"] as? Bool == false, "\(id)")
        #expect(c.log.isEmpty, "\(id)")
    }
}

@Test func anAppThatKeepsItsPromptIsReportedAndAskedOnce() {
    let c = FakeController(); c.apps["com.example.docs"] = true
    let q = call(Handler(controller: c, step: 0.25), "{\"op\":\"quit\",\"bundleId\":\"com.example.docs\",\"waitSeconds\":1}")
    #expect(q["outcome"] as? String == "still_running")
    #expect(c.log == ["requestQuit:com.example.docs"])
    #expect(c.apps["com.example.docs"] == true)
}

@Test func aPoliteAppQuits() {
    let c = FakeController(); c.apps["com.example.a"] = true; c.exitsOnQuit = ["com.example.a"]
    let q = call(Handler(controller: c), "{\"op\":\"quit\",\"bundleId\":\"com.example.a\"}")
    #expect(q["outcome"] as? String == "quit")
}

@Test func anAppThatIsNotRunningIsNotAsked() {
    let c = FakeController()
    let q = call(Handler(controller: c), "{\"op\":\"quit\",\"bundleId\":\"com.example.a\"}")
    #expect(q["outcome"] as? String == "not_running")
    #expect(c.log.isEmpty)
}

@Test func listCarriesSizesAndFrontmost() {
    let c = FakeController(); c.apps["com.example.a"] = true
    let apps = call(Handler(controller: c), "{\"op\":\"list\"}")["apps"] as? [[String: Any]]
    #expect(apps?.count == 1)
    #expect(apps?.first?["bytes"] as? Int == 1_000_000_000)
    #expect(apps?.first?["frontmost"] as? Bool == false)
}

@Test func badRequestsGetAPlainError() {
    let h = Handler(controller: FakeController())
    for bad in ["not json", "{\"op\":\"explode\"}", "{\"op\":\"quit\"}", "{\"op\":\"reopen\"}"] {
        let r = call(h, bad)
        #expect(r["ok"] as? Bool == false, "\(bad)")
        #expect((r["error"] as? String)?.isEmpty == false, "\(bad)")
    }
}

@Test func socketRoundTripAndMode() throws {
    let dir = NSTemporaryDirectory() + "ah\(getpid())"
    let path = dir + "/s.sock"
    let c = FakeController(); c.apps["com.example.a"] = true
    let server = SocketServer(path: path, handler: Handler(controller: c))
    try server.start()
    defer { server.stop(); try? FileManager.default.removeItem(atPath: dir) }
    let mode = (try FileManager.default.attributesOfItem(atPath: path)[.posixPermissions] as? NSNumber)?.intValue
    #expect(mode == 0o600)

    let s = socket(AF_UNIX, SOCK_STREAM, 0)
    defer { close(s) }
    var addr = sockaddr_un(); addr.sun_family = sa_family_t(AF_UNIX)
    withUnsafeMutableBytes(of: &addr.sun_path) { p in for (i, b) in path.utf8.enumerated() { p[i] = b } }
    let rc = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(s, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
    #expect(rc == 0)
    func ask(_ line: String) -> [String: Any] {
        let out = Array((line + "\n").utf8); _ = write(s, out, out.count)
        var buf = [UInt8](repeating: 0, count: 4096); let n = read(s, &buf, buf.count)
        return (try? JSONSerialization.jsonObject(with: Data(buf.prefix(max(n, 0)))) as? [String: Any]) ?? [:]
    }
    #expect((ask("{\"op\":\"list\"}")["apps"] as? [Any])?.count == 1)
    #expect(ask("{\"op\":\"quit\",\"bundleId\":\"com.apple.finder\"}")["outcome"] as? String == "refused_floor")
    #expect(c.log == ["list"])
}

@Test func sourcesContainNoSignalOrSubprocessCalls() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Sources")
    let banned = ["kill" + "(", "killpg", "SIG" + "KILL", "SIG" + "TERM", "SIG" + "INT", "raise" + "(", "force" + "Terminate", "pkill", "/bin/kill", "Process" + "("]
    let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)!.compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" }
    #expect(files.count >= 5)
    for f in files {
        let text = try String(contentsOf: f, encoding: .utf8)
        for b in banned { #expect(!text.contains(b), "\(f.lastPathComponent) contains \(b)") }
    }
}
