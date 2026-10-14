import { cachedFetch, __resetPackageCacheForTests } from "@/lib/packageCache";

__resetPackageCacheForTests();
await cachedFetch("weather", { ttl_s: 3600 }, "https://example.invalid/demo-weather", undefined, async () => ({ temperature: 68, condition: "Clear" }), { source: "weather:open-meteo", attribution: "Demo weather data" });
await cachedFetch("currency", { ttl_s: 3600 }, "https://example.invalid/demo-currency", undefined, async () => ({ rate: 1.08 }), { source: "currency:frankfurter", attribution: "Demo currency data" });
