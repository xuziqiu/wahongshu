#!/usr/bin/env python3
"""
Download the best publicly exposed image assets from one Xiaohongshu note.

The script intentionally does not claim that the selected file is byte-for-byte
identical to the uploader's local file. It prefers the untransformed `ci` CDN
response and records the selected media in a compact JSON manifest.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import http.client
import json
import re
import struct
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import Request, urlopen


def configure_console() -> None:
    for console_stream in (sys.stdout, sys.stderr):
        if hasattr(console_stream, "reconfigure"):
            console_stream.reconfigure(encoding="utf-8", errors="replace")


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0"
)

WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


@dataclass
class ResponseData:
    requested_url: str
    final_url: str
    status: int
    content_type: str
    data: bytes


def sanitize_url(url: str) -> str:
    """Remove access tokens before writing a URL to the manifest."""
    parts = urlsplit(url)
    if not parts.query:
        return url
    pairs = []
    for item in parts.query.split("&"):
        key = item.split("=", 1)[0]
        if key.lower() in {
            "xsec_token",
            "token",
            "authorization",
            "cookie",
            "sign",
        }:
            pairs.append(f"{key}=REDACTED")
        else:
            pairs.append(item)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "&".join(pairs), ""))


def safe_filename(value: str, fallback: str = "无标题", max_length: int = 80) -> str:
    """Return a readable Windows-safe filename component."""
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    if not value:
        value = fallback
    if value.upper() in WINDOWS_RESERVED_NAMES:
        value = f"_{value}"
    value = value[:max_length].rstrip(" .")
    return value or fallback


def fetch(url: str, referer: str, timeout: int, attempts: int = 3) -> ResponseData:
    last_error: Exception | None = None
    for attempt in range(attempts):
        request = Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "*/*",
                "Referer": referer,
            },
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                return ResponseData(
                    requested_url=url,
                    final_url=response.geturl(),
                    status=getattr(response, "status", 200),
                    content_type=response.headers.get_content_type().lower(),
                    data=response.read(),
                )
        except (
            http.client.IncompleteRead,
            URLError,
            TimeoutError,
            ConnectionError,
        ) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(0.5 * (attempt + 1))
    assert last_error is not None
    raise last_error


def extract_balanced_object(text: str, marker: str) -> str:
    marker_pos = text.find(marker)
    if marker_pos < 0:
        raise ValueError(f"Page does not contain {marker}")
    start = text.find("{", marker_pos + len(marker))
    if start < 0:
        raise ValueError("Initial-state object has no opening brace")

    depth = 0
    quote_char: str | None = None
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if quote_char is not None:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote_char:
                quote_char = None
            continue

        if char in {'"', "'"}:
            quote_char = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]

    raise ValueError("Initial-state object is incomplete")


def normalize_javascript_object(raw: str) -> str:
    # Xiaohongshu currently embeds a JSON-like object containing bare
    # `undefined` values. Convert only values outside normal JSON strings.
    return re.sub(
        r"(?P<prefix>[:\[,])\s*(?:undefined|NaN|Infinity)"
        r"(?=\s*[,}\]])",
        lambda match: f"{match.group('prefix')}null",
        raw,
    )


def parse_initial_state(html: str) -> dict[str, Any]:
    markers = (
        "window.__INITIAL_STATE__=",
        "window.__INITIAL_STATE__ =",
    )
    last_error: Exception | None = None
    for marker in markers:
        try:
            raw = extract_balanced_object(html, marker)
            return json.loads(normalize_javascript_object(raw))
        except (ValueError, json.JSONDecodeError) as error:
            last_error = error
    raise ValueError(f"Unable to parse note initial state: {last_error}")


def note_id_from_url(url: str) -> str:
    match = re.search(
        r"/(?:explore|discovery/item|search_result)/([0-9a-zA-Z]+)",
        url,
    )
    if not match:
        raise ValueError("Unable to find a note ID in the supplied URL")
    return match.group(1)


def note_quality(note: dict[str, Any]) -> int:
    """Prefer the complete detail copy when page state repeats a note card."""
    images = note.get("imageList") or note.get("image_list") or []
    try:
        serialized = json.dumps(note, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        serialized = ""
    score = len(serialized)
    if isinstance(images, list):
        score += len(images) * 10_000
        for image in images:
            if not isinstance(image, dict):
                continue
            if image.get("livePhoto") or image.get("live_photo"):
                score += 100_000
            if (
                image.get("stream")
                or image.get("livePhotoStream")
                or image.get("live_photo_stream")
            ):
                score += 200_000
    if isinstance(note.get("video"), dict):
        score += 300_000
    if "originVideoKey" in serialized or "origin_video_key" in serialized:
        score += 300_000
    if "masterUrl" in serialized or "master_url" in serialized:
        score += 200_000
    return score


def find_note(state: dict[str, Any], note_id: str) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    seen_candidates: set[int] = set()

    def add_candidate(value: Any) -> None:
        if not isinstance(value, dict) or id(value) in seen_candidates:
            return
        candidate_id = value.get("noteId") or value.get("note_id")
        images = value.get("imageList") or value.get("image_list")
        if str(candidate_id).lower() != note_id.lower():
            return
        if not isinstance(images, list) and value.get("type") != "video":
            return
        seen_candidates.add(id(value))
        candidates.append(value)

    note_store = state.get("note", {})
    detail_map = note_store.get("noteDetailMap", {})
    entry = detail_map.get(note_id)
    if isinstance(entry, dict):
        note = entry.get("note", entry)
        add_candidate(note)

    # Page state can contain both a lightweight card and a complete detail copy.
    # Inspect all matching copies so traversal order cannot discard media streams.
    stack: list[Any] = [state]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            add_candidate(value)
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    if candidates:
        return max(candidates, key=note_quality)
    raise ValueError(f"Note {note_id} was not found in the page state")


def image_kind(data: bytes, content_type: str = "") -> tuple[str, str]:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg", ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", ".png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif", ".gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", ".webp"
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:12]
        compatible = data[8:40]
        if brand in {b"avif", b"avis"} or b"avif" in compatible:
            return "avif", ".avif"
        if brand in {b"heic", b"heix", b"hevc", b"hevx", b"mif1"}:
            return "heic", ".heic"
        return "iso-bmff", ".bin"
    if content_type in {"image/heic", "image/heif"}:
        return "heic", ".heic"
    if content_type.startswith("image/"):
        subtype = content_type.split("/", 1)[1].split(";", 1)[0]
        return subtype, f".{subtype}"
    return "unknown", ".bin"


def jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    index = 2
    sof_markers = {
        0xC0,
        0xC1,
        0xC2,
        0xC3,
        0xC5,
        0xC6,
        0xC7,
        0xC9,
        0xCA,
        0xCB,
        0xCD,
        0xCE,
        0xCF,
    }
    while index + 4 <= len(data):
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        index += 2
        if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            continue
        if marker == 0xDA:
            break
        if index + 2 > len(data):
            break
        length = struct.unpack(">H", data[index : index + 2])[0]
        if length < 2 or index + length > len(data):
            break
        if marker in sof_markers and length >= 7:
            height, width = struct.unpack(">HH", data[index + 3 : index + 7])
            return width, height
        index += length
    return None


def image_dimensions(data: bytes, kind: str) -> tuple[int, int] | None:
    if kind == "jpeg":
        return jpeg_dimensions(data)
    if kind == "png" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if kind == "gif" and len(data) >= 10:
        return struct.unpack("<HH", data[6:10])
    if kind == "webp" and len(data) >= 30 and data[12:16] == b"VP8X":
        width = 1 + int.from_bytes(data[24:27], "little")
        height = 1 + int.from_bytes(data[27:30], "little")
        return width, height
    if kind in {"heic", "avif", "iso-bmff"}:
        dimensions: list[tuple[int, int]] = []
        start = 0
        while True:
            marker = data.find(b"ispe", start)
            if marker < 0:
                break
            if marker + 16 <= len(data):
                width, height = struct.unpack(">II", data[marker + 8 : marker + 16])
                if 0 < width < 100_000 and 0 < height < 100_000:
                    dimensions.append((width, height))
            start = marker + 4
        if dimensions:
            return max(dimensions, key=lambda item: item[0] * item[1])
    return None


def is_valid_image(response: ResponseData) -> bool:
    kind, _ = image_kind(response.data, response.content_type)
    return response.status == 200 and bool(response.data) and kind != "unknown"


def candidate_urls(image: dict[str, Any]) -> list[tuple[str, str]]:
    file_id = image.get("fileId") or image.get("file_id")
    candidates: list[tuple[str, str]] = []
    if isinstance(file_id, str) and file_id:
        encoded_id = quote(file_id, safe="/_-")
        base = f"https://ci.xiaohongshu.com/{encoded_id}"
        candidates.extend(
            [
                ("raw", base),
                ("jfif", f"{base}?imageView2/format/jfif"),
                ("heic", f"{base}?imageView2/format/heic"),
            ]
        )
    default_url = image.get("urlDefault") or image.get("url_default")
    if isinstance(default_url, str) and default_url:
        if default_url.startswith("http://"):
            default_url = "https://" + default_url[len("http://") :]
        candidates.append(("page_default", default_url))
    return candidates


def download_candidates(
    image: dict[str, Any],
    referer: str,
    timeout: int,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    seen_hashes: dict[str, str] = {}
    all_urls = candidate_urls(image)
    url_by_name = dict(all_urls)

    def fetch_source(name: str, url: str) -> dict[str, Any]:
        try:
            response = fetch(url, referer=referer, timeout=timeout)
            kind, extension = image_kind(response.data, response.content_type)
            digest = hashlib.sha256(response.data).hexdigest()
            duplicate_of = seen_hashes.get(digest)
            if duplicate_of is None:
                seen_hashes[digest] = name
            return {
                "name": name,
                "url": sanitize_url(response.final_url),
                "status": response.status,
                "content_type": response.content_type,
                "kind": kind,
                "extension": extension,
                "bytes": len(response.data),
                "sha256": digest,
                "dimensions": image_dimensions(response.data, kind),
                "duplicate_of": duplicate_of,
                "_data": response.data,
            }
        except (
            HTTPError,
            URLError,
            TimeoutError,
            ConnectionError,
            http.client.IncompleteRead,
        ) as error:
            return {
                "name": name,
                "url": sanitize_url(url),
                "error": str(error),
                "_data": b"",
            }

    # The unparameterized ci URL is the known primary resource. Only if it
    # fails do we request a transformed JFIF or the page-provided fallback.
    # HEIC is the one deliberate exception: when the successful primary/fallback
    # is already HEIC, the explicit HEIC endpoint is checked once because real
    # iPhone originals were exposed through that route in our verified cases.
    for name in ("raw", "jfif", "page_default"):
        url = url_by_name.get(name)
        if not url:
            continue
        result = fetch_source(name, url)
        results.append(result)
        if not result.get("_data") or result.get("kind") == "unknown":
            continue
        if result.get("kind") == "heic" and url_by_name.get("heic"):
            results.append(fetch_source("heic", url_by_name["heic"]))
        break
    return results


def choose_best(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    valid = [
        item
        for item in candidates
        if item.get("_data") and item.get("kind") != "unknown"
    ]
    if not valid:
        raise RuntimeError("No valid image response was downloaded")

    raw = next((item for item in valid if item["name"] == "raw"), None)
    if raw is not None:
        if raw.get("kind") == "heic":
            explicit_heic = next(
                (item for item in valid if item["name"] == "heic"), None
            )
            if explicit_heic is not None:
                return explicit_heic
        return raw

    jfif = next((item for item in valid if item["name"] == "jfif"), None)
    if jfif is not None:
        if jfif.get("kind") == "heic":
            explicit_heic = next(
                (item for item in valid if item["name"] == "heic"), None
            )
            if explicit_heic is not None:
                return explicit_heic
        return jfif

    return next(
        (item for item in valid if item["name"] == "page_default"),
        valid[0],
    )


def detect_mp4_codec(data: bytes) -> str | None:
    sample = data[:65_536].lower()
    if b"avc1" in sample or b"avc3" in sample:
        return "h264"
    if b"hvc1" in sample or b"hev1" in sample:
        return "h265"
    if b"av01" in sample:
        return "av1"
    if b"vvc1" in sample or b"h266" in sample or b"ef51" in sample:
        return "h266"
    return None


def download_live_photo(
    image: dict[str, Any],
    referer: str,
    timeout: int,
) -> dict[str, Any] | None:
    if not image.get("livePhoto"):
        return None

    stream = image.get("stream")
    if not isinstance(stream, dict):
        return {
            "codec": None,
            "errors": ["Live Photo has no declared stream data"],
            "_data": b"",
        }

    codec_order = ("h264", "h265", "av1", "h266")
    stream_groups = [
        (codec, stream.get(codec))
        for codec in codec_order
        if isinstance(stream.get(codec), list)
    ]
    stream_groups.extend(
        (str(codec), variants)
        for codec, variants in stream.items()
        if codec not in codec_order and isinstance(variants, list)
    )
    errors: list[str] = []
    playable_fallback: dict[str, Any] | None = None
    for declared_codec, variants in stream_groups:
        ordered_variants = sorted(
            (variant for variant in variants if isinstance(variant, dict)),
            key=lambda variant: (
                int(first_value(variant, "width") or 0)
                * int(first_value(variant, "height") or 0),
                int(
                    first_value(
                        variant,
                        "videoBitrate",
                        "video_bitrate",
                    )
                    or 0
                ),
            ),
            reverse=True,
        )
        for variant in ordered_variants:
            if not isinstance(variant, dict):
                continue
            urls: list[str] = []
            master_url = variant.get("masterUrl")
            if isinstance(master_url, str) and master_url:
                urls.append(master_url)
            backup_urls = variant.get("backupUrls")
            if isinstance(backup_urls, list):
                urls.extend(
                    item
                    for item in backup_urls
                    if isinstance(item, str) and item
                )

            for url in urls:
                if url.startswith("http://"):
                    url = "https://" + url[len("http://") :]
                try:
                    response = fetch(url, referer=referer, timeout=timeout)
                    data = response.data
                    if len(data) < 12 or data[4:8] != b"ftyp":
                        errors.append(f"{sanitize_url(url)}: not an MP4/MOV file")
                        continue
                    detected_codec = detect_mp4_codec(data)
                    result = {
                        "codec": detected_codec or declared_codec,
                        "declared_codec": declared_codec,
                        "quality_type": variant.get("qualityType"),
                        "hdr_type": variant.get("hdrType"),
                        "url": sanitize_url(response.final_url),
                        "content_type": response.content_type,
                        "bytes": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(),
                        "extension": ".mp4",
                        "errors": list(errors),
                        "_data": data,
                    }
                    if detected_codec == "h264" or declared_codec == "h264":
                        return result
                    if playable_fallback is None:
                        playable_fallback = result
                except (
                    HTTPError,
                    URLError,
                    TimeoutError,
                    ConnectionError,
                    http.client.IncompleteRead,
                ) as error:
                    errors.append(f"{sanitize_url(url)}: {error}")
    if playable_fallback is not None:
        playable_fallback["errors"] = list(errors)
        return playable_fallback
    return {
        "codec": None,
        "errors": errors or ["Live Photo has no usable stream URL"],
        "_data": b"",
    }


def first_value(mapping: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value is not None:
            return value
    return None


def download_note_video(
    note: dict[str, Any],
    referer: str,
    timeout: int,
) -> dict[str, Any]:
    video = note.get("video")
    if not isinstance(video, dict):
        raise RuntimeError("The video note contains no video data")

    candidate_groups: list[dict[str, Any]] = []
    fallback_groups: list[dict[str, Any]] = []

    origin_key = first_value(
        video,
        "originVideoKey",
        "origin_video_key",
    ) or first_value(note, "originVideoKey", "origin_video_key")
    if isinstance(origin_key, str) and origin_key:
        fallback_groups.append(
            {
                "source": "origin_video_key",
                "urls": [f"https://sns-video-hw.xhscdn.com/{origin_key}"],
            }
        )

    media_v2: dict[str, Any] = {}
    media_v2_raw = video.get("mediaV2")
    if isinstance(media_v2_raw, str):
        try:
            parsed = json.loads(media_v2_raw)
            if isinstance(parsed, dict):
                media_v2 = parsed
        except json.JSONDecodeError:
            pass
    elif isinstance(media_v2_raw, dict):
        media_v2 = media_v2_raw

    media_v2_video = media_v2.get("video", {})
    if isinstance(media_v2_video, dict):
        opaque = media_v2_video.get("opaque1", {})
        if isinstance(opaque, dict):
            for label, key in (
                ("hd_screencast_stream", "hd_screencast_stream"),
                ("default_screencast_stream", "default_screencast_stream"),
            ):
                url = opaque.get(key)
                if isinstance(url, str) and url:
                    fallback_groups.append(
                        {
                            "source": label,
                            "urls": [url],
                        }
                    )

    stream_sources: list[dict[str, Any]] = []
    media = video.get("media")
    if isinstance(media, dict):
        stream = media.get("stream")
        if isinstance(stream, dict):
            stream_sources.append(stream)
    media_v2_stream = media_v2_video.get("stream")
    if isinstance(media_v2_stream, dict):
        stream_sources.append(media_v2_stream)

    stream_variants: list[dict[str, Any]] = []
    codec_compatibility = {
        "h264": 4_000_000_000_000_000_000,
        "h265": 3_000_000_000_000_000_000,
        "av1": 2_000_000_000_000_000_000,
        "h266": 1_000_000_000_000_000_000,
    }
    # Browser-rendered state may replace codec property names with stable
    # wire identifiers even though each variant still declares videoCodec.
    opaque_codec_hints = {
        "EF4": "h264",
        "EF5": "h265",
        "EF6": "av1",
        "EF7": "h266",
    }
    for stream in stream_sources:
        for stream_key, variants in stream.items():
            if not isinstance(variants, list):
                continue
            for variant in variants:
                if not isinstance(variant, dict):
                    continue
                declared_codec = str(
                    first_value(variant, "videoCodec", "video_codec")
                    or stream_key
                )
                codec = declared_codec.lower()
                if codec not in codec_compatibility:
                    codec = opaque_codec_hints.get(declared_codec.upper(), "unknown")
                width = int(first_value(variant, "width") or 0)
                height = int(first_value(variant, "height") or 0)
                bitrate = int(
                    first_value(variant, "videoBitrate", "video_bitrate") or 0
                )
                compatibility = codec_compatibility.get(codec, 0)
                stream_variants.append(
                    {
                        "source": (
                            "declared_stream"
                            if declared_codec.lower() in codec_compatibility
                            else "opaque_stream"
                        ),
                        "codec_hint": codec,
                        "declared_codec": declared_codec,
                        "width_hint": width,
                        "height_hint": height,
                        "bitrate_hint": bitrate,
                        "variant": variant,
                        "score": (
                            compatibility
                            + width * height * 1_000_000
                            + bitrate
                        ),
                    }
                )

    stream_variants.sort(key=lambda item: item["score"], reverse=True)
    for item in stream_variants:
        variant = item["variant"]
        urls: list[str] = []
        master_url = first_value(variant, "masterUrl", "master_url")
        if isinstance(master_url, str) and master_url:
            urls.append(master_url)
        backup_urls = first_value(variant, "backupUrls", "backup_urls")
        if isinstance(backup_urls, list):
            urls.extend(
                url for url in backup_urls if isinstance(url, str) and url
            )
        if urls:
            candidate_groups.append(
                {
                    key: value
                    for key, value in item.items()
                    if key not in {"variant", "score"}
                }
                | {"urls": urls}
            )

    candidate_groups.extend(fallback_groups)

    errors: list[str] = []
    seen_urls: set[str] = set()
    for group in candidate_groups:
        for url in group["urls"]:
            if url.startswith("http://"):
                url = "https://" + url[len("http://") :]
            if url in seen_urls:
                continue
            seen_urls.add(url)
            try:
                response = fetch(url, referer=referer, timeout=timeout)
                data = response.data
                if len(data) < 12 or data[4:8] != b"ftyp":
                    errors.append(f"{sanitize_url(url)}: not an MP4/MOV file")
                    continue
                detected_codec = detect_mp4_codec(data)
                if detected_codec != "h264":
                    errors.append(
                        f"{sanitize_url(url)}: video is not compatible H.264"
                    )
                    continue
                result = {
                    key: value
                    for key, value in group.items()
                    if key != "urls"
                }
                result.update(
                    {
                        "url": sanitize_url(response.final_url),
                        "content_type": response.content_type,
                        "bytes": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(),
                        "md5": hashlib.md5(data).hexdigest(),
                        "extension": ".mp4",
                        "codec": detected_codec,
                        "errors": errors,
                        "_data": data,
                    }
                )
                return result
            except (
                HTTPError,
                URLError,
                TimeoutError,
                ConnectionError,
                http.client.IncompleteRead,
            ) as error:
                errors.append(f"{sanitize_url(url)}: {error}")

    raise RuntimeError(
        "No valid public video stream was downloaded"
        + (f": {'; '.join(errors)}" if errors else "")
    )


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    configure_console()
    parser = argparse.ArgumentParser(
        description=(
            "Download the best publicly exposed image assets from one "
            "Xiaohongshu note."
        )
    )
    parser.add_argument(
        "url",
        nargs="?",
        help="Full note URL, including xsec_token",
    )
    parser.add_argument(
        "--url-stdin",
        action="store_true",
        help="Read the note URL from stdin so temporary tokens stay out of argv.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        help="Output directory (default: downloads/<title>_[<note-id>])",
    )
    parser.add_argument(
        "--out-root",
        type=Path,
        help="Create the title_[note-id] folder below this directory.",
    )
    parser.add_argument(
        "--page-html",
        type=Path,
        help=(
            "Use an authenticated page snapshot supplied by the browser "
            "extension instead of requesting the note page again."
        ),
    )
    parser.add_argument("--timeout", type=int, default=45)
    args = parser.parse_args(argv)

    request_url = (
        sys.stdin.readline().strip() if args.url_stdin else str(args.url or "")
    )
    if not request_url:
        raise ValueError("A note URL is required")
    note_id = note_id_from_url(request_url)
    if args.page_html:
        html = args.page_html.read_text(encoding="utf-8")
        page_final_url = request_url
    else:
        page = fetch(
            request_url,
            referer="https://www.xiaohongshu.com/",
            timeout=args.timeout,
        )
        html = page.data.decode("utf-8", errors="replace")
        page_final_url = page.final_url
    state = parse_initial_state(html)
    note = find_note(state, note_id)
    title = str(note.get("title") or "").strip()
    safe_title = safe_filename(title)
    output_dir = (
        args.out
        or (args.out_root or Path("downloads"))
        / f"{safe_title}_[{note_id}]"
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    images = note.get("imageList") or note.get("image_list")
    note_type = str(note.get("type") or "")
    if note_type != "video" and (not isinstance(images, list) or not images):
        raise RuntimeError("The note contains no downloadable image list")
    image_count = len(images) if isinstance(images, list) else 0

    manifest: dict[str, Any] = {
        "note_id": note_id,
        "source_url": sanitize_url(request_url),
        "page_final_url": sanitize_url(page_final_url),
        "downloaded_at_utc": datetime.now(timezone.utc).isoformat(),
        "title": title,
        "note_type": note_type,
        "image_count": image_count if note_type != "video" else 0,
        "cover_image_count": image_count if note_type == "video" else 0,
        "selection_policy": (
            "Prefer an origin video key when publicly exposed; otherwise use "
            "the highest public video stream. For images, prefer the "
            "untransformed ci CDN response. JFIF/page-default are requested "
            "only if that primary resource fails; HEIC is checked once only "
            "when the response is already HEIC. These are best public masters, not proof of the "
            "uploader's byte-identical local originals."
        ),
        "images": [],
    }

    if note_type == "video":
        print("[1/1] downloading best public video stream...")
        video_result = download_note_video(
            note,
            referer=request_url,
            timeout=args.timeout,
        )
        video_path = output_dir / f"{safe_title}_01{video_result['extension']}"
        video_path.write_bytes(video_result["_data"])
        public_video = {
            key: value
            for key, value in video_result.items()
            if key != "_data"
        }
        public_video["index"] = 1
        public_video["media_file"] = video_path.name
        video_data = note.get("video", {})
        media = video_data.get("media", {}) if isinstance(video_data, dict) else {}
        declared_video = (
            media.get("video", {}) if isinstance(media, dict) else {}
        )
        if isinstance(declared_video, dict):
            public_video["declared_source_md5"] = declared_video.get("md5")
            public_video["declared_width"] = declared_video.get("width")
            public_video["declared_height"] = declared_video.get("height")
            public_video["declared_duration_seconds"] = declared_video.get(
                "duration"
            )
        manifest["videos"] = [public_video]
        print(
            f"  saved {video_path} "
            f"({video_result['source']}, {video_result['bytes']} bytes)"
        )

    live_failures: list[str] = []
    for index, image in enumerate(images if note_type != "video" else [], start=1):
        print(f"[{index}/{len(images)}] 正在获取第 {index} 张图片…")
        results = download_candidates(
            image,
            referer=request_url,
            timeout=args.timeout,
        )
        best = choose_best(results)
        media_stem = f"{safe_title}_{index:02d}"
        selected_path = output_dir / f"{media_stem}{best['extension']}"
        selected_path.write_bytes(best["_data"])
        live_result = download_live_photo(
            image,
            referer=request_url,
            timeout=args.timeout,
        )
        live_path: Path | None = None
        if live_result and live_result.get("_data"):
            live_path = (
                output_dir
                / f"{media_stem}_Live{live_result['extension']}"
            )
            live_path.write_bytes(live_result["_data"])

        image_manifest = {
            "index": index,
            "page_width": image.get("width"),
            "page_height": image.get("height"),
            "file_id": image.get("fileId") or image.get("file_id"),
            "selected_candidate": best["name"],
            "media_file": selected_path.name,
            "source_url": best["url"],
            "selected_kind": best["kind"],
            "selected_bytes": best["bytes"],
            "selected_sha256": best["sha256"],
            "selected_dimensions": best.get("dimensions"),
            "live_photo_expected": bool(image.get("livePhoto")),
            "live_photo": live_path is not None,
        }
        if live_result is not None:
            public_live = {
                key: value
                for key, value in live_result.items()
                if key != "_data"
            }
            public_live["media_file"] = (
                live_path.name if live_path is not None else None
            )
            image_manifest["live_stream"] = public_live
        manifest["images"].append(image_manifest)
        print(
            f"  saved {selected_path} "
            f"({best['kind']}, {best['bytes']} bytes, "
            f"{best.get('dimensions')})"
        )
        if live_path is not None and live_result is not None:
            print(
                f"  saved {live_path} "
                f"({live_result['codec']}, {live_result['bytes']} bytes)"
            )
        elif image.get("livePhoto"):
            reason = "; ".join(live_result.get("errors", [])) if live_result else (
                "Live Photo has no stream data"
            )
            live_failures.append(f"image {index}: {reason}")

    manifest_path = output_dir / "manifest.json"
    write_json(manifest_path, manifest)
    print(f"manifest: {manifest_path}")
    if live_failures:
        raise RuntimeError(
            "Live Photo video download failed: " + " | ".join(live_failures)
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        raise SystemExit(130)
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
