// Deterministic local OCR over recipe images using macOS Vision.
// Usage: ocr-images <listfile> <out.jsonl>
// listfile: one absolute image path per line. Output: one JSON object per line
// {"path":..., "lines":[{"text":..., "confidence":...}], "error":?}
import Foundation
import Vision
import CoreGraphics
import ImageIO

let args = CommandLine.arguments
guard args.count >= 3 else { fputs("usage: ocr-images <listfile> <out.jsonl>\n", stderr); exit(2) }
let list = try! String(contentsOfFile: args[1], encoding: .utf8).split(separator: "\n").map(String.init).filter { !$0.isEmpty }
FileManager.default.createFile(atPath: args[2], contents: nil)
let out = FileHandle(forWritingAtPath: args[2])!
func emit(_ obj: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: obj)
  out.write(data); out.write("\n".data(using: .utf8)!)
}
var done = 0
for path in list {
  var rec: [String: Any] = ["path": path]
  let url = URL(fileURLWithPath: path)
  if let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) {
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .fast
    req.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: img, options: [:])
    do {
      try handler.perform([req])
      var lines: [[String: Any]] = []
      for obs in req.results ?? [] {
        if let c = obs.topCandidates(1).first {
          lines.append(["text": c.string, "confidence": Double(c.confidence), "h": Double(obs.boundingBox.height)])
        }
      }
      rec["lines"] = lines
      rec["w"] = img.width; rec["h"] = img.height
    } catch { rec["error"] = "\(error)" }
  } else { rec["error"] = "decode-failed" }
  emit(rec)
  done += 1
  if done % 100 == 0 { fputs("progress \(done)/\(list.count)\n", stderr) }
}
fputs("done \(done)/\(list.count)\n", stderr)
