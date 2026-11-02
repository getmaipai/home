// ADULT-LOCK-03: the Home view key every backend test starts with (tests/preload.ts), so an adult job in a test that does not care about the Stack's
// full-view rules (fakes that ignore the headers) never waits on a missing key. A test about the key itself sets its own.
export const DEFAULT_TEST_VIEW_TOKEN = ["pppp", "qqqq", "rrrr", "ssss"].join("-");
