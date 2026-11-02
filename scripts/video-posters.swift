// VIDEO-UI-11: one poster JPEG per Videos package loop (the "Try this" rail draws images; the loops stay beside them). Build-time only:
// `swift scripts/video-posters.swift` (Apple's own decoder, no ffmpeg, no network). Writes <loop>.jpg next to each loops/*.mp4 from the frame at 0.8 s.
import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

let dir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "backend/packages/videos/assets/loops")
let clips = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil).filter { $0.pathExtension == "mp4" }.sorted { $0.path < $1.path }
var failed = 0
for clip in clips {
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: clip))
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = CMTime(seconds: 0.1, preferredTimescale: 600)
    let out = clip.deletingPathExtension().appendingPathExtension("jpg")
    do {
        let image = try generator.copyCGImage(at: CMTime(seconds: 0.8, preferredTimescale: 600), actualTime: nil)
        guard let sink = CGImageDestinationCreateWithURL(out as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { failed += 1; continue }
        CGImageDestinationAddImage(sink, image, [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary)
        if !CGImageDestinationFinalize(sink) { failed += 1 }
    } catch {
        FileHandle.standardError.write(Data("\(clip.lastPathComponent): \(error)\n".utf8))
        failed += 1
    }
}
print("\(clips.count - failed) of \(clips.count) posters written")
exit(failed == 0 ? 0 : 1)
