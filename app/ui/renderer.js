const $ = (selector) => document.querySelector(selector);

let currentState = null;

function formatAddress(urlText) {
  try {
    const url = new URL(urlText);
    return `${url.hostname}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return urlText || "正在打开小红书…";
  }
}

function statusName(status) {
  return (
    {
      scanning: "正在识别",
      running: "正在下载",
      success: "下载完成",
      failed: "部分或全部失败",
      cancelled: "已经停止",
    }[status] || "准备中"
  );
}

function render(state) {
  currentState = state;
  const browser = state.browser;
  const page = browser.page;
  if (document.activeElement !== $("#address-input")) {
    $("#address-input").value = formatAddress(browser.url);
  }
  $("#back").disabled = !browser.canGoBack;
  $("#forward").disabled = !browser.canGoForward;
  $("#page-badge").textContent = browser.loading ? "页面加载中" : page.label;
  const preferences = state.preferences;
  if (preferences) {
    $("#zoom-reset").textContent = `${preferences.browserZoomPercent}%`;
    $("#settings-zoom-value").textContent =
      `${preferences.browserZoomPercent}%`;
    $("#download-directory").textContent = preferences.downloadDirectory;
    $("#user-data-directory").textContent = preferences.userDataDirectory;
    $("#reset-download-directory").disabled =
      preferences.downloadDirectory === preferences.defaultDownloadDirectory;
  }

  const supported = page.type !== "unsupported";
  const batch = ["profile", "favorites"].includes(page.type);
  $("#limit-row").classList.toggle("hidden", !batch);
  $("#limit-label").classList.toggle("hidden", !batch);
  if (page.type === "single") {
    $("#page-title").textContent = "下载当前这篇笔记";
    $("#page-help").textContent =
      "会同时保存静态图片与对应的 Live 视频部分。";
    $("#start").textContent = "下载这篇笔记";
  } else if (page.type === "profile") {
    $("#page-title").textContent = "下载博主笔记";
    $("#page-help").textContent =
      "输入准确数量，按当前页面从前到后的顺序下载。";
    $("#start").textContent = "开始下载博主笔记";
  } else if (page.type === "favorites") {
    $("#page-title").textContent = "下载我的收藏";
    $("#page-help").textContent =
      "使用这里已经登录的小红书账号读取收藏内容。";
    $("#start").textContent = "开始下载收藏";
  } else {
    $("#page-title").textContent = "请在左侧打开目标页面";
    $("#page-help").textContent =
      "支持单篇笔记、博主主页和“我的收藏”页面。";
    $("#start").textContent = "当前页面不可下载";
  }

  const active = ["scanning", "running"].includes(state.task?.status);
  $("#start").disabled = !supported || browser.loading || active;
  $("#options").classList.toggle("hidden", active);
  $("#task").classList.toggle("hidden", !state.task);
  if (!state.task) return;

  const task = state.task;
  const percent = Math.max(0, Math.min(100, Number(task.percent || 0)));
  const completelyFailed = task.status === "failed" && !task.completed;
  $("#task").classList.toggle("failed", task.status === "failed");
  $("#task-state").textContent = statusName(task.status);
  $("#task-title").textContent =
    task.currentTitle ||
    (task.sourceType === "single" ? "当前笔记" : "批量下载");
  $("#task-percent").textContent = completelyFailed ? "失败" : `${percent}%`;
  $("#progress-bar").style.width = `${percent}%`;
  $("#task-detail").textContent = task.detail || "";
  $("#task-error").textContent = task.error || "";
  $("#task-error").classList.toggle("hidden", !task.error);
  $("#cancel").classList.toggle("hidden", !active);
}

for (const action of ["back", "forward", "reload", "home"]) {
  $(`#${action}`).addEventListener("click", () =>
    window.wahongshu.browserAction(action),
  );
}

async function navigateAddress() {
  const input = $("#address-input");
  const go = $("#go");
  go.disabled = true;
  try {
    const result = await window.wahongshu.navigate(input.value);
    if (!result?.ok) throw new Error(result?.error || "无法打开这个链接");
    input.blur();
  } catch (error) {
    alert(error.message || String(error));
    input.focus();
    input.select();
  } finally {
    go.disabled = false;
  }
}

$("#go").addEventListener("click", navigateAddress);
$("#address-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    navigateAddress();
  } else if (event.key === "Escape") {
    event.currentTarget.value = formatAddress(currentState?.browser?.url);
    event.currentTarget.blur();
  }
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
    event.preventDefault();
    $("#address-input").focus();
    $("#address-input").select();
  }
});

async function changeZoom(delta) {
  const current = Number(currentState?.preferences?.browserZoomPercent || 100);
  await window.wahongshu.setBrowserZoom(delta === 0 ? 100 : current + delta);
}

$("#zoom-out").addEventListener("click", () => changeZoom(-10));
$("#zoom-reset").addEventListener("click", () => changeZoom(0));
$("#zoom-in").addEventListener("click", () => changeZoom(10));
$("#settings-zoom-out").addEventListener("click", () => changeZoom(-10));
$("#settings-zoom-in").addEventListener("click", () => changeZoom(10));

const settingsDialog = $("#settings-dialog");
$("#settings").addEventListener("click", () => settingsDialog.showModal());
settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});

$("#choose-download-directory").addEventListener("click", async () => {
  await window.wahongshu.chooseDownloadDirectory();
});
$("#reset-download-directory").addEventListener("click", async () => {
  await window.wahongshu.resetDownloadDirectory();
});
$("#open-user-data").addEventListener("click", () =>
  window.wahongshu.openUserData(),
);

$("#minus").addEventListener("click", () => {
  $("#limit").value = Math.max(1, Number($("#limit").value || 1) - 1);
});

$("#plus").addEventListener("click", () => {
  $("#limit").value = Math.min(1000, Number($("#limit").value || 1) + 1);
});

$("#limit").addEventListener("change", () => {
  $("#limit").value = Math.max(
    1,
    Math.min(1000, Number($("#limit").value || 3)),
  );
});

$("#start").addEventListener("click", async () => {
  try {
    $("#start").disabled = true;
    await window.wahongshu.startCurrent(Number($("#limit").value || 3));
  } catch (error) {
    alert(error.message || String(error));
  }
});

$("#cancel").addEventListener("click", () => window.wahongshu.cancel());
$("#downloads").addEventListener("click", () =>
  window.wahongshu.openDownloads(),
);
$("#devtools").addEventListener("click", () =>
  window.wahongshu.openDevTools(),
);

window.wahongshu.onState(render);
window.wahongshu.getState().then(render);
