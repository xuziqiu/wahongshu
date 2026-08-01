const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { completedNoteIds } = require("../resume");

test("reads completed note ids only from valid manifests", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wahongshu-resume-"));
  try {
    const complete = path.join(root, "complete");
    const invalid = path.join(root, "invalid");
    const partial = path.join(root, "partial");
    fs.mkdirSync(complete);
    fs.mkdirSync(invalid);
    fs.mkdirSync(partial);
    fs.writeFileSync(
      path.join(complete, "manifest.json"),
      JSON.stringify({ note_id: "6a69b86b0000000001000f92" }),
    );
    fs.writeFileSync(path.join(invalid, "manifest.json"), "not json");

    assert.deepEqual(
      [...completedNoteIds(root)],
      ["6a69b86b0000000001000f92"],
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});
