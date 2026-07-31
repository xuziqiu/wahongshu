<p align="center">
  <img src="./app/assets/icon.png" width="96" alt="挖红薯图标">
</p>

<h1 align="center">挖红薯</h1>

<p align="center">
  带内置浏览器的小红书媒体下载与个人备份工具<br>
  一个 EXE，同时提供图形界面和命令行
</p>

<p align="center">
  <a href="https://github.com/xuziqiu/wahongshu/actions/workflows/ci.yml"><img src="https://github.com/xuziqiu/wahongshu/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/xuziqiu/wahongshu/releases/latest"><img src="https://img.shields.io/github/v/release/xuziqiu/wahongshu?display_name=tag&sort=semver" alt="GitHub Release"></a>
  <img src="https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4" alt="Windows 10 / 11">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://github.com/xuziqiu/wahongshu/releases/latest"><strong>下载最新版</strong></a>
  ·
  <a href="#图形界面使用方法">图形界面</a>
  ·
  <a href="#命令行使用方法">命令行</a>
</p>

挖红薯用于保存你在小红书页面中能够正常访问的图片、Live Photo 和视频。
它会尽量选择页面公开提供的最高质量媒体，并按照笔记标题整理文件。除了单篇
笔记，也能按顺序批量处理博主主页和“我的收藏”。

> [!IMPORTANT]
> 挖红薯不是小红书官方产品，也不会绕过账号权限或访问控制。请只保存自己
> 拥有、已获授权或法律允许使用的内容，并阅读
> [使用说明与免责声明](./DISCLAIMER.md)。

## 它能做什么

| 能力 | 说明 |
| --- | --- |
| 单篇笔记 | 下载当前笔记中的图片、Live Photo 或视频 |
| 博主主页 | 输入准确数量，按页面从前到后的顺序批量下载 |
| 我的收藏 | 使用内置浏览器中已经登录的账号读取并批量下载 |
| 高质量媒体 | 图片优先选择无网页转换参数的公开主资源；视频优先选择最高质量的兼容 H.264 流 |
| Live Photo | 同时保存静态图片和对应的动态视频部分 |
| 清晰的文件名 | 使用“笔记标题 + 编号”命名，单篇内容保存到“标题 + 笔记 ID”文件夹 |
| 批次目录 | 博主主页按“博主名 + 主页 ID”建立汇总文件夹，再在其中保存各笔记目录 |
| 图形界面与 CLI | 普通用户可以点选操作，脚本和 AI 可以直接调用同一个 EXE |

这里所说的“最高质量”是**页面当时公开提供的最佳媒体**，不保证与发布者上传
前的本地原文件逐字节一致。格式、元数据和画质仍可能受到平台处理影响。

## 图形界面使用方法

图形界面适合日常使用，不需要准备 Python、Node.js 或额外的主程序目录。

