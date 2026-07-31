const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  recognizePage,
  assertAccessiblePage,
  normalizeNavigationUrl,
  noteUrl,
  cleanPageTitle,
  collectLinksScript,
  extractNoteScript,
  recordFromPageScript,
  recordQuality,
  detectMp4VideoCodec,
  downloadRecord,
} = require("../core");

test("normalizes pasted Xiaohongshu URLs and share text", () => {
  assert.equal(
    normalizeNavigationUrl(
      "www.xiaohongshu.com/explore/6a5c69ab000000000f02b320",
    ),
    "https://www.xiaohongshu.com/explore/6a5c69ab000000000f02b320",
  );
  assert.equal(
    normalizeNavigationUrl(
      "复制链接 https://xhslink.com/a/abc123 打开小红书",
    ),
    "https://xhslink.com/a/abc123",
  );
  assert.throws(
    () => normalizeNavigationUrl("https://example.com/not-xhs"),
    /只能打开小红书/,
  );
});

test("recognizes note, profile and favorites pages", () => {
  assert.deepEqual(
    recognizePage(
      "https://www.xiaohongshu.com/explore/6a5c69ab000000000f02b320",
    ).type,
    "single",
  );
  assert.equal(
    recognizePage("https://www.xiaohongshu.com/user/profile/abc").type,
    "profile",
  );
  assert.equal(
    recognizePage("https://www.xiaohongshu.com/user/profile/abc").profileId,
    "abc",
  );
  assert.equal(
    recognizePage(
      "https://www.xiaohongshu.com/user/profile/abc?tab=fav",
    ).type,
    "favorites",
  );
  assert.match(
    recognizePage(
      "https://www.xiaohongshu.com/website-login/captcha?verifyType=124",
    ).label,
    /安全验证/,
  );
  assert.throws(
    () =>
      assertAccessiblePage(
        "https://www.xiaohongshu.com/website-login/captcha?verifyType=124",
      ),
    /安全验证/,
  );
});

test("scripts are scoped to the requested note", () => {
  const id = "6a5c69ab000000000f02b320";
  assert.match(extractNoteScript(id), new RegExp(id));
  assert.match(collectLinksScript(), /querySelectorAll/);
  assert.match(noteUrl(id, "secret"), /xsec_token=secret/);
  assert.match(extractNoteScript(id), /candidates\.sort/);
});

test("removes only the Xiaohongshu suffix from a page title", () => {
  assert.equal(cleanPageTitle("汗水向下，人生向上 - 小红书"), "汗水向下，人生向上");
  assert.equal(cleanPageTitle("标题-保留"), "标题-保留");
});

test("list scanning keeps card order while filling title and token", () => {
  const firstId = "6a5c69ab000000000f02b320";
  const secondId = "6a66ae05000000000401e3aa";
  const originalDocument = global.document;
  const originalLocation = global.location;
  const originalWindow = global.window;
  const makeLink = ({ href, text = "", alt = "", cardTitle = "" }) => ({
    href,
    innerText: text,
    getAttribute(name) {
      return name === "title" ? "" : null;
    },
    querySelector(selector) {
      return selector === "img"
        ? { getAttribute: (name) => (name === "alt" ? alt : null) }
        : null;
    },
    closest() {
      return {
        querySelector(selector) {
          return selector === ".title"
            ? { innerText: cardTitle, textContent: cardTitle }
            : null;
        },
      };
    },
  });
  global.document = {
    querySelectorAll() {
      return [
        makeLink({ href: `https://www.xiaohongshu.com/explore/${secondId}` }),
        makeLink({
          href: `https://www.xiaohongshu.com/explore/${firstId}`,
          cardTitle: "完整标题",
        }),
      ];
    },
  };
  global.location = { href: "https://www.xiaohongshu.com/" };
  global.window = {
    __INITIAL_STATE__: {
      user: {
        notes: {
          _value: [
            [
              {
                noteCard: {
                  noteId: firstId,
                  displayTitle: "第一篇",
                  xsecToken: "first-secret",
                },
              },
              {
                noteCard: {
                  noteId: secondId,
                  displayTitle: "第二篇",
                  xsecToken: "second-secret",
                },
              },
            ],
          ],
        },
      },
    },
  };
  try {
    const result = eval(collectLinksScript());
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((item) => item.noteId), [firstId, secondId]);
    assert.deepEqual(result.map((item) => item.title), ["完整标题", "第二篇"]);
    assert.equal(result[0].xsecToken, "first-secret");
    assert.equal(result[1].xsecToken, "second-secret");
    assert.equal(
      new URL(result[0].url).searchParams.get("xsec_source"),
      "pc_user",
    );
    global.location.href =
      "https://www.xiaohongshu.com/user/profile/test?tab=fav";
    const favoritesResult = eval(collectLinksScript());
    assert.equal(
      new URL(favoritesResult[0].url).searchParams.get("xsec_source"),
      "pc_collect",
    );
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.window = originalWindow;
  }
});

