// spec-v0.1.309 (VIDEO-LORA-02) wrote the File record as `object.and(z.any())` (the made_audience / lock conditional), so the generated `File` is a
// ZodIntersection and has no `.shape` or `.extend`. Home reads the field shapes (media_type, storage_path, kind) and extends the record for a route's
// response; both need the strict object itself, which is the intersection's left side. One definition here, so the five readers do not each reach into Zod.
import { File } from "@maipai/spec/gen/ts/file.js";
import type { z } from "zod";

type FileObjectOf<T> = T extends z.ZodIntersection<infer Left, z.ZodAny> ? Left : T;
export const FileObject = ((File as unknown as { _zod?: { def?: { left?: unknown } } })._zod?.def?.left ?? File) as FileObjectOf<typeof File>;
