const fs = require("node:fs");
const path = require("node:path");

function markAsConsoleExecutable(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < 512 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error(`Not a valid PE executable: ${filePath}`);
  }
  const peOffset = bytes.readInt32LE(0x3c);
  const subsystemOffset = peOffset + 92;
  if (subsystemOffset + 1 >= bytes.length) {
    throw new Error(`Invalid PE optional header: ${filePath}`);
  }
  bytes.writeUInt16LE(3, subsystemOffset);
  fs.writeFileSync(filePath, bytes);
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const executableName = context.packager.appInfo.productFilename;
  markAsConsoleExecutable(
    path.join(context.appOutDir, `${executableName}.exe`),
  );
};

module.exports.markAsConsoleExecutable = markAsConsoleExecutable;
