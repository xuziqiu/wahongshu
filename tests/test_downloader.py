import unittest
from unittest.mock import patch

from core.downloader import (
    ResponseData,
    choose_best,
    download_candidates,
    download_live_photo,
    download_note_video,
)


def response(url: str, payload: bytes) -> ResponseData:
    return ResponseData(
        requested_url=url,
        final_url=url,
        status=200,
        content_type="video/mp4",
        data=payload,
    )


H264_MP4 = b"\x00\x00\x00\x18ftypisomavc1" + b"video"
EF51_MP4 = b"\x00\x00\x00\x18ftypisomef51" + b"video"


class DownloadCoreTests(unittest.TestCase):
    def test_image_primary_success_does_not_download_fallback_versions(self):
        image = {
            "fileId": "notes/test-image",
            "urlDefault": "https://example.test/page-default.jpg",
        }
        primary = ResponseData(
            requested_url="https://ci.xiaohongshu.com/notes/test-image",
            final_url="https://ci.xiaohongshu.com/notes/test-image",
            status=200,
            content_type="image/jpeg",
            data=b"\xff\xd8\xffprimary",
        )
        with patch("core.downloader.fetch", return_value=primary) as mocked:
            results = download_candidates(image, "https://example.test", 5)
        self.assertEqual(mocked.call_count, 1)
        self.assertEqual(choose_best(results)["name"], "raw")

    def test_image_fallback_is_requested_only_after_primary_failure(self):
        image = {
            "fileId": "notes/test-image",
            "urlDefault": "https://example.test/page-default.jpg",
        }

        def fake_fetch(url, **_kwargs):
            if "imageView2" not in url:
                raise TimeoutError("primary unavailable")
            return ResponseData(
                requested_url=url,
                final_url=url,
                status=200,
                content_type="image/jpeg",
                data=b"\xff\xd8\xfffallback",
            )

        with patch("core.downloader.fetch", side_effect=fake_fetch) as mocked:
            results = download_candidates(image, "https://example.test", 5)
        self.assertEqual(mocked.call_count, 2)
        self.assertEqual(choose_best(results)["name"], "jfif")

    def test_heic_uses_one_explicit_check_after_heic_primary(self):
        image = {"fileId": "notes/iphone-image"}

        def fake_fetch(url, **_kwargs):
            payload = (
                b"\x00\x00\x00\x18ftypheicexplicit"
                if "format/heic" in url
                else b"\x00\x00\x00\x18ftypheicprimary"
            )
            return ResponseData(
                requested_url=url,
                final_url=url,
                status=200,
                content_type="image/heic",
                data=payload,
            )

        with patch("core.downloader.fetch", side_effect=fake_fetch) as mocked:
            results = download_candidates(image, "https://example.test", 5)
        self.assertEqual(mocked.call_count, 2)
        self.assertEqual(choose_best(results)["name"], "heic")

    def test_live_photo_prefers_h264(self):
        image = {
            "livePhoto": True,
            "stream": {
                "h265": [{"masterUrl": "https://example.test/h265.mp4"}],
                "h264": [{"masterUrl": "https://example.test/h264.mp4"}],
            },
        }
        with patch(
            "core.downloader.fetch",
            return_value=response(
                "https://example.test/h264.mp4",
                H264_MP4,
            ),
        ) as mocked:
            result = download_live_photo(image, "https://example.test", 5)
        self.assertEqual(result["codec"], "h264")
        self.assertEqual(mocked.call_args.args[0], "https://example.test/h264.mp4")

    def test_video_prefers_declared_h264_over_opaque_ef51(self):
        note = {
            "type": "video",
            "video": {
                "mediaV2": {
                    "video": {
                        "opaque1": {
                            "hd_screencast_stream": (
                                "https://example.test/opaque.mp4"
                            )
                        }
                    }
                },
                "media": {
                    "stream": {
                        "h264": [
                            {
                                "width": 1280,
                                "height": 720,
                                "videoBitrate": 2_000_000,
                                "masterUrl": "https://example.test/h264.mp4",
                            }
                        ]
                    }
                },
            },
        }

        def fake_fetch(url, **_kwargs):
            payload = EF51_MP4 if "opaque" in url else H264_MP4
            return response(url, payload)

        with patch("core.downloader.fetch", side_effect=fake_fetch) as mocked:
            result = download_note_video(note, "https://example.test", 5)
        self.assertEqual(result["codec_hint"], "h264")
        self.assertEqual(result["url"], "https://example.test/h264.mp4")
        self.assertEqual(mocked.call_count, 1)


if __name__ == "__main__":
    unittest.main()
