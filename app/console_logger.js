function sanitizeConsoleText(value) {
  return String(value || "")
    .replace(/https?:\/\/[^\s]+/gi, "[地址已隐藏]")
    .replace(/((?:xsec_token|cookie|authorization)\s*[:=]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/\s+/g, " ")
    .trim();
}

function createGuiConsoleLogger({ write, now = () => new Date() }) {
  let lastPageKey = "";
  let lastTaskId = "";
  let lastItemKey = "";
  let lastDetail = "";
  let lastFinished = "";

  const emit = (scope, message) => {
    const cleaned = sanitizeConsoleText(message);
    if (!cleaned || /candidates?/i.test(cleaned)) return;
    const timestamp = now().toLocaleTimeString("zh-CN", { hour12: false });
    write(`[${timestamp}] [${scope}] ${cleaned}`);
  };

  const start = (version) => {
    emit("挖红薯", `版本 ${version} 图形界面正在启动`);
    emit("提示", "这是运行日志窗口，请勿关闭；不需要查看时可以最小化");
  };

  const observe = (snapshot) => {
    const task = snapshot?.task;
    const active = ["scanning", "running"].includes(task?.status);
    const page = snapshot?.browser?.page;
    if (!active && page) {
      const pageKey = `${page.type}:${page.noteId || page.label || ""}`;
      if (pageKey !== lastPageKey) {
        lastPageKey = pageKey;
        emit(
          "浏览器",
          page.type === "unsupported"
            ? page.label
            : `已识别页面：${page.label}`,
        );
      }
    }
    if (!task) return;

    const taskId = String(task.startedAt || "");
    if (taskId && taskId !== lastTaskId) {
      lastTaskId = taskId;
      lastItemKey = "";
      lastDetail = "";
      lastFinished = "";
      emit(
        "任务",
        `开始${task.sourceType === "single" ? "单篇" : "批量"}下载，共 ${task.total || 0} 篇`,
      );
    }

    if (task.status === "scanning" && task.detail !== lastDetail) {
      lastDetail = task.detail || "";
      emit("扫描", task.detail);
      return;
    }
    if (task.status === "running") {
      const itemKey = `${task.current || 0}:${task.currentTitle || ""}`;
      if (itemKey !== lastItemKey && task.currentTitle) {
        lastItemKey = itemKey;
        emit(
          `${task.current || 0}/${task.total || 0}`,
          `正在处理：${task.currentTitle}`,
        );
      }
      if (
        task.detail &&
        task.detail !== lastDetail &&
        !/^下载核心正在处理/.test(task.detail)
      ) {
        lastDetail = task.detail;
        emit("进度", task.detail);
      }
      return;
    }
    if (["success", "failed", "cancelled"].includes(task.status)) {
      const finishedKey = `${task.status}:${task.finishedAt || ""}:${task.detail || ""}`;
      if (finishedKey === lastFinished) return;
      lastFinished = finishedKey;
      if (task.status === "success") {
        emit("完成", task.detail || "下载完成");
      } else if (task.status === "cancelled") {
        emit("停止", task.detail || "任务已停止");
      } else {
        emit("错误", task.error || task.detail || "任务失败");
      }
    }
  };

  return { emit, observe, start };
}

module.exports = {
  createGuiConsoleLogger,
  sanitizeConsoleText,
};
