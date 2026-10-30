import Foundation

/// One JSON request per line in, one JSON reply per line out, on a unix socket only the same user can use.
public final class SocketServer {
    let path: String
    let handler: Handler
    let onMain: (() -> Data) -> Data
    var fd: Int32 = -1

    /// `onMain` runs a handler call where the system app APIs expect it (the main thread in the real helper).
    public init(path: String, handler: Handler, onMain: @escaping (() -> Data) -> Data = { $0() }) {
        self.path = path
        self.handler = handler
        self.onMain = onMain
    }

    public func start() throws {
        let dir = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        unlink(path)
        fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw posix() }
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: addr.sun_path) else {
            throw NSError(domain: "AppHelper", code: 1, userInfo: [NSLocalizedDescriptionKey: "The socket path is too long. Choose a shorter path."])
        }
        withUnsafeMutableBytes(of: &addr.sun_path) { p in
            for (i, b) in bytes.enumerated() { p[i] = b }
        }
        let oldMask = umask(0o177)
        let rc = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        umask(oldMask)
        guard rc == 0 else { throw posix() }
        chmod(path, 0o600)
        guard listen(fd, 8) == 0 else { throw posix() }
        let lfd = fd
        DispatchQueue.global().async { [self] in
            while true {
                let c = accept(lfd, nil, nil)
                if c < 0 { return }
                DispatchQueue.global().async { self.serve(c) }
            }
        }
    }

    public func stop() {
        if fd >= 0 { close(fd); fd = -1 }
        unlink(path)
    }

    func posix() -> NSError { NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }

    func serve(_ c: Int32) {
        defer { close(c) }
        var uid: uid_t = 0, gid: gid_t = 0
        guard getpeereid(c, &uid, &gid) == 0, uid == getuid() else { return }
        var buf = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        while true {
            let n = read(c, &chunk, chunk.count)
            if n <= 0 { return }
            buf.append(chunk, count: n)
            while let nl = buf.firstIndex(of: 10) {
                let line = buf.subdata(in: buf.startIndex..<nl)
                buf.removeSubrange(buf.startIndex...nl)
                var reply = onMain { handler.handle(line: line) }
                reply.append(10)
                _ = reply.withUnsafeBytes { write(c, $0.baseAddress, reply.count) }
            }
            if buf.count > 65536 { return }
        }
    }
}
