const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { flattenBatchDirectory } = require("../flat_batch");

test("flattens note media with collision-safe names and keeps manifests", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wahongshu-flat-"));
  try {
    const noteId = "6a69b86b0000000001000f92";
    fs.writeFileSync(path.join(root, `旧标题_[${noteId}]_03.jpg`), "stale");
    const noteRoot = path.join(root, `同名标题_[${noteId}]`);
    fs.mkdirSync(noteRoot);
    fs.writeFileSync(path.join(noteRoot, "同名标题_01.webp"), "image");
    fs.writeFileSync(path.join(noteRoot, "同名标题_01_Live.mp4"), "video");
    fs.writeFileSync(
      path.join(noteRoot, "manifest.json"),
      JSON.stringify({
        note_id: noteId,
        title: "同名标题",
        images: [
          {
            media_file: "同名标题_01.webp",
            live_stream: { media_file: "同名标题_01_Live.mp4" },
          },
        ],
      }),
    );

    const batch = flattenBatchDirectory(root);
    assert.equal(batch.note_count, 1);
    assert.equal(batch.media_count, 2);
    assert.equal(fs.existsSync(noteRoot), false);
    assert.equal(
      fs.existsSync(path.join(root, `同名标题_[${noteId}]_01.webp`)),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(root, `旧标题_[${noteId}]_03.jpg`)),
      false,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "_manifests", `${noteId}.json`)),
    );
    assert.equal(
      manifest.images[0].live_stream.media_file,
      `同名标题_[${noteId}]_01_Live.mp4`,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});
