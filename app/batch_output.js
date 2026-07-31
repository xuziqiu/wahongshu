const path = require("node:path");

function safeFolderSegment(value, fallback) {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

function batchOutputDirectory(baseDirectory, page, sourceTitle) {
  if (page.type === "profile") {
    const name = safeFolderSegment(sourceTitle, "博主");
    const id = safeFolderSegment(page.profileId, "未知主页");
    return path.join(baseDirectory, `${name}_[${id}]`);
  }
  if (page.type === "favorites") {
    const id = safeFolderSegment(page.profileId, "我的账号");
    return path.join(baseDirectory, `我的收藏_[${id}]`);
  }
  return baseDirectory;
}

module.exports = { batchOutputDirectory, safeFolderSegment };