1. 从 [GitHub Releases](https://github.com/xuziqiu/wahongshu/releases/latest)
   下载 `WaHongShu-<版本>.exe`，双击运行。
2. 第一次使用时，在内置浏览器中登录小红书。登录状态会保存在本机，之后无需
   每次重新登录。
3. 在内置浏览器中打开单篇笔记、博主主页或“我的收藏”。也可以把从其他地方
   复制的小红书链接直接粘贴到顶部地址栏。
4. 右侧面板识别页面后，单篇笔记可以直接下载；主页和收藏页可以准确填写需要
   下载的前多少篇。任务卡片会持续显示当前标题、进度和结果。

界面还提供：

- 自定义下载目录，默认位置是 Windows“下载”文件夹中的 `挖红薯`。
- 50%–200% 的内置网页缩放，以及 `Ctrl＋`、`Ctrl−`、`Ctrl＋0` 快捷键。
- 一键打开下载目录。
- 停止正在扫描或下载的任务。
- 可最小化的实时日志窗口，用于显示页面识别、当前笔记、进度和错误。

> [!NOTE]
> 图形界面旁边的黑色窗口是运行日志，不是报错。可以最小化，但关闭它会结束
> 挖红薯。日志会隐藏 Token、Cookie 和媒体地址。

## 命令行使用方法

同一个便携版 EXE 也可以作为 CLI 使用，适合自动化脚本、批处理和 AI Agent。
CLI 与图形界面共用登录状态、下载目录和下载核心，因此第一次使用仍应先打开
图形界面完成登录。

下面以 PowerShell 为例：

```powershell
# 查看帮助和版本
& ".\WaHongShu-1.1.2.exe" --help
& ".\WaHongShu-1.1.2.exe" --version

# 下载单篇笔记
& ".\WaHongShu-1.1.2.exe" download "<小红书笔记链接>"

# 下载博主主页前 5 篇
& ".\WaHongShu-1.1.2.exe" profile "<博主主页链接>" --limit 5

# 断点续传：只处理没有成功 manifest 的笔记
& ".\WaHongShu-1.1.2.exe" profile --limit 1000 --resume "<博主主页链接>"

# 只预演断点续传数量，不下载任何文件
& ".\WaHongShu-1.1.2.exe" profile --limit 1000 --resume --dry-run --json "<博主主页链接>"

# 下载“我的收藏”前 3 篇
& ".\WaHongShu-1.1.2.exe" favorites "<收藏页链接>" --limit 3

# 本次任务临时指定保存位置，不修改图形界面中的偏好设置
& ".\WaHongShu-1.1.2.exe" download "<小红书笔记链接>" `
  "--output-dir=D:\Media\挖红薯"

# 输出单行 JSON，方便脚本或 AI 读取
& ".\WaHongShu-1.1.2.exe" profile "<博主主页链接>" `
  --limit 5 --json
```

成功时进程退出码为 `0`，参数错误或下载失败时为非 `0`。小红书链接通常包含
`&`，在 PowerShell 中应始终放在引号内。`--limit` 接受 1–1000 的整数；
`--output-dir=目录` 必须作为一个完整参数传入。

`--resume` 是显式的批量断点续传开关，只适用于博主主页和收藏页。它以成功写入
的 `manifest.json` 为准跳过已经完成的笔记；不写这个开关时仍会照常重新下载，
不会自动去重。`--dry-run` 只返回扫描、跳过和待下载数量，不会写入媒体文件。

不带任何参数运行 EXE 时，仍会进入图形界面。

## 下载结果

每篇笔记使用独立文件夹，媒体顺序与笔记页面一致：

```text
下载目录/
└─ 笔记标题_[笔记ID]/
   ├─ 笔记标题_01.jpg
   ├─ 笔记标题_01_Live.mp4
   ├─ 笔记标题_02.jpg
   └─ manifest.json
```

普通视频笔记会保存为 `笔记标题_01.mp4` 等实际媒体格式。`manifest.json` 记录
笔记 ID、媒体尺寸、格式和所选公开资源等信息；访问 Token 会被遮盖。每次执行
任务都会重新下载，不会因为此前下载过而跳过内容。

## 登录、隐私与本机数据

- 偏好设置保存在 `%APPDATA%\挖红薯\settings.json`。
- 小红书浏览器会话保存在同一应用数据目录，并额外写入使用 Windows 系统加密
  的 `xhs-session.bin` 备份。
- 登录信息不会写入 EXE、媒体下载目录或运行日志。
- 程序不会上传下载历史、Cookie 或媒体文件。
- 内置地址栏只允许打开小红书及其分享短链域名。

如果希望完全退出账号，可以在应用设置中打开数据目录并清理对应会话数据。

## 校验下载文件

当前便携版没有商业代码签名，因此 Windows SmartScreen 可能显示“未知发布者”。
请只从本仓库的 Releases 页面下载。每个 Release 都同时提供 `.exe.sha256`
校验文件，可在 PowerShell 中核对：

```powershell
Get-FileHash -Algorithm SHA256 ".\WaHongShu-1.1.2.exe"
```

输出应与同一 Release 中 `.exe.sha256` 文件记录的值一致。

## 从源码运行

开发环境需要 Windows、Node.js、npm，以及 Python 3.11 或更高版本。

```powershell
git clone https://github.com/xuziqiu/wahongshu.git
cd wahongshu
npm ci
npm start
```

运行全部测试：

```powershell
npm test
```

构建自包含 Windows 便携版：

```powershell
python -m pip install pillow pyinstaller
npm run dist:local
```

本地构建脚本会在纯英文的 Windows 临时目录中完成封装，以避开部分打包工具对
中文路径的兼容问题。最终 EXE 和 SHA-256 文件生成在 `release/`；Python 下载
核心会先由 PyInstaller 封装，再作为 Electron 资源装入同一个便携版 EXE。

## 项目结构

```text
app/                 Electron 桌面程序、内置浏览器、CLI 与界面
core/downloader.py   单篇笔记媒体下载核心
tests/               Python 下载核心测试
app/tests/           桌面端、发布脚本与会话保存测试
design/branding/     生图源稿；由脚本裁切为最终应用图标
scripts/             Windows 本地构建与发布收尾脚本
.github/workflows/   持续集成与 GitHub Release 工作流
release/             本地构建成品；二进制不提交到 Git
```

## 许可证

源码采用 [MIT License](./LICENSE)。使用本项目时仍需遵守适用法律、平台规则、
著作权和个人信息保护要求。
