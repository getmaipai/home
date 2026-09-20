// Hardware detection lives in @maipai/core/src/hardware now
// (core-v0.1.0, since it reads no product's data layout). Re-exported so
// every existing @/lib/hardware import keeps working; Home never passes
// `diskPath` (a Stack addition to detectHardware's options), so
// freeDiskBytes/totalDiskBytes stay undefined here, same as before this
// module existed.
export { detectHardware, primaryBudgetBytes, __resetHardwareCacheForTests } from "@maipai/core/src/hardware";
export type { HardwareInfo, CudaDevice } from "@maipai/core/src/hardware";
