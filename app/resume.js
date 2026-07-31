const fs = require("node:fs");
const path = require("node:path");

function completedNoteIds(outputRoot, fileSystem = fs) {
  const noteIds = new Set();
  let entries = [];
  try {
    entries = fileSystem.readdirSync(outputRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return noteIds;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(outputRoot, entry.name, "manifest.json");
    try {
      const manifest = JSON.parse(fileSystem.readFileSync(manifestPath, "utf8"));
      const noteId = String(manifest?.note_id || "").trim().toLowerCase();
      if (/^[0-9a-f]{24}$/.test(noteId)) noteIds.add(noteId);
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
  }
  return noteIds;
}

module.exports = { completedNoteIds };
