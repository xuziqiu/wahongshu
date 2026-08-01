const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function finalizeRelease({
  projectRoot = path.resolve(__dirname, ".."),
  artifactBaseName = process.env.WAHONGSHU_RELEASE_BASENAME || "挖红薯",
} = {}) {
  const { version } = require(path.join(projectRoot, "package.json"));
  const releaseRoot = path.join(projectRoot, "release");
  const builtExecutablePath = path.join(releaseRoot, `挖红薯-${version}.exe`);
  if (!fs.existsSync(builtExecutablePath)) {
    throw new Error(`Portable executable was not produced: ${builtExecutablePath}`);
  }
  const executableName = `${artifactBaseName}-${version}.exe`;
  const executablePath = path.join(releaseRoot, executableName);
  if (executablePath !== builtExecutablePath) {
    fs.renameSync(builtExecutablePath, executablePath);
  }

  const hash = sha256File(executablePath);
  const checksumPath = `${executablePath}.sha256`;
  fs.writeFileSync(checksumPath, `${hash}  ${executableName}\r\n`, "utf8");

  return { checksumPath, executablePath, hash };
}

if (require.main === module) {
  const result = finalizeRelease();
  console.log(`Release: ${result.executablePath}`);
  console.log(`SHA256: ${result.hash}`);
}

module.exports = { finalizeRelease, sha256File };
