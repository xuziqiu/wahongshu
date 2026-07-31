const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const {
  app,
  BrowserWindow,
  dialog,
  WebContentsView,
  ipcMain,
  safeStorage,
  shell,
  session,
} = require("electron");
const {
  recognizePage,
  normalizeNavigationUrl,
  noteUrl,
  collectLinksScript,
} = require("./core");
const { createSessionKeeper } = require("./session_store");
const {
  createSettingsStore,
  normalizeZoomPercent,
} = require("./settings_store");

const PRODUCT_NAME = "挖红薯";
const PARTITION = "persist:wahongshu-xhs";
const SIDEBAR_WIDTH = 380;
const TOOLBAR_HEIGHT = 62;
const XHS_HOME = "https://www.xiaohongshu.com/explore";

app.setName(PRODUCT_NAME);
const appDataRoot = app.getPath("appData");
const userDataPath = path.join(appDataRoot, PRODUCT_NAME);
const legacyUserDataPath = path.join(appDataRoot, "原屿");
try {
  fs.mkdirSync(userDataPath, { recursive: true });
  const legacySession = path.join(legacyUserDataPath, "xhs-session.bin");
  const currentSession = path.join(userDataPath, "xhs-session.bin");
  if (fs.existsSync(legacySession) && !fs.existsSync(currentSession)) {
    fs.copyFileSync(legacySession, currentSession);
  }
  const legacyPartition = path.join(
    legacyUserDataPath,
    "Partitions",
    "yuanyu-xhs",
  );
  const currentPartition = path.join(
    userDataPath,
    "Partitions",
    "wahongshu-xhs",
  );
  if (fs.existsSync(legacyPartition) && !fs.existsSync(currentPartition)) {
    fs.cpSync(legacyPartition, currentPartition, { recursive: true });
  }
} catch (error) {
  console.warn("[session] 旧版登录数据迁移失败：", error.message);
}
app.setPath("userData", userDataPath);
const SESSION_BACKUP_PATH = path.join(
  app.getPath("userData"),
  "xhs-session.bin",
);
const DEFAULT_DOWNLOAD_DIRECTORY = path.join(
  app.getPath("downloads"),
  PRODUCT_NAME,
);
const settingsStore = createSettingsStore({
  filePath: path.join(app.getPath("userData"), "settings.json"),
  defaultDownloadDirectory: DEFAULT_DOWNLOAD_DIRECTORY,
});
let settings = settingsStore.load();

let mainWindow = null;
let browserView = null;
let taskController = null;
let activeWorker = null;
let sessionKeeper = null;
let quitPrepared = false;
let quitPreparing = false;
let state = {
  browser: {
    url: XHS_HOME,
    title: "小红书",
    page: recognizePage(XHS_HOME),
    canGoBack: false,
    canGoForward: false,
    loading: true,
  },
  task: null,
};

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function publicState() {
  return structuredClone({
    ...state,
    preferences: {
      downloadDirectory: settings.downloadDirectory,
      defaultDownloadDirectory: DEFAULT_DOWNLOAD_DIRECTORY,
      browserZoomPercent: settings.browserZoomPercent,
      userDataDirectory: app.getPath("userData"),
    },
  });
}

function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("wahongshu:state", publicState());
  }
}

function updateBrowserState() {
  if (!browserView || browserView.webContents.isDestroyed()) return;
  const contents = browserView.webContents;
  const url = contents.getURL() || XHS_HOME;
  state.browser = {
    url,
    title: contents.getTitle() || "小红书",
    page: recognizePage(url),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    loading: contents.isLoading(),
  };
  broadcast();
}

function setTask(patch) {
  state.task = state.task ? { ...state.task, ...patch } : patch;
  broadcast();
}

function clearFinishedTask() {
  if (state.task && !["running", "scanning"].includes(state.task.status)) {
    state.task = null;
    broadcast();
  }
}

function layoutViews() {
  if (!mainWindow || !browserView) return;
  const [width, height] = mainWindow.getContentSize();
  browserView.setBounds({
    x: 0,
    y: TOOLBAR_HEIGHT,
    width: Math.max(480, width - SIDEBAR_WIDTH),
    height: Math.max(300, height - TOOLBAR_HEIGHT),
  });
}

