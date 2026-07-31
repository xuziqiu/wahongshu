(() => {
  const NOTE_ID = /^[0-9a-fA-F]{24}$/;
  const RESERVED = new Set([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
  ]);

  function safeFilename(value, fallback = "无标题", maxLength = 80) {
    let result = String(value || "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^[ .]+|[ .]+$/g, "");
    if (!result) result = fallback;
    if (RESERVED.has(result.toUpperCase())) result = `_${result}`;
    result = result.slice(0, maxLength).replace(/[ .]+$/g, "");
    return result || fallback;
  }

  function normalizeUrl(value) {
    if (typeof value !== "string" || !value) return "";
    return value.startsWith("http://")
      ? `https://${value.slice("http://".length)}`
      : value;
  }

  function sanitizeUrl(value) {
    try {
      const url = new URL(value);
      for (const key of [
        "xsec_token",
        "token",
        "authorization",
        "cookie",
        "sign",
      ]) {
        if (url.searchParams.has(key)) url.searchParams.set(key, "REDACTED");
      }
      return url.toString();
    } catch {
      return String(value || "");
    }
  }

  function extractBalancedObject(text, marker) {
    const markerPosition = text.indexOf(marker);
    if (markerPosition < 0) throw new Error(`页面缺少 ${marker}`);
    const start = text.indexOf("{", markerPosition + marker.length);
    if (start < 0) throw new Error("页面数据没有起始对象");
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(start, index + 1);
      }
    }
    throw new Error("页面数据不完整");
  }

  function parseInitialState(html) {
    let lastError;
    for (const marker of [
      "window.__INITIAL_STATE__=",
      "window.__INITIAL_STATE__ =",
    ]) {
      try {
        const raw = extractBalancedObject(html, marker).replace(
          /([:\[,]|\b)\s*(?:undefined|NaN|Infinity)(?=\s*[,}\]])/g,
          "$1null",
        );
        return JSON.parse(raw);
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`无法解析笔记页面：${lastError?.message || "未知错误"}`);
  }

  function findNote(state, noteId) {
    const direct = state?.note?.noteDetailMap?.[noteId];
    if (direct && typeof direct === "object") {
      const note = direct.note || direct;
      if (note && typeof note === "object") return note;
    }
    const stack = [state];
    const visited = new WeakSet();
    while (stack.length) {
      const value = stack.pop();
      if (!value || typeof value !== "object") continue;
      if (visited.has(value)) continue;
      visited.add(value);
      if (Array.isArray(value)) {
        stack.push(...value);
        continue;
      }
      const candidateId = value.noteId || value.note_id;
      const images = value.imageList || value.image_list;
      if (
        String(candidateId || "").toLowerCase() === noteId.toLowerCase() &&
        (Array.isArray(images) || value.type === "video")
      ) {
        return value;
      }
      stack.push(...Object.values(value));
    }
    throw new Error(`页面数据中没有找到笔记 ${noteId}`);
  }

  function parseNoteHtml(html, noteId, sourceUrl = "") {
    if (!NOTE_ID.test(noteId)) throw new Error("笔记 ID 无效");
    const state = parseInitialState(html);
    const note = findNote(state, noteId);
    const user = note.user || note.userInfo || {};
    return {
      noteId: noteId.toLowerCase(),
      title: String(note.title || "").trim() || "无标题",
      author: String(user.nickname || user.nickName || "").trim(),
      sourceUrl: sanitizeUrl(sourceUrl),
      note,
    };
  }

  function uniqueUrls(values) {
    const found = [];
    const seen = new Set();
    for (const value of values.flat(Infinity)) {
      const url = normalizeUrl(value);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      found.push(url);
    }
    return found;
  }

  function imageCandidates(image) {
    const candidates = [];
    const fileId = image?.fileId || image?.file_id;
    if (typeof fileId === "string" && fileId) {
      const encoded = fileId
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
      const base = `https://ci.xiaohongshu.com/${encoded}`;
      candidates.push(
        { source: "raw", url: base },
        { source: "jfif", url: `${base}?imageView2/format/jfif` },
        { source: "heic", url: `${base}?imageView2/format/heic` },
      );
    }
    const pageDefault = normalizeUrl(image?.urlDefault || image?.url_default);
    if (pageDefault) {
      candidates.push({ source: "page_default", url: pageDefault });
    }
    return candidates;
  }

  function detectImageType(bytes, contentType = "") {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const ascii = (start, end) =>
      String.fromCharCode(...data.slice(start, end));
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
      return { kind: "jpeg", extension: ".jpg" };
    }
    if (
      data.length >= 8 &&
      ascii(0, 8) === "\x89PNG\r\n\x1a\n"
    ) {
      return { kind: "png", extension: ".png" };
    }
    if (data.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) {
      return { kind: "gif", extension: ".gif" };
    }
    if (
      data.length >= 12 &&
      ascii(0, 4) === "RIFF" &&
      ascii(8, 12) === "WEBP"
    ) {
      return { kind: "webp", extension: ".webp" };
    }
    if (data.length >= 12 && ascii(4, 8) === "ftyp") {
      const brands = ascii(8, Math.min(data.length, 40));
      if (/(avif|avis)/.test(brands)) {
        return { kind: "avif", extension: ".avif" };
      }
      if (/(heic|heix|hevc|hevx|mif1|msf1)/.test(brands)) {
        return { kind: "heic", extension: ".heic" };
      }
    }
    const type = String(contentType || "").toLowerCase();
    if (type.includes("jpeg")) return { kind: "jpeg", extension: ".jpg" };
    if (type.includes("png")) return { kind: "png", extension: ".png" };
    if (type.includes("webp")) return { kind: "webp", extension: ".webp" };
    if (type.includes("heic") || type.includes("heif")) {
      return { kind: "heic", extension: ".heic" };
    }
    if (type.includes("avif")) return { kind: "avif", extension: ".avif" };
    return { kind: "unknown", extension: ".bin" };
  }

  function variantUrls(variant) {
    return uniqueUrls([
      variant?.masterUrl || variant?.master_url,
      variant?.backupUrls || variant?.backup_urls || [],
    ]);
  }

  function livePhotoDescriptor(image, index) {
    if (!image || typeof image !== "object") return null;
    const livePhoto =
      image.livePhoto ||
      image.live_photo ||
      image.isLivePhoto ||
      image.is_live_photo;
    const streams = [
      image.stream,
      image.livePhoto?.stream,
      image.live_photo?.stream,
      image.livePhotoStream,
      image.live_photo_stream,
      image.video?.stream,
    ].filter((stream) => stream && typeof stream === "object");
    if (!livePhoto && !streams.length) return null;
    for (const stream of streams) {
      for (const codec of ["h264", "h265", "av1", "h266"]) {
        const variants = stream[codec];
        if (!Array.isArray(variants)) continue;
        for (const variant of variants) {
          const urls = variantUrls(variant);
          if (!urls.length) continue;
          return {
            kind: "live",
            index,
            urls,
            extension: ".mp4",
            codec,
            qualityType: variant.qualityType || variant.quality_type,
            hdrType: variant.hdrType || variant.hdr_type,
          };
        }
      }
    }
    return null;
  }

  function parseMediaV2(video) {
    const raw = video?.mediaV2;
    if (raw && typeof raw === "object") return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        return {};
      }
    }
    return {};
  }

  function videoDescriptor(note) {
    const video = note?.video;
    if (!video || typeof video !== "object") return null;
    const groups = [];
    const visited = new WeakSet();
    const stack = [video, note];
    const nestedStreams = [];
    while (stack.length) {
      const value = stack.pop();
      if (!value || typeof value !== "object" || visited.has(value)) continue;
      visited.add(value);
      if (Array.isArray(value)) {
        stack.push(...value);
        continue;
      }
      const originKey = value.originVideoKey || value.origin_video_key;
      if (typeof originKey === "string" && originKey) {
      groups.push({
        source: "origin_video_key",
        urls: [`https://sns-video-hw.xhscdn.com/${originKey}`],
        score: 3e17,
      });
      }
      if (["h265", "h264", "av1", "h266"].some(
        (codec) => Array.isArray(value[codec]),
      )) {
        nestedStreams.push(value);
      }
      for (const [key, child] of Object.entries(value)) {
        if (
          typeof child === "string" &&
          /^(?:hd_screencast_stream|default_screencast_stream|masterUrl|master_url|playUrl|play_url|downloadUrl|download_url)$/.test(key) &&
          /^https?:\/\//.test(child)
        ) {
          groups.push({
            source: key,
            urls: [child],
            score: /hd|master|download/i.test(key) ? 7e15 : 6e15,
          });
        }
        if (child && typeof child === "object") stack.push(child);
      }
    }

    const mediaV2 = parseMediaV2(video);
    const mediaV2Video = mediaV2.video || {};
    const opaque = mediaV2Video.opaque1 || {};
    for (const [source, key, score] of [
      ["hd_screencast_stream", "hd_screencast_stream", 5e17],
      ["default_screencast_stream", "default_screencast_stream", 4e17],
    ]) {
      const url = normalizeUrl(opaque[key]);
      if (url) groups.push({ source, urls: [url], score });
    }

    const streams = [
      video?.media?.stream,
      mediaV2Video?.stream,
      ...nestedStreams,
    ].filter((value) => value && typeof value === "object");
    for (const stream of streams) {
      for (const codec of ["h265", "av1", "h264", "h266"]) {
        const variants = stream[codec];
        if (!Array.isArray(variants)) continue;
        for (const variant of variants) {
          const urls = variantUrls(variant);
          if (!urls.length) continue;
          const width = Number(variant.width || 0);
          const height = Number(variant.height || 0);
          const bitrate = Number(
            variant.videoBitrate || variant.video_bitrate || 0,
          );
          const compatibility = {
            h264: 4e18,
            h265: 3e18,
            av1: 2e18,
            h266: 1e18,
          }[codec];
          groups.push({
            source: "declared_stream",
            urls,
            codec,
            width,
            height,
            bitrate,
            score:
              compatibility + width * height * 1_000_000 + bitrate,
          });
        }
      }
    }
    groups.sort((left, right) => right.score - left.score);
    const urls = uniqueUrls(groups.map((group) => group.urls));
    if (!urls.length) return null;
    const selected = groups.find((group) => group.urls.some((url) => urls.includes(url)));
    return {
      kind: "video",
      urls,
      extension: ".mp4",
      source: selected?.source || "declared_stream",
      codec: selected?.codec,
      width: selected?.width,
      height: selected?.height,
      bitrate: selected?.bitrate,
    };
  }

  function noteDescriptors(noteRecord) {
    const note = noteRecord.note || {};
    const noteType = String(note.type || "");
    if (noteType === "video") {
      const video = videoDescriptor(note);
      if (!video) throw new Error("视频笔记没有可用的视频地址");
      return [video];
    }
    const images = note.imageList || note.image_list;
    if (!Array.isArray(images) || !images.length) {
      throw new Error("笔记没有可下载的图片");
    }
    const descriptors = [];
    images.forEach((image, index) => {
      descriptors.push({
        kind: "image",
        index: index + 1,
        candidates: imageCandidates(image),
        width: image.width,
        height: image.height,
        fileId: image.fileId || image.file_id,
      });
      const live = livePhotoDescriptor(image, index + 1);
      if (live) descriptors.push(live);
    });
    return descriptors;
  }

  globalThis.WahongshuMedia = Object.freeze({
    NOTE_ID,
    safeFilename,
    normalizeUrl,
    sanitizeUrl,
    parseInitialState,
    findNote,
    parseNoteHtml,
    imageCandidates,
    detectImageType,
    noteDescriptors,
  });
})();
