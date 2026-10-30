import { registerOfflineProvider } from "./registry";
import { mediaOfflineProvider } from "./media";
import { referenceOfflineProvider } from "./reference";

registerOfflineProvider(mediaOfflineProvider);
registerOfflineProvider(referenceOfflineProvider);
