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
  cleanPageTitle,
} = require("./core");
const {
  openStandaloneNotePage,
  resolveBatchNoteUrl,
  waitForRenderedNote,
} = require("./page_workflow");
const { parseCliInvocation, cliUsage } = require("./cli");
const { createGuiConsoleLogger } = require("./console_logger");
const { createSessionKeeper } = require("./session_store");
const { completedNoteIds } = require("./resume");
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
let cliWindow = null;
let stateObserver = null;
let guiConsoleLogger = null;
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
  const snapshot = publicState();
  stateObserver?.(snapshot);
  guiConsoleLogger?.observe(snapshot);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("wahongshu:state", snapshot);
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
    autoHideMenuBar: true,
    backgroundColor: "#f4f1ea",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
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

async function loadRenderedNoteSnapshot(item, signal, onLine, listUrl = "") {
  const contents = browserView.webContents;
  if (listUrl) {
    onLine?.("正在从当前列表打开笔记原始页面…");
    let resolvedUrl = "";
    try {
      const scannedUrl = new URL(item.url || "");
      if (
        ["xiaohongshu.com", "www.xiaohongshu.com"].includes(
          scannedUrl.hostname,
        ) &&
        scannedUrl.pathname.toLowerCase().includes(item.noteId.toLowerCase()) &&
        scannedUrl.searchParams.has("xsec_token")
      ) {
        resolvedUrl = scannedUrl.toString();
      }
    } catch {}
    if (!resolvedUrl) {
      resolvedUrl = await resolveBatchNoteUrl(
        contents,
        listUrl,
        item.noteId,
        signal,
      );
    }
    await contents.loadURL(resolvedUrl);
  } else {
    onLine?.("正在打开当前笔记的完整页面…");
    await openStandaloneNotePage(contents, item.noteId, signal);
  }
  await waitForRenderedNote(
    contents,
    item.noteId,
    signal,
  );
  const html = await contents.executeJavaScript(
    "document.documentElement.outerHTML",
  );
  if (
    !String(html).includes("window.__INITIAL_STATE__") ||
    !String(html).toLowerCase().includes(item.noteId.toLowerCase())
  ) {
    throw new Error("当前笔记原始页面缺少完整媒体状态");
  }
  onLine?.("已从当前登录页面读取原始笔记状态");
  return html;
}

async function runPythonDownloader(item, signal, onLine, listUrl = "") {
  const sourceUrl = item.url || noteUrl(item.noteId, item.xsecToken);
  const outputRoot = settings.downloadDirectory;
  let snapshotDirectory = null;
  let snapshotPath = null;
  try {
    const html = await loadRenderedNoteSnapshot(item, signal, onLine, listUrl);
    snapshotDirectory = await fs.promises.mkdtemp(
      path.join(app.getPath("temp"), "wahongshu-page-"),
    );
    snapshotPath = path.join(snapshotDirectory, `${item.noteId}.html`);
    await fs.promises.writeFile(snapshotPath, html, "utf8");
  } catch (error) {
    if (snapshotDirectory) {
      await fs.promises.rm(snapshotDirectory, { recursive: true, force: true });
    }
    throw error;
  }
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
    "--title-fallback",
    item.title || "",
    ...(snapshotPath ? ["--page-html", snapshotPath] : []),
  ];
  const args = app.isPackaged
    ? downloaderArgs
    : ["-u", developmentCore, ...downloaderArgs];
  try {
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
  } finally {
    if (snapshotDirectory) {
      await fs.promises.rm(snapshotDirectory, { recursive: true, force: true });
    }
  }
}

async function runTask(limit, { resume = false, dryRun = false } = {}) {
  const page = recognizePage(browserView.webContents.getURL());
  if (page.type === "unsupported") throw new Error(page.label);
  const controller = new AbortController();
  taskController = controller;
  const signal = controller.signal;
  const startedAt = Date.now();
  const listUrl = ["profile", "favorites"].includes(page.type)
    ? browserView.webContents.getURL()
    : "";
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
          title: cleanPageTitle(browserView.webContents.getTitle()),
          url: browserView.webContents.getURL(),
        },
      ];
    } else {
      items = await scanVisiblePage(limit, signal);
      if (!items.length) {
        throw new Error("当前页面没有识别到笔记，请确认已经登录并刷新页面");
      }
    }

    const scanned = items.length;
    let skipped = 0;
    if (resume && page.type !== "single") {
      const completed = completedNoteIds(settings.downloadDirectory);
      items = items.filter(
        (item) => !completed.has(String(item.noteId || "").toLowerCase()),
      );
      skipped = scanned - items.length;
    }

    const total = items.length;
    setTask({ scanned, skipped, planned: total, total });
    if (dryRun) {
      setTask({
        status: "success",
        percent: 100,
        detail: `预演完成：扫描 ${scanned} 篇，跳过 ${skipped} 篇，待下载 ${total} 篇`,
        finishedAt: Date.now(),
      });
      return structuredClone(state.task);
    }
    if (!total) {
      setTask({
        status: "success",
        percent: 100,
        detail: `扫描 ${scanned} 篇，已有完整记录 ${skipped} 篇，无需下载`,
        finishedAt: Date.now(),
      });
      return structuredClone(state.task);
    }
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
        await runPythonDownloader(
          item,
          signal,
          (line) => {
            setTask({
              detail: line,
              percent: Math.min(
                99,
                Math.round(((index + 0.35) / total) * 100),
              ),
            });
          },
          listUrl,
        );
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
        ? `完成 ${state.task.completed} 篇，失败 ${failed} 篇，跳过 ${skipped} 篇`
        : `已完成 ${state.task.completed} 篇，跳过 ${skipped} 篇`,
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
    if (listUrl && browserView && !browserView.webContents.isDestroyed()) {
      await browserView.webContents.loadURL(listUrl).catch(() => {});
      updateBrowserState();
    }
  }
  return structuredClone(state.task);
}