test("downloads static image and Live stream into one note folder", async () => {
  const temporary = await fsp.mkdtemp(
    path.join(os.tmpdir(), "wahongshu-test-"),
  );
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
  const mp4 = Uint8Array.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
    0x61, 0x76, 0x63, 0x31,
  ]);
  const fakeSession = {
    async fetch(url, options = {}) {
      const range = options.headers?.Range;
      const bytes = url.includes("live.mp4") ? mp4 : jpeg;
      return new Response(bytes, {
        status: range ? 206 : 200,
        headers: {
          "Content-Type": url.includes("live.mp4")
            ? "video/mp4"
            : "image/jpeg",
          "Content-Length": String(bytes.length),
        },
      });
    },
  };
  try {
    const result = await downloadRecord({
      record: {
        noteId: "6a5c69ab000000000f02b320",
        title: "Live 测试",
        author: "作者",
        sourceUrl:
          "https://www.xiaohongshu.com/explore/6a5c69ab000000000f02b320",
        note: {
          type: "normal",
          imageList: [
            {
              fileId: "test/image",
              livePhoto: true,
              stream: {
                h264: [
                  {
                    masterUrl:
                      "https://sns-video-hw.xhscdn.com/live.mp4",
                  },
                ],
              },
            },
          ],
        },
      },
      session: fakeSession,
      downloadsRoot: temporary,
      signal: new AbortController().signal,
    });
    const names = fs.readdirSync(result.folder).sort();
    assert.deepEqual(names, [
      "Live 测试_01.jpg",
      "Live 测试_01_Live.mp4",
      "manifest.json",
    ]);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(result.folder, "manifest.json"), "utf8"),
    );
    assert.deepEqual(
      manifest.media.map((item) => item.kind),
      ["image", "live"],
    );
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});

test("finds origin video key nested inside consumer data", () => {
  const media = globalThis.WahongshuMedia;
  const descriptor = media.noteDescriptors({
    noteId: "6a5c69ab000000000f02b320",
    title: "嵌套视频",
    note: {
      type: "video",
      video: {
        consumer: {
          originVideoKey: "origin/nested-video.mp4",
        },
      },
    },
  })[0];
  assert.equal(descriptor.kind, "video");
  assert.equal(
    descriptor.urls[0],
    "https://sns-video-hw.xhscdn.com/origin/nested-video.mp4",
  );
});

test("prefers a playable H.264 stream over opaque screencast URLs", () => {
  const media = globalThis.WahongshuMedia;
  const descriptor = media.noteDescriptors({
    noteId: "6a687d9d000000001002721e",
    title: "兼容性排序",
    note: {
      type: "video",
      video: {
        mediaV2: {
          video: {
            opaque1: {
              hd_screencast_stream: "https://example.com/opaque.mp4",
            },
          },
        },
        media: {
          stream: {
            h264: [
              {
                width: 1280,
                height: 720,
                videoBitrate: 1300000,
                masterUrl: "https://example.com/h264.mp4",
              },
            ],
          },
        },
      },
    },
  })[0];
  assert.equal(descriptor.source, "declared_stream");
  assert.equal(descriptor.codec, "h264");
  assert.equal(descriptor.urls[0], "https://example.com/h264.mp4");
});

test("rates original page script with Live streams above a static runtime card", () => {
  const id = "6a69db02000000000f0056a7";
  const staticRecord = {
    noteId: id,
    title: "Live",
    sourceUrl: `https://www.xiaohongshu.com/explore/${id}`,
    note: {
      noteId: id,
      type: "normal",
      imageList: [{ fileId: "image/one" }],
    },
  };
  const pageScript = `window.__INITIAL_STATE__=${JSON.stringify({
    note: {
      noteDetailMap: {
        [id]: {
          note: {
            noteId: id,
            title: "Live",
            type: "normal",
            imageList: [
              {
                fileId: "image/one",
                livePhoto: true,
                stream: {
                  h264: [
                    { masterUrl: "https://example.com/live.mp4" },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  })}`;
  const sourceRecord = recordFromPageScript(
    pageScript,
    id,
    staticRecord.sourceUrl,
  );
  assert(recordQuality(sourceRecord) > recordQuality(staticRecord));
});

test("rejects the ef51 experimental track marker as non-H.264", () => {
  assert.equal(
    detectMp4VideoCodec(Buffer.from("....ftyp....ef51....", "latin1")),
    "ef51",
  );
  assert.equal(
    detectMp4VideoCodec(Buffer.from("....ftyp....avc1....", "latin1")),
    "h264",
  );
});