function setBrowserZoomPercent(value) {
  settings = settingsStore.save({
    ...settings,
    browserZoomPercent: normalizeZoomPercent(value),
  });
  if (browserView && !browserView.webContents.isDestroyed()) {
    browserView.webContents.setZoomFactor(settings.browserZoomPercent / 100);
  }
  broadcast();
  return settings.browserZoomPercent;
}

function registerZoomShortcuts(contents) {
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta)) return;
    if (["+", "=", "Add"].includes(input.key)) {
      event.preventDefault();
      setBrowserZoomPercent(settings.browserZoomPercent + 10);
    } else if (["-", "Subtract"].includes(input.key)) {
      event.preventDefault();
      setBrowserZoomPercent(settings.browserZoomPercent - 10);
    } else if (input.key === "0") {
      event.preventDefault();
      setBrowserZoomPercent(100);
    }
  });
}

function configureGuest(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(?:www\.)?xiaohongshu\.com\//i.test(url)) {
      contents.loadURL(url).catch(() => {});
    } else {
      shell.openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    title: PRODUCT_NAME,
    backgroundColor: "#f4f1ea",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await mainWindow.loadFile(path.join(__dirname, "ui", "index.html"));
  registerZoomShortcuts(mainWindow.webContents);

  browserView = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.contentView.addChildView(browserView);
  configureGuest(browserView.webContents);
  browserView.webContents.setZoomFactor(settings.browserZoomPercent / 100);
  registerZoomShortcuts(browserView.webContents);
  layoutViews();
  mainWindow.on("resize", layoutViews);

  for (const eventName of [
    "did-start-loading",
    "did-stop-loading",
    "did-finish-load",
    "page-title-updated",
    "did-navigate",
    "did-navigate-in-page",
  ]) {
    browserView.webContents.on(eventName, updateBrowserState);
  }
  browserView.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      state.browser.loading = false;
      state.browser.error = `${errorDescription} (${errorCode})`;
      state.browser.url = validatedURL;
      broadcast();
    },
  );
  await browserView.webContents.loadURL(XHS_HOME);
  updateBrowserState();
}

async function scanVisiblePage(limit, signal) {
  const contents = browserView.webContents;
  await contents.executeJavaScript(
    "window.scrollTo({top:0,behavior:'auto'}); true",
  );
  await wait(550);
  const found = new Map();
  let staleRounds = 0;
  const started = Date.now();
  while (Date.now() - started < 45000) {
    if (signal.aborted) throw new Error("任务已停止");
    const links = await contents.executeJavaScript(collectLinksScript());
    const before = found.size;
    for (const item of links || []) {
      if (!found.has(item.noteId)) found.set(item.noteId, item);
    }
    setTask({
      status: "scanning",
      detail: `已识别 ${found.size} / ${limit} 篇`,
      current: found.size,
      total: limit,
      percent: Math.min(15, Math.round((found.size / limit) * 15)),
    });
    if (found.size >= limit) break;
    staleRounds = found.size === before ? staleRounds + 1 : 0;
    if (found.size && staleRounds >= 7) break;
    await contents.executeJavaScript(
      "window.scrollTo({top:document.documentElement.scrollHeight,behavior:'smooth'}); true",
    );
    await wait(1250);
  }
  return [...found.values()].slice(0, limit);
}

function redactWorkerLine(value) {
  return String(value || "")
    .replace(/([?&](?:xsec_token|token|sign)=)[^&\s]+/gi, "$1REDACTED")
    .trim();
}

