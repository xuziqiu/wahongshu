const fs = require("node:fs");
const path = require("node:path");

const { safeFolderSegment } = require("./batch_output");

const MANIFEST_DIRECTORY = "_manifests";
const BATCH_MANIFEST = "batch_manifest.json";

function rewriteMediaFileNames(value, names) {
  if (Array.isArray(value)) {
    for (const item of value) rewriteMediaFileNames(item, names);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "media_file" && typeof item === "string" && names.has(item)) {
      value[key] = names.get(item);
    } else {
      rewriteMediaFileNames(item, names);
    }
  }
}

function flattenedMediaName(title, noteId, originalName, fallbackIndex) {
  const extension = path.extname(originalName);
  const stem = path.basename(originalName, extension);
  const suffix = stem.match(/_(\d{2})(_Live)?$/i)?.[0] ||
    `_${String(fallbackIndex).padStart(2, "0")}`;
  return `${safeFolderSegment(title, "无标题")}_[${noteId}]${suffix}${extension}`;
}

function noteDirectories(batchRoot, fileSystem = fs) {
  return fileSystem
    .readdirSync(batchRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name !== MANIFEST_DIRECTORY,
    )
    .map((entry) => path.join(batchRoot, entry.name));
}

function flattenNoteDirectory(batchRoot, noteDirectory, fileSystem = fs) {
  const manifestPath = path.join(noteDirectory, "manifest.json");
  const manifest = JSON.parse(fileSystem.readFileSync(manifestPath, "utf8"));
  const noteId = String(manifest?.note_id || "").trim().toLowerCase();
  if (!/^[0-9a-f]{24}$/.test(noteId)) {
    throw new Error(`Invalid note id in ${manifestPath}`);
  }
  const files = fileSystem
    .readdirSync(noteDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "manifest.json")
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  if (!files.length) throw new Error(`No media files in ${noteDirectory}`);

  const names = new Map();
  const destinations = new Set();
  for (let index = 0; index < files.length; index += 1) {
    const newName = flattenedMediaName(
      manifest.title,
      noteId,
      files[index].name,
      index + 1,
    );
    if (destinations.has(newName)) {
      throw new Error(`Duplicate flattened filename: ${newName}`);
    }
    destinations.add(newName);
    names.set(files[index].name, newName);
  }

  const metadataRoot = path.join(batchRoot, MANIFEST_DIRECTORY);
  fileSystem.mkdirSync(metadataRoot, { recursive: true });
  const priorMarker = `_[${noteId}]_`;
  for (const entry of fileSystem.readdirSync(batchRoot, {
    withFileTypes: true,
  })) {
    if (entry.isFile() && entry.name.includes(priorMarker)) {
      fileSystem.unlinkSync(path.join(batchRoot, entry.name));
    }
  }
  for (const file of files) {
    const source = path.join(noteDirectory, file.name);
    const destination = path.join(batchRoot, names.get(file.name));
    if (fileSystem.existsSync(destination)) fileSystem.unlinkSync(destination);
    fileSystem.renameSync(source, destination);
  }
  rewriteMediaFileNames(manifest, names);
  manifest.batch_media_directory = ".";
  const metadataPath = path.join(metadataRoot, `${noteId}.json`);
  const temporaryPath = `${metadataPath}.tmp`;
  fileSystem.writeFileSync(
    temporaryPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  if (fileSystem.existsSync(metadataPath)) fileSystem.unlinkSync(metadataPath);
  fileSystem.renameSync(temporaryPath, metadataPath);
  fileSystem.unlinkSync(manifestPath);
  const remaining = fileSystem.readdirSync(noteDirectory);
  if (remaining.length) {
    throw new Error(
      `Refusing to remove non-empty note directory: ${remaining.join(", ")}`,
    );
  }
  fileSystem.rmdirSync(noteDirectory);
  return {
    noteId,
    title: manifest.title,
    mediaFiles: [...names.values()],
    manifestFile: path.relative(batchRoot, metadataPath),
  };
}

function writeBatchManifest(batchRoot, records, fileSystem = fs) {
  const manifestPath = path.join(batchRoot, BATCH_MANIFEST);
  const value = {
    version: 1,
    updated_at_utc: new Date().toISOString(),
    note_count: records.length,
    media_count: records.reduce(
      (total, record) => total + record.mediaFiles.length,
      0,
    ),
    notes: records,
  };
  const temporaryPath = `${manifestPath}.tmp`;
  fileSystem.writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  if (fileSystem.existsSync(manifestPath)) fileSystem.unlinkSync(manifestPath);
  fileSystem.renameSync(temporaryPath, manifestPath);
  return value;
}

function rebuildBatchManifest(batchRoot, fileSystem = fs) {
  const records = [];
  const metadataRoot = path.join(batchRoot, MANIFEST_DIRECTORY);
  if (fileSystem.existsSync(metadataRoot)) {
    for (const entry of fileSystem.readdirSync(metadataRoot, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || path.extname(entry.name) !== ".json") continue;
      const manifest = JSON.parse(
        fileSystem.readFileSync(path.join(metadataRoot, entry.name), "utf8"),
      );
      const mediaFiles = [];
      (function collect(value) {
        if (Array.isArray(value)) return value.forEach(collect);
        if (!value || typeof value !== "object") return;
        for (const [key, item] of Object.entries(value)) {
          if (key === "media_file" && typeof item === "string") {
            mediaFiles.push(item);
          } else {
            collect(item);
          }
        }
      })(manifest);
      records.push({
        noteId: manifest.note_id,
        title: manifest.title,
        mediaFiles: [...new Set(mediaFiles)],
        manifestFile: path.relative(
          batchRoot,
          path.join(metadataRoot, entry.name),
        ),
      });
    }
  }
  records.sort((left, right) => left.noteId.localeCompare(right.noteId));
  return writeBatchManifest(batchRoot, records, fileSystem);
}

function flattenBatchDirectory(batchRoot, fileSystem = fs) {
  for (const directory of noteDirectories(batchRoot, fileSystem)) {
    flattenNoteDirectory(batchRoot, directory, fileSystem);
  }
  return rebuildBatchManifest(batchRoot, fileSystem);
}

module.exports = {
  BATCH_MANIFEST,
  MANIFEST_DIRECTORY,
  flattenBatchDirectory,
  flattenNoteDirectory,
  flattenedMediaName,
  rebuildBatchManifest,
  rewriteMediaFileNames,
};