function writeCli(stream, value) {
  try {
    stream.write(`${value}\n`);
  } catch {}
}

async function createCliBrowser(targetUrl) {
  cliWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  configureGuest(cliWindow.webContents);
  browserView = { webContents: cliWindow.webContents };
  await cliWindow.loadURL(targetUrl);
}

async function runCli(invocation) {
  if (invocation.parseError) throw new Error(invocation.parseError);
  if (invocation.help) {
    writeCli(process.stdout, cliUsage());
    return 0;
  }
  if (invocation.version) {
    writeCli(process.stdout, app.getVersion());
    return 0;
  }
  if (invocation.outputDirectory) {
    settings = {
      ...settings,
      downloadDirectory: path.resolve(invocation.outputDirectory),
    };
  }
  fs.mkdirSync(settings.downloadDirectory, { recursive: true });
  const targetUrl = normalizeNavigationUrl(invocation.url);
  await createCliBrowser(targetUrl);
  const loadedPage = recognizePage(cliWindow.webContents.getURL());
  const expectedPageType = {
    download: "single",
    profile: "profile",
    favorites: "favorites",
  }[invocation.command];
  if (loadedPage.type !== expectedPageType) {
    throw new Error(
      `${invocation.command} 命令需要${
        expectedPageType === "single"
          ? "单篇笔记"
          : expectedPageType === "profile"
            ? "博主主页"
            : "收藏页"
      }链接；当前识别为“${loadedPage.label}”`,
    );
  }

  let lastLine = "";
  if (!invocation.json) {
    stateObserver = (snapshot) => {
      const task = snapshot.task;
      if (!task) return;
      const line = [
        task.status,
        `${task.percent || 0}%`,
        task.currentTitle || task.detail || "",
      ]
        .filter(Boolean)
        .join(" | ");
      if (line && line !== lastLine) {
        lastLine = line;
        writeCli(process.stderr, line);
      }
    };
  }

  const result = await runTask(invocation.limit, {
    resume: invocation.resume,
    dryRun: invocation.dryRun,
  });
  stateObserver = null;
  const payload = {
    status: result?.status || "failed",
    sourceType: result?.sourceType || recognizePage(invocation.url).type,
    completed: result?.completed || 0,
    failed: result?.failed || 0,
    skipped: result?.skipped || 0,
    scanned: result?.scanned || 0,
    planned: result?.planned || 0,
    title: result?.currentTitle || "",
    error: result?.error || "",
    failures: result?.failures || [],
    outputDirectory: settings.downloadDirectory,
  };
  if (invocation.json) {
    writeCli(process.stdout, JSON.stringify(payload));
  } else {
    writeCli(
      process.stdout,
      payload.status === "success"
        ? `完成：${payload.completed} 篇，保存到 ${payload.outputDirectory}`
        : `失败：${payload.error || payload.failures[0]?.error || "未知错误"}`,
    );
  }
  return payload.status === "success" ? 0 : 1;
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
    browserView?.webContents.stop();
    return { ok: true };
  });
  ipcMain.handle("wahongshu:open-downloads", async () => {
    fs.mkdirSync(settings.downloadDirectory, { recursive: true });
    const error = await shell.openPath(settings.downloadDirectory);
    return { ok: !error, error };
  });
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
    fs.mkdirSync(settings.downloadDirectory, { recursive: true });
    broadcast();
    return { downloadDirectory: settings.downloadDirectory };
  });
  ipcMain.handle("wahongshu:set-browser-zoom", (_event, value) => ({
    browserZoomPercent: setBrowserZoomPercent(value),
  }));
  ipcMain.handle("wahongshu:set-settings-open", (_event, open) => {
    if (browserView) browserView.setVisible(!Boolean(open));
    return { ok: true };
  });
  ipcMain.handle("wahongshu:open-user-data", () =>
    shell.openPath(app.getPath("userData")),
  );
}

let cliInvocation = null;
try {
  cliInvocation = parseCliInvocation(
    process.argv,
    Boolean(process.defaultApp),
  );
} catch (error) {
  cliInvocation = {
    parseError: error instanceof Error ? error.message : String(error),
    json: process.argv.includes("--json"),
  };
}

if (!cliInvocation) {
  process.title = "挖红薯运行日志 - 请勿关闭（可以最小化）";
  guiConsoleLogger = createGuiConsoleLogger({
    write: (line) => writeCli(process.stdout, line),
  });
  guiConsoleLogger.start(app.getVersion());
}

app.whenReady().then(async () => {
  if (!cliInvocation) registerIpc();
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
  if (cliInvocation) {
    let exitCode = 1;
    try {
      exitCode = await runCli(cliInvocation);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cliInvocation.json) {
        writeCli(
          process.stdout,
          JSON.stringify({
            status: "failed",
            completed: 0,
            failed: 1,
            error: message,
            outputDirectory: settings.downloadDirectory,
          }),
        );
      } else {
        writeCli(process.stderr, `失败：${message}`);
      }
    }
    await sessionKeeper.flush().catch(() => {});
    if (cliWindow && !cliWindow.isDestroyed()) cliWindow.destroy();
    await wait(100);
    quitPrepared = true;
    app.exit(exitCode);
    return;
  }
  await createMainWindow();
  guiConsoleLogger?.emit("浏览器", "图形界面和内置浏览器已就绪");
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
