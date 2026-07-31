const assert = require("node:assert/strict");
const test = require("node:test");

const {
  openStandaloneNotePage,
  resolveBatchNoteUrl,
  waitForRenderedNote,
} = require("../page_workflow");

const NOTE_ID = "6a5c69ab000000000f02b320";
const LIST_URL = "https://www.xiaohongshu.com/user/profile/test?tab=fav";

test("reloads a modal note URL as a standalone document", async () => {
  const url = `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=secret`;
  const loaded = [];
  const contents = {
    url,
    getURL() {
      return this.url;
    },
    async loadURL(nextUrl) {
      loaded.push(nextUrl);
      this.url = nextUrl;
    },
  };

  const result = await openStandaloneNotePage(
    contents,
    NOTE_ID,
    new AbortController().signal,
  );

  assert.equal(result, url);
  assert.deepEqual(loaded, [url]);
});

test("resolves the requested card URL and reads the matching note state", async () => {
  let resolveAttempts = 0;
  let noteAttempts = 0;
  const scripts = [];
  const contents = {
    url: LIST_URL,
    getURL() {
      return this.url;
    },
    async loadURL(url) {
      this.url = url;
    },
    async executeJavaScript(script) {
      scripts.push(script);
      if (script.includes("const matches")) {
        resolveAttempts += 1;
        return resolveAttempts >= 2
          ? `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=secret`
          : "";
      }
      if (script.includes("const candidates")) {
        noteAttempts += 1;
        return noteAttempts >= 2
          ? JSON.stringify({ noteId: NOTE_ID, type: "normal", imageList: [{}] })
          : null;
      }
      return true;
    },
  };
  const signal = new AbortController().signal;
  const noWait = async () => {};

  const resolvedUrl = await resolveBatchNoteUrl(contents, LIST_URL, NOTE_ID, signal, {
    timeout: 1000,
    wait: noWait,
  });
  const serialized = await waitForRenderedNote(contents, NOTE_ID, signal, {
    timeout: 1000,
    wait: noWait,
  });

  assert.equal(JSON.parse(serialized).noteId, NOTE_ID);
  assert.match(resolvedUrl, /xsec_token=secret/);
  assert.equal(resolveAttempts, 2);
  assert.equal(noteAttempts, 2);
  assert(scripts.some((script) => script.includes("scrollHeight")));
});

test("stops batch navigation immediately on a safety-verification page", async () => {
  const contents = {
    url: LIST_URL,
    getURL() {
      return this.url;
    },
    async loadURL() {
      this.url =
        "https://www.xiaohongshu.com/website-login/captcha?verifyType=124";
    },
    async executeJavaScript() {
      return true;
    },
  };
  await assert.rejects(
    resolveBatchNoteUrl(
      contents,
      LIST_URL,
      NOTE_ID,
      new AbortController().signal,
      { wait: async () => {} },
    ),
    /安全验证/,
  );
});

test("honors cancellation before reading note state", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    waitForRenderedNote(
      {
        getURL: () => LIST_URL,
        executeJavaScript: async () => null,
      },
      NOTE_ID,
      controller.signal,
      { wait: async () => {} },
    ),
    /任务已停止/,
  );
});
