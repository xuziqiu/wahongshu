const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  cookieToSetDetails,
  createSessionKeeper,
  isXhsCookie,
} = require("../session_store");

test("only treats xiaohongshu domains as login-session cookies", () => {
  assert.equal(isXhsCookie({ domain: ".xiaohongshu.com" }), true);
  assert.equal(isXhsCookie({ domain: "www.xiaohongshu.com" }), true);
  assert.equal(isXhsCookie({ domain: "xiaohongshu.com.example.com" }), false);
});

test("restores a session cookie without turning it into a persistent cookie", () => {
  const details = cookieToSetDetails({
    domain: ".xiaohongshu.com",
    hostOnly: false,
    path: "/",
    name: "session-token",
    value: "secret",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    session: true,
  });
  assert.equal(details.url, "https://xiaohongshu.com/");
  assert.equal(details.value, "secret");
  assert.equal("expirationDate" in details, false);
});

test("backs up only xiaohongshu cookies and restores them from encrypted bytes", async () => {
  const temporary = await fsp.mkdtemp(
    path.join(os.tmpdir(), "wahongshu-session-test-"),
  );
  const filePath = path.join(temporary, "xhs-session.bin");
  const stored = [];
  const sourceCookies = [
    {
      domain: ".xiaohongshu.com",
      hostOnly: false,
      path: "/",
      name: "web_session",
      value: "sensitive-value",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      session: true,
    },
    { domain: ".example.com", name: "ignore", value: "other" },
  ];
  const fakeSession = {
    cookies: {
      async get() {
        return sourceCookies;
      },
      async set(details) {
        stored.push(details);
      },
      async flushStore() {},
    },
  };
  const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, "utf8").reverse(),
    decryptString: (value) => Buffer.from(value).reverse().toString("utf8"),
  };
  const keeper = createSessionKeeper({
    electronSession: fakeSession,
    safeStorage: fakeSafeStorage,
    filePath,
  });
  try {
    const backup = await keeper.flush();
    assert.equal(backup.count, 1);
    const encrypted = await fsp.readFile(filePath, "utf8");
    assert.doesNotMatch(encrypted, /sensitive-value/);
    const restored = await keeper.restore();
    assert.equal(restored.count, 1);
    assert.equal(stored[0].name, "web_session");
    assert.equal(stored[0].value, "sensitive-value");
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});
