const assert = require("node:assert/strict");
const test = require("node:test");

const { shouldPauseBatch, taskErrorCode } = require("../task_errors");

test("classifies authentication gates for an AI caller", () => {
  assert.equal(taskErrorCode("请先在内置浏览器完成小红书安全验证"), "AUTH_REQUIRED");
  assert.equal(taskErrorCode("请先在内置浏览器登录小红书"), "LOGIN_REQUIRED");
  assert.equal(shouldPauseBatch("请先在内置浏览器完成小红书安全验证"), true);
  assert.equal(shouldPauseBatch("媒体返回 404"), false);
});
