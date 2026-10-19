// Adds one file to the Library with real progress. A file under the single-request size goes up as one multipart request (the
// browser reports bytes sent); a bigger one goes through the hub's chunk sessions (8 MB at a time), which keep the server's
// request limit unchanged. Both end in the same kept Library file.
import { ApiError, request } from "@/lib/api";

export interface UploadedFile { id: string; name: string; kind: string; media_type: string; size_bytes: number; duplicate: boolean }
export interface UploadOptions { onProgress?: (sentBytes: number) => void; signal?: AbortSignal }
/** Under the hub's 128 MB request limit with room for the form framing. */
export const SINGLE_REQUEST_MAX_BYTES = 100 * 1024 * 1024;
const GENERIC = "Home could not add that file. Check your connection and try again.";

function fail(status: number, text: string): ApiError {
  let message = GENERIC;
  try { const body = JSON.parse(text) as { error?: string }; if (body.error) message = body.error; } catch { /* keep the plain sentence */ }
  return new ApiError(message, status);
}

function sendMultipart(file: File, options: UploadOptions): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/library/upload");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) options.onProgress?.(event.loaded); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { options.onProgress?.(file.size); resolve(JSON.parse(xhr.responseText) as UploadedFile); }
      else reject(fail(xhr.status, xhr.responseText));
    };
    xhr.onerror = () => reject(new ApiError(GENERIC, 0));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

async function sendChunks(file: File, options: UploadOptions): Promise<UploadedFile> {
  const started = await request<{ upload_id: string; chunk_bytes: number; max_bytes: number }>("/api/library/uploads", { method: "POST", body: JSON.stringify({ name: file.name }) });
  if (file.size > started.max_bytes) {
    await request(`/api/library/uploads/${started.upload_id}`, { method: "DELETE" }).catch(() => {});
    throw new ApiError("That file is bigger than 500 MB. Choose a smaller file.", 413);
  }
  const base = `/api/library/uploads/${started.upload_id}`;
  try {
    for (let offset = 0; offset < file.size; offset += started.chunk_bytes) {
      const chunk = file.slice(offset, offset + started.chunk_bytes);
      const res = await fetch(`${base}?offset=${offset}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/octet-stream" }, body: chunk, ...(options.signal ? { signal: options.signal } : {}) });
      if (!res.ok) throw fail(res.status, await res.text());
      options.onProgress?.(Math.min(file.size, offset + chunk.size));
    }
    return await request<UploadedFile>(`${base}/finish`, { method: "POST" });
  } catch (error) {
    await request(base, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

export function uploadLibraryFile(file: File, options: UploadOptions = {}): Promise<UploadedFile> {
  return file.size <= SINGLE_REQUEST_MAX_BYTES ? sendMultipart(file, options) : sendChunks(file, options);
}
