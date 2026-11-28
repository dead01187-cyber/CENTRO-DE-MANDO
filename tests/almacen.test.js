// La extensión pide "unlimitedStorage": sin eso chrome.storage.local se llena a los 10 MB
// y los robots fallan con "Resource::kQuotaBytes quota exceeded" (le pasó a Carpi).
const test = require("node:test");
const assert = require("node:assert/strict");
test("el manifest pide unlimitedStorage", () => {
  assert.ok(require("../manifest.json").permissions.includes("unlimitedStorage"));
});
