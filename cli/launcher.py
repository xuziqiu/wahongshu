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
    match = re.search(r"WaHongShu(?:-CLI)?-(.+)$", stem, re.I)
    if match:
        return match.group(1)
    match = re.search(r"挖红薯(?:-CLI)?-(.+)$", stem, re.I)
    return match.group(1) if match else ""


def cli_environment(environment: dict[str, str] | None = None) -> dict[str, str]:
    cleaned = (environment or os.environ).copy()
    for name in (
        "WAHONGSHU_CLI_EVENT_FILE",
        "WAHONGSHU_CLI_RESULT_FILE",
        "WAHONGSHU_CLI_INVOCATION_FILE",
    ):
        cleaned.pop(name, None)
    return cleaned


def acquire_instance_lock():
    if os.name != "nt":
        return True
    import msvcrt

    local_data = Path(
        os.environ.get("LOCALAPPDATA", tempfile.gettempdir())
    )
    lock_path = local_data / "挖红薯" / "launcher.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    stream = lock_path.open("a+b")
    if stream.tell() == 0:
        stream.write(b"0")
        stream.flush()
    stream.seek(0)
    try:
        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        stream.close()
        return None
    return stream


def release_instance_lock(lock) -> None:
    if lock is True or lock is None:
        return
    if os.name == "nt":
        import msvcrt

        try:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
    lock.close()


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
        roots.extend(
            [
                Path(bundle_root) / "wahongshu-app",
                Path(bundle_root),
            ]
        )
    roots.append(Path(sys.executable).resolve().parent)
    names = [
        "挖红薯.exe",
        f"WaHongShu-{version}.exe",
        f"挖红薯-{version}.exe",
    ] if version else []
    if not version:
        names = ["挖红薯.exe"]
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


def stop_process(process: subprocess.Popen) -> None:
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        process.terminate()


def run_gui() -> int:
    process = subprocess.Popen(
        [str(find_gui_executable())],
        env=cli_environment(),
        creationflags=0,
    )
    try:
        return process.wait()
    except KeyboardInterrupt:
        stop_process(process)
        return 130


def run(arguments: list[str]) -> int:
    gui_executable = find_gui_executable()
    with tempfile.TemporaryDirectory(prefix="wahongshu-cli-") as temporary:
        root = Path(temporary)
        event_file = root / "events.jsonl"
        result_file = root / "result.json"
        invocation_file = root / "invocation.json"
        invocation_file.write_text(
            json.dumps(arguments, ensure_ascii=False),
            encoding="utf-8",
        )
        environment = cli_environment()
        environment["WAHONGSHU_CLI_EVENT_FILE"] = str(event_file)
        environment["WAHONGSHU_CLI_RESULT_FILE"] = str(result_file)
        environment["WAHONGSHU_CLI_INVOCATION_FILE"] = str(invocation_file)
        process = subprocess.Popen(
            [str(gui_executable)],
            env=environment,
            # Electron 43 exits with -1 before app.whenReady() when its main
            # process is started with CREATE_NO_WINDOW on Windows. The target
            # executable is a GUI program already, so it does not open an
            # extra console window without that flag.
            creationflags=0,
        )
        offset = 0
        try:
            while process.poll() is None:
                offset = relay_events(event_file, offset)
                time.sleep(0.1)
            offset = relay_events(event_file, offset)
        except KeyboardInterrupt:
            stop_process(process)
            return 130

        if result_file.exists():
            try:
                return int(json.loads(result_file.read_text("utf-8"))["exitCode"])
            except (KeyError, ValueError, json.JSONDecodeError):
                pass
        print("CLI 子进程没有返回结构化结果", file=sys.stderr)
        return process.returncode or 1


def main(arguments: list[str]) -> int:
    lock = acquire_instance_lock()
    if lock is None:
        print(
            "挖红薯已经在运行。请先关闭图形界面或等待当前命令完成。",
            file=sys.stderr,
        )
        return 3
    try:
        return run(arguments) if arguments else run_gui()
    finally:
        release_instance_lock(lock)


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as error:
        print(f"CLI 启动失败：{error}", file=sys.stderr)
        raise SystemExit(2)
