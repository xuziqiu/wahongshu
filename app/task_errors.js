function taskErrorCode(value) {
  const message = value instanceof Error ? value.message : String(value || "");
  if (/安全验证/.test(message)) return "AUTH_REQUIRED";
  if (/登录小红书/.test(message)) return "LOGIN_REQUIRED";
  if (/任务已停止/.test(message)) return "CANCELLED";
  return "DOWNLOAD_FAILED";
}

function shouldPauseBatch(value) {
  return ["AUTH_REQUIRED", "LOGIN_REQUIRED"].includes(taskErrorCode(value));
}

module.exports = { shouldPauseBatch, taskErrorCode };
