#!/usr/bin/env python3
"""Generates the extension icons (no third-party dependencies).

Run from the repository root:  python3 scripts/make-icons.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "src" / "icons"
SIZES = (16, 32, 48, 128)
BACKGROUND = (13, 110, 253)
FOREGROUND = (255, 255, 255)
SUPERSAMPLE = 4


def rounded_rect_contains(x: float, y: float, size: float, radius: float) -> bool:
    if x < 0 or y < 0 or x > size or y > size:
        return False
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2


def bar_contains(x: float, y: float, size: float) -> bool:
    bars = (
        (0.22, 0.36, 0.56),
        (0.31, 0.50, 0.38),
        (0.39, 0.64, 0.22),
    )
    for top, center, width in bars:
        half = width / 2
        height = 0.085
        if abs(x / size - 0.5) <= half and abs(y / size - center) <= height / 2:
            return True
    return False


def render(size: int) -> bytes:
    radius = size * 0.23
    step = 1 / SUPERSAMPLE
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            bg_hits = 0
            fg_hits = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    x = px + (sx + 0.5) * step
                    y = py + (sy + 0.5) * step
                    if not rounded_rect_contains(x, y, size, radius):
                        continue
                    bg_hits += 1
                    if bar_contains(x, y, size):
                        fg_hits += 1
            total = SUPERSAMPLE * SUPERSAMPLE
            alpha = round(255 * bg_hits / total)
            if bg_hits == 0:
                row.extend((0, 0, 0, 0))
                continue
            fg_ratio = fg_hits / bg_hits
            color = tuple(
                round(BACKGROUND[i] * (1 - fg_ratio) + FOREGROUND[i] * fg_ratio) for i in range(3)
            )
            row.extend((*color, alpha))
        rows.append(bytes(row))
    return b"".join(b"\x00" + row for row in rows)


def write_png(path: Path, size: int, raw: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", header)
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        target = OUT_DIR / f"icon-{size}.png"
        write_png(target, size, render(size))
        print(f"wrote {target.relative_to(OUT_DIR.parent.parent)}")


if __name__ == "__main__":
    main()
