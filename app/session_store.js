const path = require("node:path");
const fsp = require("node:fs/promises");

const XHS_COOKIE_SUFFIX = "xiaohongshu.com";

function isXhsCookie(cookie) {
  const domain = String(cookie?.domain || "")
    .replace(/^\./, "")
    .toLowerCase();
  return (
    domain === XHS_COOKIE_SUFFIX || domain.endsWith(`.${XHS_COOKIE_SUFFIX}`)
  );
}

function cookieToSetDetails(cookie) {
  if (!isXhsCookie(cookie) || !cookie.name) return null;
  const domain = String(cookie.domain).replace(/^\./, "");
  const cookiePath = String(cookie.path || "/").startsWith("/")
    ? String(cookie.path || "/")
    : `/${cookie.path}`;
  const details = {
    url: `${cookie.secure === false ? "http" : "https"}://${domain}${cookiePath}`,
    name: cookie.name,
    value: String(cookie.value || ""),
    path: cookiePath,
    secure: cookie.secure !== false,
    httpOnly: Boolean(cookie.httpOnly),
  };
  if (!cookie.hostOnly) details.domain = cookie.domain;
  if (cookie.sameSite) details.sameSite = cookie.sameSite;
  if (!cookie.session && Number.isFinite(cookie.expirationDate)) {
    details.expirationDate = cookie.expirationDate;
  }
  return details;
}

function createSessionKeeper({
  electronSession,
  safeStorage,
  filePath,
  fileSystem = fsp,
  debounceMs = 350,
}) {
  let timer = null;
  let backupChain = Promise.resolve();

  async function performBackup() {
    if (!safeStorage.isEncryptionAvailable()) {
      return { saved: false, reason: "encryption-unavailable" };
    }
    const cookies = (await electronSession.cookies.get({})).filter(isXhsCookie);
    const payload = JSON.stringify({ version: 1, cookies });
    const encrypted = safeStorage.encryptString(payload);
    await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    await fileSystem.writeFile(temporaryPath, encrypted);
    try {
      await fileSystem.rename(temporaryPath, filePath);
    } catch (error) {
      if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
      await fileSystem.rm(filePath, { force: true });
      await fileSystem.rename(temporaryPath, filePath);
    }
    return { saved: true, count: cookies.length };
  }

  function backup() {
    backupChain = backupChain.then(performBackup, performBackup);
    return backupChain;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      backup().catch((error) => {
        console.warn("[session] 无法保存登录会话：", error.message);
      });
    }, debounceMs);
    timer.unref?.();
  }

  async function restore() {
    if (!safeStorage.isEncryptionAvailable()) {
      return { restored: false, reason: "encryption-unavailable" };
    }
    let encrypted;
    try {
      encrypted = await fileSystem.readFile(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") return { restored: true, count: 0 };
      throw error;
    }
    const payload = JSON.parse(safeStorage.decryptString(encrypted));
    if (payload?.version !== 1 || !Array.isArray(payload.cookies)) {
      throw new Error("登录会话备份格式无效");
    }
    const details = payload.cookies
      .map(cookieToSetDetails)
      .filter(Boolean);
    const results = await Promise.allSettled(
      details.map((item) => electronSession.cookies.set(item)),
    );
    const count = results.filter((item) => item.status === "fulfilled").length;
    return { restored: true, count, failed: results.length - count };
  }

  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const result = await backup();
    await electronSession.cookies.flushStore();
    return result;
  }

  return { backup, flush, restore, schedule };
}

module.exports = {
  cookieToSetDetails,
  createSessionKeeper,
  isXhsCookie,
};
