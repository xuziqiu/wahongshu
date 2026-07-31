const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  normalizeSettings,
  normalizeZoomPercent,
} = require("../settings_store");

test("normalizes browser zoom to ten-percent steps within safe bounds", () => {
  assert.equal(normalizeZoomPercent(116), 120);
  assert.equal(normalizeZoomPercent(20), 50);
  assert.equal(normalizeZoomPercent(999), 200);
  assert.equal(normalizeZoomPercent("invalid"), 100);
});

test("falls back to the default absolute download directory", () => {
  const fallback = path.resolve("default-downloads");
  assert.deepEqual(normalizeSettings({}, fallback), {
    version: 1,
    downloadDirectory: fallback,
    browserZoomPercent: 100,
  });
  assert.equal(
    normalizeSettings({ downloadDirectory: "relative" }, fallback)
      .downloadDirectory,
    fallback,
  );
});
