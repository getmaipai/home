// A bounded single-file multipart reader for the existing upload endpoint. Header and boundary tails only stay in memory.
import { UploadError } from "@/lib/libraryUploadStream";
export async function libraryMultipart(request: Request): Promise<{ name: string; body: ReadableStream<Uint8Array> }> {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(request.headers.get("content-type") ?? "");
  const token = boundary?.[1] ?? boundary?.[2];
  if (!token || token.length > 200 || /[\r\n]/.test(token) || !request.body) throw new UploadError(400, "Choose a file to add.");
  const reader = request.body.getReader();
  let buffer = Buffer.alloc(0);
  const fail = () => new UploadError(400, "That upload could not be read. Choose one file and add it again.");
  try {
    for (;;) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end >= 0) {
        if (end > 8192) throw fail();
        const header = buffer.subarray(0, end).toString();
        const name = /filename="([^"\r\n]*)"/i.exec(header)?.[1];
        if (!header.startsWith(`--${token}\r\n`) || !/(?:^|;)\s*name="file"/im.test(header.replace(/filename="[^"\r\n]*"/gi, "")) || name === undefined || /^content-type:\s*multipart\//im.test(header)) throw fail();
        buffer = buffer.subarray(end + 4);
        const marker = Buffer.from(`\r\n--${token}`);
        let ended = false;
        return { name, body: new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              for (;;) {
                let at = buffer.indexOf(marker);
                while (at >= 0) {
                  // A prefix is file data until the complete delimiter line is known. The closing line may also
                  // end at EOF, but a suffix such as --NOT_A_DELIMITER is never a closing delimiter.
                  let eof = false;
                  while (buffer.length < at + marker.length + 4) {
                    const part = await reader.read();
                    if (part.done) { eof = true; break; }
                    buffer = Buffer.concat([buffer, part.value]);
                  }
                  const suffix = buffer.subarray(at + marker.length);
                  if (suffix.subarray(0, 2).toString() === "\r\n") throw fail(); // a second part
                  const closing = suffix.subarray(0, 4).toString() === "--\r\n" ||
                    (eof && suffix.toString() === "--");
                  if (closing) {
                    if (at) controller.enqueue(buffer.subarray(0, at));
                    ended = true; await reader.cancel(); reader.releaseLock(); controller.close(); return;
                  }
                  at = buffer.indexOf(marker, at + 1);
                }
                if (buffer.length > marker.length + 4) {
                  const emit = buffer.subarray(0, buffer.length - marker.length - 4);
                  buffer = buffer.subarray(buffer.length - marker.length - 4); controller.enqueue(emit); return;
                }
                const part = await reader.read(); if (part.done) throw fail();
                buffer = Buffer.concat([buffer, part.value]);
              }
            } catch (error) { await reader.cancel().catch(() => {}); reader.releaseLock(); controller.error(error); }
          },
          async cancel() { if (!ended) { await reader.cancel().catch(() => {}); reader.releaseLock(); } },
        }) };
      }
      if (buffer.length > 8192) throw fail();
      const part = await reader.read(); if (part.done) throw fail();
      buffer = Buffer.concat([buffer, part.value]);
    }
  } catch (error) { await reader.cancel().catch(() => {}); reader.releaseLock(); throw error; }
}
