// AGECHECK: keyframes (first, middle, last: three, or five for a long clip) of a finished clip as small JPEGs, through Apple's own video
// decoder (AVFoundation). No model, no network, no EXIF written. Usage: keyframes <clip.mp4> <out-dir> <max-side> [count]
// Writes <out-dir>/0.jpg, 1.jpg, ... and prints the number of frames written. Exit 1 when a frame cannot be read.
import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 4 || args.count == 5, let maxSide = Int(args[3]), maxSide > 0 else {
    FileHandle.standardError.write(Data("usage: keyframes <clip.mp4> <out-dir> <max-side> [count]\n".utf8))
    exit(2)
}
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.maximumSize = CGSize(width: maxSide, height: maxSide)
generator.requestedTimeToleranceBefore = CMTime(seconds: 0.1, preferredTimescale: 600)
generator.requestedTimeToleranceAfter = CMTime(seconds: 0.1, preferredTimescale: 600)

let duration = asset.duration.seconds
guard duration.isFinite, duration > 0 else {
    FileHandle.standardError.write(Data("no duration\n".utf8))
    exit(1)
}
// The last frame sits a little before the end: the final timestamp is often past the last sample.
let count = args.count == 5 ? max(3, min(9, Int(args[4]) ?? 3)) : 3
let times = (0..<count).map { index -> Double in index == 0 ? 0.0 : (index == count - 1 ? max(0.0, duration - 0.15) : duration * Double(index) / Double(count - 1)) }
var written = 0
for (index, seconds) in times.enumerated() {
    do {
        let image = try generator.copyCGImage(at: CMTime(seconds: seconds, preferredTimescale: 600), actualTime: nil)
        let url = URL(fileURLWithPath: args[2]).appendingPathComponent("\(index).jpg") as CFURL
        guard let destination = CGImageDestinationCreateWithURL(url, UTType.jpeg.identifier as CFString, 1, nil) else { exit(1) }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { exit(1) }
        written += 1
    } catch {
        FileHandle.standardError.write(Data("frame \(index) failed\n".utf8))
        exit(1)
    }
}
print(written)
