const path = require("node:path");

const COMMANDS = new Set(["download", "profile", "favorites"]);

function cliUsage() {
  return [
    "挖红薯命令行用法：",
    "  挖红薯-CLI.exe download <小红书链接> [--output-dir=<目录>] [--json]",
    "  挖红薯-CLI.exe profile <博主主页链接> [--limit 3 | --all] [--resume] [--dry-run] [--list] [--output-dir=<目录>] [--json | --jsonl]",
    "  挖红薯-CLI.exe favorites <收藏页链接> [--limit 3 | --all] [--resume] [--dry-run] [--list] [--output-dir=<目录>] [--json | --jsonl]",
    "  挖红薯-CLI.exe --help",
    "  挖红薯-CLI.exe --version",
    "",
    "CLI 与图形界面共用登录状态、设置和下载核心。",
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
  let resume = false;
  let dryRun = false;
  let all = false;
  let limitSpecified = false;
  let jsonl = false;
  let list = false;
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--json") {
      json = true;
    } else if (value === "--jsonl") {
      json = true;
      jsonl = true;
    } else if (value === "--resume") {
      resume = true;
    } else if (value === "--dry-run") {
      dryRun = true;
    } else if (value === "--all") {
      all = true;
    } else if (value === "--list") {
      list = true;
    } else if (value === "--limit") {
      const parsed = Number(args[++index]);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
        throw new Error("--limit 必须是 1 到 1000 之间的整数");
      }
      limit = parsed;
      limitSpecified = true;
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
  if (all && limitSpecified) {
    throw new Error("--all 和 --limit 不能同时使用");
  }
  if (
    (limitSpecified || resume || dryRun || all || list) &&
    command === "download"
  ) {
    throw new Error("批量选项只适用于博主主页和收藏页任务");
  }
  if (list && !dryRun) {
    throw new Error("--list 需要和 --dry-run 一起使用");
  }
  return {
    command,
    url,
    limit: all ? null : limit,
    outputDirectory,
    json,
    jsonl,
    resume,
    dryRun,
    all,
    list,
  };
}

module.exports = {
  cliUsage,
  parseCliInvocation,
};
