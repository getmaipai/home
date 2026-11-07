import type { Result } from "@/lib/result";
export const MAX_LIBRARY_UPLOAD_BYTES = 500 * 1024 * 1024;

export type UploadResult = Result<{ id: string; name: string; kind: string; media_type: string; size_bytes: number; duplicate: boolean }, 400 | 403 | 413>;
