import Foundation

public struct RunningApp: Codable, Equatable {
    public var bundleId: String
    public var name: String
    public var bytes: Int64
    public var frontmost: Bool
    public var lastActivatedSecondsAgo: Int?

    public init(bundleId: String, name: String, bytes: Int64, frontmost: Bool, lastActivatedSecondsAgo: Int? = nil) {
        self.bundleId = bundleId
        self.name = name
        self.bytes = bytes
        self.frontmost = frontmost
        self.lastActivatedSecondsAgo = lastActivatedSecondsAgo
    }
}

public enum QuitOutcome: String, Codable {
    case quit
    case stillRunning = "still_running"
    case notRunning = "not_running"
    case refusedFloor = "refused_floor"
}

public protocol AppController {
    func list() -> [RunningApp]
    /// True when the quit request was delivered. The app decides what to do with it.
    func requestQuit(bundleId: String) -> Bool
    func isRunning(bundleId: String) -> Bool
    func reopen(bundleId: String) -> Bool
    /// Spins the run loop so the system can report the app's exit.
    func pump(seconds: Double)
}
