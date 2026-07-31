const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { finalizeRelease, sha256File } = require("../../scripts/finalize_release");

test("finalizes the portable launcher and writes its checksum", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wahongshu-release-"));
  try {
    const releaseRoot = path.join(projectRoot, "release");
    fs.mkdirSync(releaseRoot);
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ version: "9.8.7" }),
    );

    const executablePath = path.join(releaseRoot, "挖红薯-9.8.7.exe");
    const bytes = Buffer.alloc(512);
    bytes[0] = 0x4d;
    bytes[1] = 0x5a;
    bytes.writeInt32LE(0x80, 0x3c);
    fs.writeFileSync(executablePath, bytes);

    const result = finalizeRelease({ projectRoot });
    const finalized = fs.readFileSync(executablePath);
    assert.equal(finalized.readUInt16LE(0x80 + 92), 3);
    assert.equal(result.hash, sha256File(executablePath));
    assert.equal(
      fs.readFileSync(result.checksumPath, "utf8"),
      `${result.hash}  挖红薯-9.8.7.exe\r\n`,
    );
  } finally {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  }
});

test("can give GitHub release assets an ASCII filename", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wahongshu-release-"));
  try {
    const releaseRoot = path.join(projectRoot, "release");
    fs.mkdirSync(releaseRoot);
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ version: "1.2.3" }),
    );

    const builtPath = path.join(releaseRoot, "挖红薯-1.2.3.exe");
    const bytes = Buffer.alloc(512);
    bytes[0] = 0x4d;
    bytes[1] = 0x5a;
    bytes.writeInt32LE(0x80, 0x3c);
    fs.writeFileSync(builtPath, bytes);

    const result = finalizeRelease({
      artifactBaseName: "WaHongShu",
      projectRoot,
    });
    assert.equal(path.basename(result.executablePath), "WaHongShu-1.2.3.exe");
    assert.equal(fs.existsSync(builtPath), false);
    assert.equal(
      fs.readFileSync(result.checksumPath, "utf8"),
      `${result.hash}  WaHongShu-1.2.3.exe\r\n`,
    );
  } finally {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  }
});
