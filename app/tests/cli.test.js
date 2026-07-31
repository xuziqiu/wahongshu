const assert = require("node:assert/strict");
const test = require("node:test");

const { parseCliInvocation } = require("../cli");

test("opens the GUI when no CLI command is present", () => {
  assert.equal(parseCliInvocation(["挖红薯.exe"]), null);
});

test("parses a JSON single-note download", () => {
  const invocation = parseCliInvocation([
    "挖红薯.exe",
    "download",
    "https://www.xiaohongshu.com/explore/6a5c69ab000000000f02b320",
    "--limit",
    "1",
    "--json",
  ]);
  assert.equal(invocation.command, "download");
  assert.equal(invocation.limit, 1);
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
