import Foundation

public struct Handler {
    let controller: AppController
    let maxWait: Double = 60
    let defaultWait: Double = 20
    let step: Double

    public init(controller: AppController, step: Double = 0.25) {
        self.controller = controller
        self.step = step
    }

    public func handle(line: Data) -> Data {
        guard let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
              let op = obj["op"] as? String else {
            return fail("That request was not understood. Send one JSON object per line with an op of list, quit or reopen.")
        }
        switch op {
        case "list":
            let apps = controller.list()
            return encode(["ok": true, "apps": apps.map(appJSON)])
        case "quit":
            guard let id = obj["bundleId"] as? String else { return fail("Quit needs a bundleId. Add the app's bundle id and try again.") }
            let wait = min(max((obj["waitSeconds"] as? Double) ?? defaultWait, 0), maxWait)
            return encode(["ok": true, "outcome": quit(id, wait: wait).rawValue])
        case "reopen":
            guard let id = obj["bundleId"] as? String else { return fail("Reopen needs a bundleId. Add the app's bundle id and try again.") }
            if Floor.refuses(id) { return encode(["ok": false, "outcome": QuitOutcome.refusedFloor.rawValue, "error": "That app is on the never-close floor, so this helper does not touch it."]) }
            return encode(["ok": true, "reopened": controller.reopen(bundleId: id)])
        default:
            return fail("The operation \(op) is not supported. Use list, quit or reopen.")
        }
    }

    func quit(_ id: String, wait: Double) -> QuitOutcome {
        if Floor.refuses(id) { return .refusedFloor }
        guard controller.isRunning(bundleId: id) else { return .notRunning }
        _ = controller.requestQuit(bundleId: id)
        var waited = 0.0
        while waited < wait {
            controller.pump(seconds: step)
            waited += step
            if !controller.isRunning(bundleId: id) { return .quit }
        }
        return controller.isRunning(bundleId: id) ? .stillRunning : .quit
    }

    func appJSON(_ a: RunningApp) -> [String: Any] {
        var d: [String: Any] = ["bundleId": a.bundleId, "name": a.name, "bytes": a.bytes, "frontmost": a.frontmost]
        if let s = a.lastActivatedSecondsAgo { d["lastActivatedSecondsAgo"] = s }
        return d
    }

    func fail(_ msg: String) -> Data { encode(["ok": false, "error": msg]) }

    func encode(_ d: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])) ?? Data("{\"ok\":false}".utf8)
    }
}
