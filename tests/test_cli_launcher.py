import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from cli import launcher


class CliLauncherTests(unittest.TestCase):
    def test_extracts_version_from_ascii_and_chinese_names(self):
        self.assertEqual(
            launcher.executable_version(Path("WaHongShu-1.3.0.exe")),
            "1.3.0",
        )
        self.assertEqual(
            launcher.executable_version(Path("WaHongShu-CLI-1.2.3.exe")),
            "1.2.3",
        )
        self.assertEqual(
            launcher.executable_version(Path("挖红薯-CLI-2.0.0.exe")),
            "2.0.0",
        )

    def test_override_selects_existing_gui_executable(self):
        with tempfile.TemporaryDirectory() as temporary:
            executable = Path(temporary) / "WaHongShu-1.2.3.exe"
            executable.touch()
            with mock.patch.dict(
                os.environ,
                {"WAHONGSHU_GUI_EXE": str(executable)},
                clear=False,
            ):
                self.assertEqual(launcher.find_gui_executable(), executable.resolve())

    def test_bundled_cli_prefers_unpacked_electron_runtime(self):
        with tempfile.TemporaryDirectory() as temporary:
            bundle_root = Path(temporary)
            executable = bundle_root / "wahongshu-app" / "挖红薯.exe"
            executable.parent.mkdir()
            executable.touch()
            with mock.patch.object(launcher.sys, "_MEIPASS", str(bundle_root), create=True):
                with mock.patch.object(
                    launcher.sys,
                    "executable",
                    str(bundle_root / "WaHongShu-1.3.0.exe"),
                ):
                    self.assertEqual(launcher.find_gui_executable(), executable)

    def test_no_arguments_open_the_gui_mode(self):
        with mock.patch.object(launcher, "acquire_instance_lock", return_value=True):
            with mock.patch.object(launcher, "release_instance_lock") as release:
                with mock.patch.object(launcher, "run_gui", return_value=0) as run_gui:
                    self.assertEqual(launcher.main([]), 0)
        run_gui.assert_called_once_with()
        release.assert_called_once_with(True)

    def test_busy_instance_returns_a_clear_nonzero_code(self):
        with mock.patch.object(launcher, "acquire_instance_lock", return_value=None):
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                self.assertEqual(launcher.main(["--version"]), 3)
        self.assertIn("已经在运行", stderr.getvalue())

    def test_gui_mode_removes_cli_bridge_variables(self):
        process = mock.Mock()
        process.wait.return_value = 0
        with mock.patch.object(
            launcher,
            "find_gui_executable",
            return_value=Path("C:/test/挖红薯.exe"),
        ):
            with mock.patch.object(launcher.subprocess, "Popen", return_value=process) as popen:
                with mock.patch.dict(
                    os.environ,
                    {"WAHONGSHU_CLI_INVOCATION_FILE": "stale.json"},
                    clear=False,
                ):
                    self.assertEqual(launcher.run_gui(), 0)
        self.assertNotIn(
            "WAHONGSHU_CLI_INVOCATION_FILE",
            popen.call_args.kwargs["env"],
        )

    def test_launches_electron_without_hidden_console_flag(self):
        process = mock.Mock()
        process.poll.side_effect = [None, 0]
        process.returncode = 0
        captured = {}

        def launch(command, **kwargs):
            captured["command"] = command
            captured["arguments"] = json.loads(
                Path(kwargs["env"]["WAHONGSHU_CLI_INVOCATION_FILE"]).read_text(
                    encoding="utf-8"
                )
            )
            return process

        with tempfile.TemporaryDirectory() as temporary:
            executable = Path(temporary) / "挖红薯.exe"
            executable.touch()
            with mock.patch.object(launcher, "find_gui_executable", return_value=executable):
                with mock.patch.object(launcher.subprocess, "Popen", side_effect=launch) as popen:
                    with mock.patch.object(launcher.time, "sleep"):
                        result = launcher.run(["--version"])
        self.assertEqual(result, 1)
        self.assertEqual(captured["command"], [str(executable)])
        self.assertEqual(captured["arguments"], ["--version"])
        self.assertEqual(popen.call_args.kwargs["creationflags"], 0)

    def test_relays_stdout_and_stderr_events(self):
        with tempfile.TemporaryDirectory() as temporary:
            event_file = Path(temporary) / "events.jsonl"
            event_file.write_text(
                "\n".join(
                    [
                        json.dumps({"channel": "stdout", "value": "done"}),
                        json.dumps({"channel": "stderr", "value": "working"}),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            stdout = io.StringIO()
            stderr = io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                offset = launcher.relay_events(event_file, 0)
            self.assertEqual(offset, event_file.stat().st_size)
            self.assertEqual(stdout.getvalue(), "done\n")
            self.assertEqual(stderr.getvalue(), "working\n")


if __name__ == "__main__":
    unittest.main()
