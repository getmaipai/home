// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "maipai-app-helper",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "AppHelperCore"),
        .executableTarget(name: "maipai-app-helper", dependencies: ["AppHelperCore"]),
        .testTarget(name: "AppHelperCoreTests", dependencies: ["AppHelperCore"]),
    ]
)
