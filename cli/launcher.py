from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def executable_version(executable: Path | None = None) -> str:
    stem = (executable or Path(sys.executable)).stem
    match = re.search(r"WaHongShu-CLI-(.+)$", stem, re.I)
    if match:
        return match.group(1)
    match = re.search(r"挖红薯-CLI-(.+)$", stem, re.I)
    return match.group(1) if match else ""


def find_gui_executable() -> Path:
    override = os.environ.get("WAHONGSHU_GUI_EXE", "").strip()
    if override:
        candidate = Path(override).resolve()
        if candidate.is_file():
            return candidate
        raise FileNotFoundError(f"找不到图形界面程序：{candidate}")

    version = executable_version()
    roots = []
    bundle_root = getattr(sys, "_MEIPASS", "")
    if bundle_root:
        roots.append(Path(bundle_root))
    roots.append(Path(sys.executable).resolve().parent)
    names = [
        f"WaHongShu-{version}.exe",
        f"挖红薯-{version}.exe",
    ] if version else []
    for root in roots:
        for name in names:
            candidate = root / name
            if candidate.is_file():
                return candidate
        candidates = sorted(
            path
            for path in root.glob("*.exe")
            if (
                "CLI" not in path.stem.upper()
                and (
                    "挖红薯" in path.stem
                    or "WAHONGSHU" in path.stem.upper()
                )
            )
        )
        if candidates:
            return candidates[-1]
    raise FileNotFoundError("CLI 内没有找到配套的挖红薯图形界面程序")


def relay_events(event_file: Path, offset: int) -> int:
    if not event_file.exists():
        return offset
    with event_file.open("rb") as stream:
        stream.seek(offset)
        data = stream.read()
        offset = stream.tell()
    for raw_line in data.splitlines():
        if not raw_line:
            continue
        try:
            event = json.loads(raw_line.decode("utf-8"))
            destination = sys.stderr if event.get("channel") == "stderr" else sys.stdout
            print(event.get("value", ""), file=destination, flush=True)
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
    return offset


def run(arguments: list[str]) -> int:
    gui_executable = find_gui_executable()
    if not arguments:
        arguments = ["--help"]
    with tempfile.TemporaryDirectory(prefix="wahongshu-cli-") as temporary:
        root = Path(temporary)
        event_file = root / "events.jsonl"
        result_file = root / "result.json"
        environment = os.environ.copy()
        environment["WAHONGSHU_CLI_EVENT_FILE"] = str(event_file)
        environment["WAHONGSHU_CLI_RESULT_FILE"] = str(result_file)
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        process = subprocess.Popen(
            [str(gui_executable), *arguments],
            env=environment,
            creationflags=flags,
        )
        offset = 0
        try:
            while process.poll() is None:
                offset = relay_events(event_file, offset)
                time.sleep(0.1)
            offset = relay_events(event_file, offset)
        except KeyboardInterrupt:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
            else:
                process.terminate()
            return 130

        if result_file.exists():
            try:
                return int(json.loads(result_file.read_text("utf-8"))["exitCode"])
            except (KeyError, ValueError, json.JSONDecodeError):
                pass
        print("CLI 子进程没有返回结构化结果", file=sys.stderr)
        return process.returncode or 1


if __name__ == "__main__":
    try:
        raise SystemExit(run(sys.argv[1:]))
    except Exception as error:
        print(f"CLI 启动失败：{error}", file=sys.stderr)
        raise SystemExit(2)
