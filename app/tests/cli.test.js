const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  cliUsage,
  parseCliInvocation,
  readCliInvocationArguments,
} = require("../cli");

test("reads bridged CLI arguments without exposing the URL to Electron", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wahongshu-cli-"));
  try {
    const invocationFile = path.join(directory, "invocation.json");
    const expected = [
      "favorites",
      "https://www.xiaohongshu.com/user/profile/test?tab=fav",
      "--dry-run",
      "--json",
    ];
    fs.writeFileSync(invocationFile, JSON.stringify(expected), "utf8");
    assert.deepEqual(readCliInvocationArguments(invocationFile), expected);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("opens the GUI when no CLI command is present", () => {
  assert.equal(parseCliInvocation(["挖红薯.exe"]), null);
});

test("provides command-specific help in both common forms", () => {
  const direct = parseCliInvocation([
    "挖红薯-CLI.exe",
    "profile",
    "--help",
  ]);
  const topic = parseCliInvocation([
    "挖红薯-CLI.exe",
    "help",
    "favorites",
  ]);
  assert.deepEqual(direct, { help: true, helpCommand: "profile" });
  assert.deepEqual(topic, { help: true, helpCommand: "favorites" });
  assert.match(cliUsage("profile"), /--all/);
  assert.match(cliUsage("favorites"), /我的收藏页/);
});

test("rejects an unknown help topic", () => {
  assert.throws(
    () => parseCliInvocation(["挖红薯-CLI.exe", "help", "unknown"]),
    /无法识别的帮助主题/,
  );
});

test("parses a JSON single-note download", () => {
  const invocation = parseCliInvocation([
    "挖红薯.exe",
    "download",
    "https://www.xiaohongshu.com/explore/6a5c69ab000000000f02b320",
    "--json",
  ]);
  assert.equal(invocation.command, "download");
  assert.equal(invocation.json, true);
});

test("parses development Electron arguments after the app directory", () => {
  const invocation = parseCliInvocation(
    [
      "electron.exe",
      ".",
      "favorites",
      "https://www.xiaohongshu.com/user/profile/test?tab=fav",
    ],
    true,
  );
  assert.equal(invocation.command, "favorites");
  assert.equal(invocation.limit, 3);
});

test("parses an explicit batch resume without changing the default", () => {
  const resumed = parseCliInvocation([
    "挖红薯.exe",
    "profile",
    "--resume",
    "--dry-run",
    "https://www.xiaohongshu.com/user/profile/test",
  ]);
  const normal = parseCliInvocation([
    "挖红薯.exe",
    "profile",
    "https://www.xiaohongshu.com/user/profile/test",
  ]);
  assert.equal(resumed.resume, true);
  assert.equal(resumed.dryRun, true);
  assert.equal(normal.resume, false);
  assert.equal(normal.dryRun, false);
});

test("parses all-post and JSONL modes for an AI caller", () => {
  const invocation = parseCliInvocation([
    "挖红薯.exe",
    "profile",
    "--all",
    "--jsonl",
    "--dry-run",
    "--list",
    "https://www.xiaohongshu.com/user/profile/test",
  ]);
  assert.equal(invocation.all, true);
  assert.equal(invocation.limit, null);
  assert.equal(invocation.json, true);
  assert.equal(invocation.jsonl, true);
  assert.equal(invocation.dryRun, true);
  assert.equal(invocation.list, true);
});

test("rejects an ambiguous all-post limit", () => {
  assert.throws(
    () =>
      parseCliInvocation([
        "挖红薯.exe",
        "profile",
        "--all",
        "--limit",
        "10",
        "https://www.xiaohongshu.com/user/profile/test",
      ]),
    /不能同时使用/,
  );
});

test("rejects resume for a single-note command", () => {
  assert.throws(
    () =>
      parseCliInvocation([
        "挖红薯.exe",
        "download",
        "--resume",
        "https://www.xiaohongshu.com/explore/test",
      ]),
    /只适用于博主主页和收藏页/,
  );
});

test("rejects meaningless batch limits for a single note", () => {
  assert.throws(
    () =>
      parseCliInvocation([
        "挖红薯.exe",
        "download",
        "--limit",
        "1",
        "https://www.xiaohongshu.com/explore/test",
      ]),
    /只适用于博主主页和收藏页/,
  );
});

test("only emits a full item list for an explicit dry run", () => {
  assert.throws(
    () =>
      parseCliInvocation([
        "挖红薯.exe",
        "profile",
        "--list",
        "https://www.xiaohongshu.com/user/profile/test",
      ]),
    /需要和 --dry-run 一起使用/,
  );
});

test("parses an output directory as one Electron-safe argument", () => {
  const invocation = parseCliInvocation([
    "挖红薯.exe",
    "download",
    "https://www.xiaohongshu.com/explore/6a5c69ab000000000f02b320",
    "--output-dir=D:\\Media\\挖红薯",
  ]);
  assert.equal(invocation.outputDirectory, "D:\\Media\\挖红薯");
});

test("rejects invalid limits", () => {
  assert.throws(
    () =>
      parseCliInvocation([
        "挖红薯.exe",
        "profile",
        "https://www.xiaohongshu.com/user/profile/test",
        "--limit",
        "0",
      ]),
    /1 到 1000/,
  );
});

test("rejects an unknown command instead of unexpectedly opening the GUI", () => {
  assert.throws(
    () => parseCliInvocation(["挖红薯.exe", "downlod"]),
    /无法识别的命令/,
  );
});
