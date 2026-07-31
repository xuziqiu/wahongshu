const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

require("./media_core.js");
const media = globalThis.WahongshuMedia;

const NOTE_ID = /^[0-9a-f]{24}$/i;

function normalizeNavigationUrl(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("请输入小红书链接");
  const explicitUrl = text.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  let candidate = explicitUrl || text.split(/\s+/)[0];
  candidate = candidate.replace(/[)\]}>，。！？；、]+$/u, "");
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("这个链接格式无法识别");
  }
  const hostname = url.hostname.toLowerCase();
  const isXiaohongshu =
    hostname === "xiaohongshu.com" ||
    hostname.endsWith(".xiaohongshu.com");
  const isShareLink =
    hostname === "xhslink.com" || hostname.endsWith(".xhslink.com");
  if (!isXiaohongshu && !isShareLink) {
    throw new Error("这里只能打开小红书链接");
  }
  url.protocol = "https:";
  return url.toString();
}

function recognizePage(urlText) {
  try {
    const url = new URL(urlText);
    if (!["www.xiaohongshu.com", "xiaohongshu.com"].includes(url.hostname)) {
      return { type: "unsupported", label: "请打开小红书页面" };
    }
    const note = url.pathname.match(
      /\/(?:explore|discovery\/item|search_result)\/([0-9a-f]{24})/i,
    );
    if (note) {
      return {
        type: "single",
        noteId: note[1].toLowerCase(),
        label: "单篇笔记",
      };
    }
    if (/^\/user\/profile\/[^/]+/.test(url.pathname)) {
      const favorites =
        url.searchParams.get("tab") === "fav" ||
        url.hash.includes("fav");
      return {
        type: favorites ? "favorites" : "profile",
        label: favorites ? "我的收藏" : "博主主页",
      };
    }
    return { type: "unsupported", label: "当前不是笔记、主页或收藏页" };
  } catch {
    return { type: "unsupported", label: "页面地址无效" };
  }
}

function noteUrl(noteId, xsecToken = "") {
  const url = new URL(
    `/explore/${noteId}`,
    "https://www.xiaohongshu.com",
  );
  url.searchParams.set("xsec_source", "pc_user");
  if (xsecToken) url.searchParams.set("xsec_token", xsecToken);
  return url.toString();
}

function collectLinksScript() {
  return `(() => {
    const result = [];
    const seen = new Set();
    for (const link of document.querySelectorAll(
      'a[href*="/explore/"],a[href*="/discovery/item/"],a[href*="/search_result/"]'
    )) {
      try {
        const url = new URL(link.href, location.href);
        const match = url.pathname.match(
          /\\/(?:explore|discovery\\/item|search_result)\\/([0-9a-fA-F]{24})/
        );
        if (!match || seen.has(match[1].toLowerCase())) continue;
        seen.add(match[1].toLowerCase());
        const image = link.querySelector("img");
        result.push({
          noteId: match[1].toLowerCase(),
          title: (
            link.getAttribute("title") ||
            image?.getAttribute("alt") ||
            link.innerText ||
            ""
          ).trim().slice(0, 300),
          xsecToken: url.searchParams.get("xsec_token") || "",
          url: url.toString()
        });
      } catch {}
    }
    return result;
  })()`;
}

function extractNoteScript(noteId) {
  return `(() => {
    const wanted = ${JSON.stringify(noteId.toLowerCase())};
    const state = window.__INITIAL_STATE__;
    if (!state) return null;
    const candidates = [];
    const add = (value) => {
      if (!value || typeof value !== "object") return;
      const note = value.note && typeof value.note === "object"
        ? value.note
        : value;
      const id = String(note.noteId || note.note_id || "").toLowerCase();
      if (id && id !== wanted) return;
      const images = note.imageList || note.image_list;
      if (!Array.isArray(images) && note.type !== "video") return;
      try {
        const serialized = JSON.stringify(note);
        let score = serialized.length;
        if (Array.isArray(images)) {
          score += images.length * 10000;
          for (const image of images) {
            if (image?.livePhoto || image?.live_photo) score += 100000;
            if (image?.stream || image?.livePhotoStream || image?.live_photo_stream) {
              score += 200000;
            }
          }
        }
        if (note.video && typeof note.video === "object") score += 300000;
        if (serialized.includes("originVideoKey") || serialized.includes("origin_video_key")) {
          score += 300000;
        }
        if (serialized.includes("masterUrl") || serialized.includes("master_url")) {
          score += 200000;
        }
        candidates.push({ serialized, score });
      } catch {}
    };
    const direct = state?.note?.noteDetailMap?.[wanted];
    add(direct);
    const stack = [state];
    const visited = new WeakSet();
    while (stack.length) {
      const value = stack.pop();
      if (!value || typeof value !== "object" || visited.has(value)) continue;
      visited.add(value);
      if (Array.isArray(value)) {
        stack.push(...value);
        continue;
      }
      const id = String(value.noteId || value.note_id || "").toLowerCase();
      if (id === wanted) add(value);
      stack.push(...Object.values(value));
    }
    candidates.sort((left, right) => right.score - left.score);
    return candidates[0]?.serialized || null;
  })()`;
}

