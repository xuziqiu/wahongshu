const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { batchOutputDirectory } = require("../batch_output");

test("groups a profile batch by creator name and profile id", () => {
  assert.equal(
    batchOutputDirectory(
      "D:\\Media",
      { type: "profile", profileId: "63e50c030000000027028d2d" },
      "Ooleniya",
    ),
    path.join("D:\\Media", "Ooleniya_[63e50c030000000027028d2d]"),
  );
});

test("keeps a single note at the configured download root", () => {
  assert.equal(
    batchOutputDirectory("D:\\Media", { type: "single" }, "Note"),
    "D:\\Media",
  );
});