async function runPythonDownloader(item, signal, onLine) {
  const sourceUrl = item.url || noteUrl(item.noteId, item.xsecToken);
  const outputRoot = settings.downloadDirectory;
  const packagedCore = path.join(
    process.resourcesPath,
    "downloader",
    "wahongshu-core.exe",
  );
  const developmentCore = path.join(
    __dirname,
    "..",
    "core",
    "downloader.py",
  );
  const command = app.isPackaged
    ? packagedCore
    : process.env.WAHONGSHU_PYTHON || "python";
  const downloaderArgs = [
    "--url-stdin",
    "--out-root",
    outputRoot,
    "--timeout",
    "45",
  ];
  const args = app.isPackaged
    ? downloaderArgs
    : ["-u", developmentCore, ...downloaderArgs];
  return await new Promise((resolve, reject) => {
    const worker = spawn(
      command,
      args,
      {
        cwd: app.isPackaged ? process.resourcesPath : path.join(__dirname, ".."),
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    activeWorker = worker;
    const lines = [];
    const acceptLine = (line) => {
      const cleaned = redactWorkerLine(line);
      if (!cleaned) return;
      lines.push(cleaned);
      onLine?.(cleaned);
    };
    readline.createInterface({ input: worker.stdout }).on("line", acceptLine);
    readline.createInterface({ input: worker.stderr }).on("line", acceptLine);
    const abort = () => worker.kill();
    signal.addEventListener("abort", abort, { once: true });
    worker.once("error", (error) => {
      signal.removeEventListener("abort", abort);
      if (activeWorker === worker) activeWorker = null;
      reject(error);
    });
    worker.once("exit", (code) => {
      signal.removeEventListener("abort", abort);
      if (activeWorker === worker) activeWorker = null;
      if (signal.aborted) {
        reject(new Error("任务已停止"));
      } else if (code === 0) {
        resolve({ ok: true });
      } else {
        reject(new Error(lines.at(-1) || `下载核心返回代码 ${code}`));
      }
    });
    worker.stdin.end(`${sourceUrl}\n`);
  });
}

async function runTask(limit) {
  const page = recognizePage(browserView.webContents.getURL());
  if (page.type === "unsupported") throw new Error(page.label);
  const controller = new AbortController();
  taskController = controller;
  const signal = controller.signal;
  const startedAt = Date.now();
  state.task = {
    status: page.type === "single" ? "running" : "scanning",
    sourceType: page.type,
    detail:
      page.type === "single" ? "正在读取当前笔记…" : "正在识别当前列表…",
    current: 0,
    total: page.type === "single" ? 1 : limit,
    completed: 0,
    failed: 0,
    percent: 0,
    startedAt,
  };
  broadcast();

  try {
    let items;
    const failures = [];
    if (page.type === "single") {
      items = [
        {
          noteId: page.noteId,
          title: browserView.webContents.getTitle(),
          url: browserView.webContents.getURL(),
        },
      ];
    } else {
      items = await scanVisiblePage(limit, signal);
      if (!items.length) {
        throw new Error("当前页面没有识别到笔记，请确认已经登录并刷新页面");
      }
    }

    const total = items.length;
    for (let index = 0; index < total; index += 1) {
      if (signal.aborted) throw new Error("任务已停止");
      const item = items[index];
      setTask({
        status: "running",
        total,
        current: index + 1,
        currentTitle: item.title || `笔记 ${item.noteId}`,
        detail: `下载核心正在处理第 ${index + 1} / ${total} 篇`,
        percent: Math.round((index / total) * 100),
      });
      try {
        await runPythonDownloader(item, signal, (line) => {
          setTask({
            detail: line,
            percent: Math.min(
              99,
              Math.round(((index + 0.35) / total) * 100),
            ),
          });
        });
        state.task.completed += 1;
      } catch (error) {
        if (signal.aborted) throw error;
        failures.push({
          noteId: item.noteId,
          title: item.title || item.noteId,
          error: error instanceof Error ? error.message : String(error),
        });
        state.task.failed += 1;
      }
      broadcast();
    }
    const failed = failures.length;
    setTask({
      status: failed ? "failed" : "success",
      percent: 100,
      detail: failed
        ? `完成 ${state.task.completed} 篇，失败 ${failed} 篇`
        : `已完成 ${state.task.completed} 篇`,
      error: failures[0]?.error || "",
      failures,
      finishedAt: Date.now(),
    });
  } catch (error) {
    const cancelled = signal.aborted;
    setTask({
      status: cancelled ? "cancelled" : "failed",
      detail: cancelled ? "任务已停止" : "任务失败",
      error: cancelled
        ? ""
        : error instanceof Error
          ? error.message
          : String(error),
      finishedAt: Date.now(),
    });
  } finally {
    taskController = null;
    activeWorker = null;
  }
}

function registerIpc() {
  ipcMain.handle("wahongshu:get-state", () => publicState());
  ipcMain.handle("wahongshu:browser-action", async (_event, action) => {
    const contents = browserView.webContents;
    if (action === "back" && contents.navigationHistory.canGoBack()) {
      contents.navigationHistory.goBack();
    } else if (
      action === "forward" &&
      contents.navigationHistory.canGoForward()
    ) {
      contents.navigationHistory.goForward();
    } else if (action === "reload") {
      contents.reload();
    } else if (action === "home") {
      await contents.loadURL(XHS_HOME);
    }
    updateBrowserState();
    return { ok: true };
  });
  ipcMain.handle("wahongshu:navigate", async (_event, value) => {
    try {
      const url = normalizeNavigationUrl(value);
      await browserView.webContents.loadURL(url);
      updateBrowserState();
      return { ok: true, url: browserView.webContents.getURL() || url };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  ipcMain.handle("wahongshu:start-current", async (_event, { limit }) => {
    if (taskController) throw new Error("已有任务正在进行");
    clearFinishedTask();
    const bounded = Math.max(1, Math.min(1000, Number(limit || 3)));
    queueMicrotask(() => runTask(bounded));
    return { ok: true };
  });
  ipcMain.handle("wahongshu:cancel", () => {
    taskController?.abort();
    activeWorker?.kill();
    return { ok: true };
  });
  ipcMain.handle("wahongshu:open-downloads", () =>
    shell.openPath(settings.downloadDirectory),
  );
  ipcMain.handle("wahongshu:choose-download-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择挖红薯的下载位置",
      defaultPath: settings.downloadDirectory,
      buttonLabel: "使用这个文件夹",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    settings = settingsStore.save({
      ...settings,
      downloadDirectory: result.filePaths[0],
    });
    fs.mkdirSync(settings.downloadDirectory, { recursive: true });
    broadcast();
    return { canceled: false, downloadDirectory: settings.downloadDirectory };
  });
  ipcMain.handle("wahongshu:reset-download-directory", () => {
    settings = settingsStore.save({
      ...settings,
      downloadDirectory: DEFAULT_DOWNLOAD_DIRECTORY,
    });
    broadcast();
    return { downloadDirectory: settings.downloadDirectory };
  });
  ipcMain.handle("wahongshu:set-browser-zoom", (_event, value) => ({
    browserZoomPercent: setBrowserZoomPercent(value),
  }));
  ipcMain.handle("wahongshu:open-user-data", () =>
    shell.openPath(app.getPath("userData")),
  );
  ipcMain.handle("wahongshu:open-devtools", () => {
    browserView.webContents.openDevTools({ mode: "detach" });
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  registerIpc();
  const xhsSession = session.fromPartition(PARTITION);
  sessionKeeper = createSessionKeeper({
    electronSession: xhsSession,
    safeStorage,
    filePath: SESSION_BACKUP_PATH,
  });
  try {
    await sessionKeeper.restore();
  } catch (error) {
    console.warn("[session] 无法恢复登录会话：", error.message);
  }
  xhsSession.cookies.on("changed", () => sessionKeeper.schedule());
  xhsSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(["clipboard-sanitized-write", "fullscreen"].includes(permission));
  });
  await createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  taskController?.abort();
  activeWorker?.kill();
  if (quitPrepared || !sessionKeeper) return;
  event.preventDefault();
  if (quitPreparing) return;
  quitPreparing = true;
  sessionKeeper
    .flush()
    .catch((error) => {
      console.warn("[session] 退出前无法保存登录会话：", error.message);
    })
    .finally(() => {
      quitPrepared = true;
      app.quit();
    });
});
