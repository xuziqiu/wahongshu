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
