const fs = require("node:fs");
const path = require("node:path");

const MIN_ZOOM_PERCENT = 50;
const MAX_ZOOM_PERCENT = 200;

function normalizeZoomPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 100;
  return Math.max(
    MIN_ZOOM_PERCENT,
    Math.min(MAX_ZOOM_PERCENT, Math.round(numeric / 10) * 10),
  );
}

function normalizeSettings(value, defaultDownloadDirectory) {
  const candidate = String(value?.downloadDirectory || "").trim();
  return {
    version: 1,
    downloadDirectory:
      candidate && path.isAbsolute(candidate)
        ? path.normalize(candidate)
        : path.normalize(defaultDownloadDirectory),
    browserZoomPercent: normalizeZoomPercent(value?.browserZoomPercent),
  };
}

function createSettingsStore({
  filePath,
  defaultDownloadDirectory,
  fileSystem = fs,
}) {
  function load() {
    try {
      const parsed = JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
      return normalizeSettings(parsed, defaultDownloadDirectory);
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
        console.warn("[settings] 无法读取偏好设置：", error.message);
      }
      return normalizeSettings({}, defaultDownloadDirectory);
    }
  }

  function save(value) {
    const normalized = normalizeSettings(value, defaultDownloadDirectory);
    fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    fileSystem.writeFileSync(
      temporaryPath,
      `${JSON.stringify(normalized, null, 2)}\n`,
      "utf8",
    );
    try {
      fileSystem.renameSync(temporaryPath, filePath);
    } catch (error) {
      if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
      fileSystem.rmSync(filePath, { force: true });
      fileSystem.renameSync(temporaryPath, filePath);
    }
    return normalized;
  }

  return { load, save };
}

module.exports = {
  MAX_ZOOM_PERCENT,
  MIN_ZOOM_PERCENT,
  createSettingsStore,
  normalizeSettings,
  normalizeZoomPercent,
};
