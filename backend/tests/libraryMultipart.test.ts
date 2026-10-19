import { expect, test } from "bun:test";
import { libraryMultipart } from "@/lib/libraryMultipart";

const head = (name = "notes.txt") => `--abc\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\n`;
function request(body: string | Uint8Array, chunk: number, contentType = "multipart/form-data; boundary=abc") {
  const data = typeof body === "string" ? new TextEncoder().encode(body) : body; let at = 0;
  return new Request("http://localhost/x", { method: "POST", headers: { "content-type": contentType }, body: new ReadableStream<Uint8Array>({ pull(c) {
    if (at >= data.length) { c.close(); return; }
    c.enqueue(data.slice(at, at + chunk)); at += chunk;
  } }) });
}
async function read(body: string, chunk: number) {
  const parsed = await libraryMultipart(request(body, chunk));
  const parts: Uint8Array[] = []; const reader = parsed.body.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); }
  return { name: parsed.name, text: Buffer.concat(parts).toString() };
}

const lookalikes = [
  "hello\r\n--abc--NOT_A_DELIMITER\r\nworld",
  "hello\r\n--abcd\r\nworld",
  "hello\r\n--abc-x\r\nworld",
  "hello\r\n--ab\r\n--ab",
  "hello\r\n--abc-",
  "hello\r\n--abc--x",
  "\r\n--abc--NOPE",
];
for (const content of lookalikes) for (const chunk of [1, 2, 3, 5, 7, 4096]) test(`boundary lookalike stays file data (chunk ${chunk}): ${JSON.stringify(content)}`, async () => {
  const closing = "\r\n--abc--\r\n";
  expect(await read(head() + content + closing, chunk)).toEqual({ name: "notes.txt", text: content });
});
for (const chunk of [1, 3, 8]) test(`a closing delimiter at end of body without CRLF ends the file (chunk ${chunk})`, async () => {
  expect((await read(head() + "hi\r\n--abc--", chunk)).text).toBe("hi");
});
test("an empty file name and a missing file name are told apart", async () => {
  expect((await read(head("") + "x\r\n--abc--\r\n", 4)).name).toBe("");
  await expect(libraryMultipart(request('--abc\r\nContent-Disposition: form-data; name="file"\r\n\r\nx\r\n--abc--\r\n', 4))).rejects.toMatchObject({ status: 400 });
});
test("a second part, a nested multipart part and an oversized header are refused", async () => {
  const second = await libraryMultipart(request(head() + "x\r\n--abc\r\nContent-Disposition: form-data; name=\"b\"\r\n\r\ny\r\n--abc--\r\n", 5));
  await expect((async () => { const r = second.body.getReader(); for (;;) { const { done } = await r.read(); if (done) return; } })()).rejects.toMatchObject({ status: 400 });
  await expect(libraryMultipart(request('--abc\r\nContent-Disposition: form-data; name="file"; filename="a"\r\nContent-Type: multipart/mixed; boundary=z\r\n\r\nx\r\n--abc--\r\n', 4))).rejects.toMatchObject({ status: 400 });
  await expect(libraryMultipart(request("--abc\r\n" + "X: " + "a".repeat(9000) + "\r\n\r\nx", 1000))).rejects.toMatchObject({ status: 400 });
});
test("a missing or unsafe boundary is refused", async () => {
  await expect(libraryMultipart(request(head() + "x", 4, "multipart/form-data"))).rejects.toMatchObject({ status: 400 });
});
test("only a field named file counts, not a file name of file", async () => {
  await expect(libraryMultipart(request('--abc\r\nContent-Disposition: form-data; name="other"; filename="file"\r\n\r\nx\r\n--abc--\r\n', 4))).rejects.toMatchObject({ status: 400 });
});
