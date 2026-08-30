#!/usr/bin/env python3

from __future__ import annotations

import struct
import sys
import tempfile
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY))

from tools.po2lmo import convert, read_po, sfh_hash


def main() -> None:
    source = REPOSITORY / "po" / "ru" / "nanopi-control.po"

    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / "nanopi-control.ru.lmo"
        convert(source, output)
        data = output.read_bytes()

    index_offset = struct.unpack(">I", data[-4:])[0]
    assert 0 < index_offset < len(data) - 4
    assert (len(data) - index_offset - 4) % 16 == 0

    entries = [
        struct.unpack(">IIII", data[position : position + 16])
        for position in range(index_offset, len(data) - 4, 16)
    ]
    assert entries == sorted(entries, key=lambda entry: entry[0])

    expected = dict(read_po(source))
    hashes = {entry[0]: entry for entry in entries}
    for msgid in ("Overview", "Information", "Model", "Memory", "Confirm", "Expand"):
        entry = hashes[sfh_hash(msgid.encode("utf-8"))]
        _, plural_count, offset, length = entry
        assert plural_count == 1
        assert data[offset : offset + length].decode("utf-8") == expected[msgid]

    print("PO to LMO conversion tests passed.")


if __name__ == "__main__":
    main()
