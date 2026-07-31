const {
  assertAccessiblePage,
  extractNoteScript,
} = require("./core");

const defaultWait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForRenderedNote(
  contents,
  noteId,
  signal,
  { timeout = 20000, wait = defaultWait } = {},
) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (signal.aborted) throw new Error("任务已停止");
    assertAccessiblePage(contents.getURL());
    const serialized = await contents
      .executeJavaScript(extractNoteScript(noteId))
      .catch(() => null);
    if (serialized) return serialized;
    await wait(500);
  }
  throw new Error(`浏览器没有加载出笔记 ${noteId} 的详情`);
}

async function resolveBatchNoteUrl(
  contents,
  listUrl,
  noteId,
  signal,
  { timeout = 45000, wait = defaultWait } = {},
) {
  await contents.loadURL(listUrl);
  await wait(700);
  assertAccessiblePage(contents.getURL());
  await contents.executeJavaScript(
    "window.scrollTo({top:0,behavior:'auto'}); true",
  );
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (signal.aborted) throw new Error("任务已停止");
    assertAccessiblePage(contents.getURL());
    const resolvedUrl = await contents.executeJavaScript(`(() => {
      const wanted = ${JSON.stringify(noteId.toLowerCase())};
      const links = document.querySelectorAll(
        'a[href*="/explore/"],a[href*="/discovery/item/"],a[href*="/search_result/"]'
      );
      const matches = [];
      for (const link of links) {
        try {
          const url = new URL(link.href, location.href);
          const match = url.pathname.match(
            /\\/(?:explore|discovery\\/item|search_result)\\/([0-9a-fA-F]{24})/
          );
          if (match?.[1]?.toLowerCase() !== wanted) continue;
          matches.push(url.toString());
        } catch {}
      }
      return matches.find((url) => new URL(url).searchParams.has("xsec_token")) ||
        matches[0] || "";
    })()`);
    if (resolvedUrl) return resolvedUrl;
    await contents.executeJavaScript(
      "window.scrollTo({top:document.documentElement.scrollHeight,behavior:'smooth'}); true",
    );
    await wait(1200);
  }
  throw new Error(`列表页无法重新定位笔记 ${noteId}`);
}

module.exports = {
  resolveBatchNoteUrl,
  waitForRenderedNote,
};
