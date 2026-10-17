import { registerOfflineProvider } from "./registry";
import { mediaOfflineProvider } from "./media";

registerOfflineProvider(mediaOfflineProvider);
