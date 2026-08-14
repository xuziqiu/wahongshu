# 挖红薯命令行参考

本文档是 WaHongShu CLI 的完整命令参考（CLI Reference）。适用于 Windows
PowerShell，以及需要调用挖红薯的脚本或 AI Agent。

## 快速开始

挖红薯只有一个自包含 EXE，不需要安装 Python、Node.js 或额外主程序目录。
第一次使用前，先双击同一 EXE，在 GUI 的内置浏览器中登录小红书。

在 PowerShell 中进入 EXE 所在目录：

```powershell
cd "D:\工具\挖红薯"
$cli = ".\WaHongShu-1.3.0.exe"
& $cli --version
& $cli --help
```

小红书链接通常含有 `&`，必须把完整链接放在英文双引号中。

## 命令总览

```text
wahongshu download  下载单篇笔记
wahongshu profile   批量下载博主主页
wahongshu favorites 批量下载“我的收藏”
```

查询帮助：

```powershell
& $cli --help
& $cli download --help
& $cli profile --help
& $cli favorites --help
& $cli help profile
```

## `download`：单篇笔记

```text
wahongshu download <小红书笔记链接> [--output-dir=<目录>] [--json]
```

下载笔记中页面公开提供的最佳可用图片、Live Photo 静态图与动态部分，或视频。

示例：

```powershell
& $cli download "https://www.xiaohongshu.com/explore/笔记ID?xsec_token=..."
```

单篇任务会在下载根目录下建立“笔记标题 + 笔记 ID”文件夹。

`download` 不接受 `--limit`、`--all`、`--resume`、`--dry-run` 或 `--list`；
这些都是批量任务选项。

## `profile`：博主主页

```text
wahongshu profile <博主主页链接> [--limit <数量> | --all]
  [--resume] [--dry-run] [--list]
  [--output-dir=<目录>] [--json | --jsonl]
```

下载主页前 5 篇：

```powershell
& $cli profile "博主主页链接" --limit 5
```

下载主页全部笔记，并允许中断后继续：

```powershell
& $cli profile "博主主页链接" --all --resume
```

批量媒体直接汇总到：

```text
下载根目录/
└─ 博主名_[主页ID]/
   ├─ 笔记标题_[笔记ID]_01.jpg
   ├─ 笔记标题_[笔记ID]_01_Live.mp4
   ├─ batch_manifest.json
   └─ _manifests/
      └─ 笔记ID.json
```

## `favorites`：我的收藏

```text
wahongshu favorites <我的收藏页链接> [--limit <数量> | --all]
  [--resume] [--dry-run] [--list]
  [--output-dir=<目录>] [--json | --jsonl]
```

下载收藏页前 10 篇：

```powershell
& $cli favorites "我的收藏页链接" --limit 10
```

下载全部收藏，并允许中断后继续：

```powershell
& $cli favorites "我的收藏页链接" --all --resume
```

收藏页必须属于当前已登录的小红书账号，并且能在 GUI 内置浏览器中正常打开。

## 参数参考

### `--limit <数量>`

只处理列表开头指定数量的笔记。接受 `1`–`1000` 的整数，默认值为 `3`。

```powershell
& $cli profile "博主主页链接" --limit 20
```

不能与 `--all` 同时使用。

### `--all`

持续滚动并扫描到页面末尾。主页或收藏数量较多时，扫描会花费一定时间。

```powershell
& $cli profile "博主主页链接" --all
```

### `--resume`

显式断点续传。CLI 根据成功写入的笔记清单跳过已完成项，只处理剩余笔记。

```powershell
& $cli profile "博主主页链接" --all --resume
```

不传入 `--resume` 时不会自动去重，会重新下载本次选中的笔记。

### `--dry-run`

只扫描并计算任务数量，不下载媒体。适合在正式批量任务前确认范围。

```powershell
& $cli profile "博主主页链接" --all --resume --dry-run --json
```

典型结果：

```json
{"status":"success","scanned":134,"skipped":110,"planned":24}
```

### `--list`

在预演结果中附带扫描到的完整笔记标题和 ID 列表。必须与 `--dry-run` 一起使用。

```powershell
& $cli profile "博主主页链接" --all --resume --dry-run --list --json
```

默认不返回完整列表，以免大量笔记产生过大的 JSON。

### `--output-dir=<目录>`

