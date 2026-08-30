#!/usr/bin/env python3
"""Small development-time PO to LuCI LMO converter.

The release build still uses OpenWrt's official po2lmo utility. This compatible
converter lets NanoPi Control translations be tested on a router without
running the complete OpenWrt SDK build.
"""

from __future__ import annotations

import ast
import struct
import sys
from pathlib import Path

MASK32 = 0xFFFFFFFF


def _u32(value: int) -> int:
    return value & MASK32


def _signed_byte(value: int) -> int:
    return value if value < 0x80 else value - 0x100


def sfh_hash(data: bytes) -> int:
    """Paul Hsieh SuperFastHash as used by LuCI's lmo.c."""
    length = len(data)
    if not length:
        return 0

    value = length
    blocks, remainder = divmod(length, 4)
    offset = 0

    for _ in range(blocks):
        first = data[offset] | (data[offset + 1] << 8)
        second = data[offset + 2] | (data[offset + 3] << 8)
        value = _u32(value + first)
        temporary = _u32((second << 11) ^ value)
        value = _u32((value << 16) ^ temporary)
        offset += 4
        value = _u32(value + (value >> 11))

    if remainder == 3:
        value = _u32(value + data[offset] + (data[offset + 1] << 8))
        value = _u32(value ^ (value << 16))
        value = _u32(value ^ (_signed_byte(data[offset + 2]) << 18))
        value = _u32(value + (value >> 11))
    elif remainder == 2:
        value = _u32(value + data[offset] + (data[offset + 1] << 8))
        value = _u32(value ^ (value << 11))
        value = _u32(value + (value >> 17))
    elif remainder == 1:
        value = _u32(value + _signed_byte(data[offset]))
        value = _u32(value ^ (value << 10))
        value = _u32(value + (value >> 1))

    value = _u32(value ^ (value << 3))
    value = _u32(value + (value >> 5))
    value = _u32(value ^ (value << 4))
    value = _u32(value + (value >> 17))
    value = _u32(value ^ (value << 25))
    return _u32(value + (value >> 6))


def _quoted(line: str) -> str:
    return ast.literal_eval(line[line.index('"'):])


def read_po(path: Path) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    current: dict[str, str] = {}
    active: str | None = None

    def flush() -> None:
        nonlocal current, active
        msgid = current.get("msgid", "")
        msgstr = current.get("msgstr", "")
        if msgid and msgstr:
            entries.append((msgid, msgstr))
        current = {}
        active = None

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            flush()
        elif line.startswith("#"):
            continue
        elif line.startswith("msgid_plural") or line.startswith("msgstr["):
            raise ValueError("Plural PO entries are not supported by the development converter")
        elif line.startswith("msgid "):
            if "msgid" in current:
                flush()
            active = "msgid"
            current[active] = _quoted(line)
        elif line.startswith("msgstr "):
            active = "msgstr"
            current[active] = _quoted(line)
        elif line.startswith('"') and active:
            current[active] += ast.literal_eval(line)

    flush()
    return entries


def convert(source: Path, destination: Path) -> None:
    values = bytearray()
    index: list[tuple[int, int, int, int]] = []

    for msgid, msgstr in read_po(source):
        key = msgid.encode("utf-8")
        value = msgstr.encode("utf-8")
        key_hash = sfh_hash(key)
        if key_hash == sfh_hash(value):
            continue

        offset = len(values)
        values.extend(value)
        values.extend(b"\0" * ((4 - len(value) % 4) % 4))
        index.append((key_hash, 1, offset, len(value)))

    if not index:
        raise ValueError("PO file contains no translated entries")

    index.sort(key=lambda entry: entry[0])
    output = bytearray(values)
    index_offset = len(output)
    for entry in index:
        output.extend(struct.pack(">IIII", *entry))
    output.extend(struct.pack(">I", index_offset))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(output)


def main() -> int:
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} input.po output.lmo", file=sys.stderr)
        return 2
    convert(Path(sys.argv[1]), Path(sys.argv[2]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