function recordFromNote(noteId, sourceUrl, note, fallbackTitle = "") {
  const user = note.user || note.userInfo || note.user_info || {};
  return {
    noteId,
    title: String(
      note.title ||
        note.displayTitle ||
        note.display_title ||
        note.desc ||
        fallbackTitle ||
        noteId,
    ).trim(),
    author: String(
      user.nickname || user.nick_name || user.name || "",
    ).trim(),
    sourceUrl: media.sanitizeUrl(sourceUrl),
    note,
  };
}

function recordFromPageScript(scriptText, noteId, sourceUrl) {
  if (!scriptText || typeof scriptText !== "string") return null;
  return media.parseNoteHtml(
    `<script>${scriptText}</script>`,
    noteId,
    sourceUrl,
  );
}

function recordFromHtml(html, noteId, sourceUrl) {
  if (!html || typeof html !== "string") return null;
  return media.parseNoteHtml(html, noteId, sourceUrl);
}

function recordQuality(record) {
  if (!record) return -1;
  try {
    const descriptors = media.noteDescriptors(record);
    return descriptors.reduce((score, descriptor) => {
      if (descriptor.kind === "live") return score + 10000;
      if (descriptor.kind === "video") {
        const codecScore = {
          h264: 5000,
          h265: 3000,
          av1: 2000,
          h266: 500,
        }[descriptor.codec] || 0;
        return score + 10000 + codecScore;
      }
      return score + 10;
    }, 0);
  } catch {
    return -1;
  }
}

async function fetchAuthenticatedPage(
  electronSession,
  sourceUrl,
  referer,
  signal,
) {
  const response = await electronSession.fetch(sourceUrl, {
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: referer || "https://www.xiaohongshu.com/",
    },
    signal,
  });
  if (!response.ok) {
    throw new Error(`登录会话读取笔记页面失败（HTTP ${response.status}）`);
  }
  const html = await response.text();
  if (!/window\.__INITIAL_STATE__\s*=/.test(html)) {
    throw new Error("登录会话返回的页面没有笔记状态");
  }
  return html;
}

function basenameFromContentDisposition(value) {
  const encoded = String(value || "").match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {}
  }
  const plain = String(value || "").match(/filename="?([^";]+)"?/i);
  return plain?.[1] || "";
}

