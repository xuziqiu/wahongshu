const path = require("node:path");

const COMMANDS = new Set(["download", "profile", "favorites"]);

function cliUsage() {
  return [
    "挖红薯命令行用法：",
    "  挖红薯.exe download <小红书链接> [--limit 3] [--output-dir=<目录>] [--json]",
    "  挖红薯.exe profile <博主主页链接> [--limit 3] [--output-dir=<目录>] [--json]",
    "  挖红薯.exe favorites <收藏页链接> [--limit 3] [--output-dir=<目录>] [--json]",
    "  挖红薯.exe --help",
    "  挖红薯.exe --version",
    "",
    "不带命令行参数时仍然打开图形界面。CLI 与图形界面共用登录状态和设置。",
  ].join("\n");
}

function parseCliInvocation(argv, defaultApp = false) {
  const args = argv.slice(defaultApp ? 2 : 1);
  if (!args.length) return null;
  if (["--help", "-h", "help"].includes(args[0])) return { help: true };
  if (["--version", "-v", "version"].includes(args[0])) {
    return { version: true };
  }
  const command = args[0].toLowerCase();
  if (!COMMANDS.has(command)) {
    throw new Error(`无法识别的命令：${args[0]}。请使用 --help 查看用法`);
  }

  let url = "";
  let limit = 3;
  let outputDirectory = "";
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--json") {
      json = true;
    } else if (value === "--limit") {
      const parsed = Number(args[++index]);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
        throw new Error("--limit 必须是 1 到 1000 之间的整数");
      }
      limit = parsed;
    } else if (value.startsWith("--output-dir=")) {
      outputDirectory = value.slice("--output-dir=".length);
      if (!outputDirectory) {
        throw new Error("--output-dir 后面需要填写目录");
      }
      outputDirectory = path.resolve(outputDirectory);
    } else if (value.startsWith("-")) {
      throw new Error(`无法识别的参数：${value}`);
    } else if (!url) {
      url = value;
    } else {
      throw new Error(`多余的参数：${value}`);
    }
  }
  if (!url) throw new Error(`${command} 命令需要一个小红书链接`);
  return { command, url, limit, outputDirectory, json };
}

module.exports = {
  cliUsage,
  parseCliInvocation,
};
