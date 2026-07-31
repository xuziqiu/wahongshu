const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createGuiConsoleLogger,
  sanitizeConsoleText,
} = require("../console_logger");

test("redacts addresses and authentication values from GUI logs", () => {
  const cleaned = sanitizeConsoleText(
    "GET https://example.test/media?a=1 xsec_token=secret cookie=session",
  );
  assert.equal(cleaned.includes("https://"), false);
  assert.equal(cleaned.includes("secret"), false);
  assert.equal(cleaned.includes("session"), false);
});

test("logs task progress once and filters candidate internals", () => {
  const lines = [];
  const logger = createGuiConsoleLogger({
    write: (line) => lines.push(line),
    now: () => new Date("2026-07-31T12:00:00Z"),
  });
  logger.start("1.1.1");
  const base = {
    browser: { page: { type: "single", label: "单篇笔记" } },
    task: {
      startedAt: 1,
      sourceType: "single",
      status: "running",
      current: 1,
      total: 1,
      currentTitle: "测试笔记",
      detail: "candidate 1 / 3",
    },
  };
  logger.observe(base);
  logger.observe(base);
  logger.observe({
    ...base,
    task: {
      ...base.task,
      status: "success",
      detail: "已完成 1 篇",
      finishedAt: 2,
    },
  });

  assert.equal(lines.filter((line) => line.includes("正在处理")).length, 1);
  assert.equal(lines.some((line) => /candidate/i.test(line)), false);
  assert.equal(lines.some((line) => line.includes("已完成 1 篇")), true);
});