async function probeImage(session, candidate, signal) {
  const response = await session.fetch(candidate.url, {
    headers: { Range: "bytes=0-127", Accept: "image/*,*/*;q=0.8" },
    signal,
  });
  if (!response.ok) throw new Error(`媒体返回 ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const detected = media.detectImageType(
    bytes.slice(0, 128),
    response.headers.get("content-type") || "",
  );
  if (detected.kind === "unknown") throw new Error("不是可识别的图片");
  return { ...detected, candidate };
}

async function resolveImage(session, descriptor, signal) {
  let lastError = "没有候选地址";
  for (const candidate of descriptor.candidates || []) {
    try {
      return await probeImage(session, candidate, signal);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`没有可下载的原图地址：${lastError}`);
}

async function writeResponse(response, target, signal, onBytes) {
  if (!response.ok) throw new Error(`媒体返回 ${response.status}`);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.wahongshu-part`;
  await fsp.rm(temporary, { force: true });
  let received = 0;
  const source = Readable.fromWeb(response.body);
  source.on("data", (chunk) => {
    received += chunk.length;
    onBytes?.(received, Number(response.headers.get("content-length") || 0));
  });
  try {
    await pipeline(source, fs.createWriteStream(temporary), { signal });
    await fsp.rm(target, { force: true });
    await fsp.rename(temporary, target);
  } catch (error) {
    await fsp.rm(temporary, { force: true });
    throw error;
  }
}

async function downloadUrl(session, urls, target, signal, onBytes) {
  let lastError = "没有媒体地址";
  for (const url of urls) {
    try {
      const response = await session.fetch(url, { signal });
      await writeResponse(response, target, signal, onBytes);
      return url;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError);
}

function detectMp4VideoCodec(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const text = Buffer.from(data).toString("latin1");
  if (/avc1|avc3/.test(text)) return "h264";
  if (/hvc1|hev1/.test(text)) return "h265";
  if (/av01/.test(text)) return "av1";
  if (/vvc1|vvi1/.test(text)) return "h266";
  if (/ef51/.test(text)) return "ef51";
  return "unknown";
}

async function verifiedVideoUrls(session, urls, signal) {
  const verified = [];
  const errors = [];
  for (const url of urls) {
    try {
      const response = await session.fetch(url, {
        headers: {
          Range: "bytes=0-262143",
          Accept: "video/*,*/*;q=0.8",
        },
        signal,
      });
      if (!response.ok) throw new Error(`媒体返回 ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const signature = String.fromCharCode(...bytes.slice(4, 8));
      if (signature !== "ftyp") throw new Error("响应不是 MP4/MOV 文件");
      const codec = detectMp4VideoCodec(bytes);
      if (codec !== "h264") {
        throw new Error(`视频编码 ${codec} 不是兼容的 H.264`);
      }
      verified.push(url);
    } catch (error) {
      if (signal.aborted) throw error;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!verified.length) {
    throw new Error(`没有有效的视频文件地址：${errors[0] || "未知原因"}`);
  }
  return verified;
}

async function downloadRecord({
  record,
  session,
  downloadsRoot,
  signal,
  onProgress,
}) {
  const safeTitle = media.safeFilename(record.title);
  const folder = path.join(
    downloadsRoot,
    "挖红薯",
    `${safeTitle}_[${record.noteId}]`,
  );
  const descriptors = media.noteDescriptors(record);
  const manifestMedia = [];
  for (let index = 0; index < descriptors.length; index += 1) {
    if (signal.aborted) throw new Error("任务已停止");
    const descriptor = descriptors[index];
    const position = descriptor.index || 1;
    const padded = String(position).padStart(2, "0");
    let filename;
    let sourceUrl;
    let source;
    if (descriptor.kind === "image") {
      const resolved = await resolveImage(session, descriptor, signal);
      filename = `${safeTitle}_${padded}${resolved.extension}`;
      source = resolved.candidate.source;
      sourceUrl = await downloadUrl(
        session,
        [resolved.candidate.url],
        path.join(folder, filename),
        signal,
        (received, total) =>
          onProgress?.({
            mediaIndex: index,
            mediaTotal: descriptors.length,
            filename,
            received,
            total,
          }),
      );
    } else {
      const suffix = descriptor.kind === "live" ? `_${padded}_Live` : "_01";
      filename = `${safeTitle}${suffix}${descriptor.extension}`;
      source = descriptor.source || descriptor.codec;
      const videoUrls = await verifiedVideoUrls(
        session,
        descriptor.urls || [],
        signal,
      );
      sourceUrl = await downloadUrl(
        session,
        videoUrls,
        path.join(folder, filename),
        signal,
        (received, total) =>
          onProgress?.({
            mediaIndex: index,
            mediaTotal: descriptors.length,
            filename,
            received,
            total,
          }),
      );
    }
    manifestMedia.push({
      index: position,
      kind: descriptor.kind,
      media_file: filename,
      source,
      source_url: media.sanitizeUrl(sourceUrl),
      width: descriptor.width,
      height: descriptor.height,
      codec: descriptor.codec,
    });
  }
  const manifest = {
    version: 3,
    note_id: record.noteId,
    title: record.title,
    author: record.author,
    source_url: media.sanitizeUrl(record.sourceUrl),
    downloaded_at_utc: new Date().toISOString(),
    selection_policy:
      "Prefer the best public image object and highest declared public video stream.",
    media: manifestMedia,
  };
  await fsp.writeFile(
    path.join(folder, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  return { folder, mediaCount: manifestMedia.length };
}

module.exports = {
  NOTE_ID,
  normalizeNavigationUrl,
  recognizePage,
  noteUrl,
  collectLinksScript,
  extractNoteScript,
  recordFromNote,
  recordFromPageScript,
  recordFromHtml,
  recordQuality,
  fetchAuthenticatedPage,
  detectMp4VideoCodec,
  downloadRecord,
  basenameFromContentDisposition,
};
