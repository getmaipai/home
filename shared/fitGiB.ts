const GIB = 1024 ** 3;

export function formatFileGiB(bytes: number): string {
  // Byte counts cannot represent most decimal GiB values exactly. Treat
  // half a byte of conversion noise as the intended decimal boundary.
  const rounded = Math.ceil((bytes - 0.5) / GIB * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
