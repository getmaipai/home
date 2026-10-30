import AppHelperCore
import Foundation

var socketPath = ("~/Library/Application Support/MaiPai/app-helper.sock" as NSString).expandingTildeInPath
let args = CommandLine.arguments
if let i = args.firstIndex(of: "--socket"), i + 1 < args.count { socketPath = args[i + 1] }

let server = SocketServer(path: socketPath, handler: Handler(controller: SystemAppController()),
                          onMain: { work in DispatchQueue.main.sync(execute: work) })
do {
    try server.start()
    FileHandle.standardError.write(Data("app helper listening\n".utf8))
} catch {
    FileHandle.standardError.write(Data("app helper could not open its socket: \(error). Check that the folder is writable and run it again.\n".utf8))
    exit(1)
}
RunLoop.main.run()
