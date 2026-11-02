// spec-v0.1.309 (VIDEO-LORA-02) wrote the File record as `object.and(z.any())` (the made_audience / lock conditional), so the generated `File` is a
// ZodIntersection and has no `.shape` or `.extend`. Home reads the field shapes (media_type, storage_path, kind) and extends the record for a route's
// response; both need the strict object itself, which is the intersection's left side. One definition here, so the five readers do not each reach into Zod.
import { File } from "@maipai/spec/gen/ts/file.js";
import type { z } from "zod";

type FileObjectOf<T> = T extends z.ZodIntersection<infer Left, z.ZodAny> ? Left : T;
const left = (File as unknown as { _zod?: { def?: { left?: unknown } } })._zod?.def?.left;
// Loud at import, never a silent fallback: a Zod or spec change that moves the object must fail here, not at the first response.
if (!left) throw new Error("The File record is no longer an intersection with an object on its left; update lib/fileRecordObject.ts to the new shape.");
export const FileObject = left as FileObjectOf<typeof File>;