临时改变本次任务的下载根目录，不修改 GUI 中保存的偏好设置。

```powershell
& $cli profile "博主主页链接" --all --resume `
  "--output-dir=D:\媒体备份\小红书"
```

包含空格或中文的整个参数应放在引号中。

### `--json`

不输出普通文字进度，只在结束时向标准输出写入一个 JSON 结果对象。适合脚本读取。

```powershell
& $cli download "笔记链接" --json
```

### `--jsonl`

运行期间向标准输出逐行写入 JSON 进度事件，最后一行写入最终结果。只适用于
`profile` 和 `favorites`。

```powershell
& $cli profile "博主主页链接" --all --resume --jsonl
```

## JSON 输出

最终结果可能包含以下字段：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `status` | string | `success`、`failed`、`blocked` 或 `cancelled` |
| `sourceType` | string | `single`、`profile` 或 `favorites` |
| `sourceId` | string | 笔记或主页标识 |
| `sourceTitle` | string | 笔记标题或博主名称 |
| `scanned` | number | 扫描到的笔记数 |
| `planned` | number | 本次计划下载数 |
| `completed` | number | 成功完成数 |
| `failed` | number | 失败数 |
| `skipped` | number | `--resume` 跳过数 |
| `outputDirectory` | string | 实际保存目录 |
| `error` | string | 首要错误信息；成功时为空 |
| `errorCode` | string | 结构化错误代码；成功时为空 |
| `failures` | array | 每篇失败记录 |
| `items` | array | 仅在 `--dry-run --list` 时出现 |

JSONL 进度事件包含：

| 字段 | 含义 |
| --- | --- |
| `event` | 固定为 `progress` |
| `status` | 当前任务状态 |
| `current` / `total` | 当前笔记和计划总数 |
| `completed` / `failed` / `skipped` | 实时计数 |
| `percent` | 0–100 的进度百分比 |
| `title` | 当前笔记标题 |
| `detail` | 当前步骤说明 |
| `errorCode` | 当前结构化错误代码 |

## 退出码

PowerShell 可在命令结束后读取 `$LASTEXITCODE`：

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功，包括预演成功或断点续传后无需下载 |
| `1` | 参数错误、页面识别失败或下载失败 |
| `2` | CLI 启动器未能启动内置程序 |
| `3` | 已有 GUI 或 CLI 实例正在运行 |
| `130` | 用户使用 `Ctrl+C` 中断 |

```powershell
& $cli profile "博主主页链接" --all --resume
if ($LASTEXITCODE -ne 0) {
  Write-Error "挖红薯任务失败：$LASTEXITCODE"
}
```

## 错误代码

| 错误代码 | 含义 | 建议处理 |
| --- | --- | --- |
| `LOGIN_REQUIRED` | 登录状态缺失或失效 | 双击同一 EXE 登录后，使用 `--resume` 重试 |
| `AUTH_REQUIRED` | 小红书要求安全验证 | 双击同一 EXE 完成验证后，使用 `--resume` 重试 |
| `CANCELLED` | 任务被停止 | 确认范围后使用 `--resume` 重试 |
| `DOWNLOAD_FAILED` | 下载、页面读取或媒体处理失败 | 查看 `error` 和 `failures` 字段 |

遇到登录或安全验证时，批量任务会立即停止，不会继续积累大量失败项。

## 登录与本机数据

- 同一 EXE 的 CLI 和 GUI 模式共用 `%APPDATA%\挖红薯` 中的登录会话与设置。
- CLI 不会要求在终端中输入小红书密码。
- 首次登录、二维码和安全验证需要双击同一 EXE，在 GUI 中完成。
- 为避免会话和下载目录冲突，运行 CLI 前应先关闭 GUI。
- 删除源码目录不会删除登录会话或已下载媒体。

## 推荐工作流

先预演：

```powershell
& $cli profile "博主主页链接" --all --resume --dry-run --json
```

确认数量后正式下载：

```powershell
& $cli profile "博主主页链接" --all --resume --jsonl
```

如果中途出现验证或网络问题，处理后原样执行第二条命令即可继续。

## 媒体质量说明

挖红薯会选择页面当时公开提供的最佳可用媒体，但不能保证文件与发布者上传前的
本地原文件逐字节一致。平台可能已经执行转码、压缩、格式转换或元数据处理。
