"""Derive the AR Moon globe from NASA SVS 14959 (https://svs.gsfc.nasa.gov/14959/).

The NASA file `moon_small.glb` carries a 4096 x 4096 PNG colour map (12 MB). The Quest budget in AGENTS.md section 6
caps MVP textures at 2048 x 2048, so this script re-encodes only that image (Lanczos to 2048 x 2048, JPEG) and copies
everything else byte for byte: mesh, UVs, material and node names are NASA's.

Usage: python3 -I scripts/data/build_moon_globe.py <path to moon_small.glb> <output .glb>
Needs Pillow.
"""
import hashlib
import io
import json
import struct
import sys

from PIL import Image

SIZE = 2048
QUALITY = 90


def pad(data: bytes, fill: bytes) -> bytes:
    return data + fill * ((4 - len(data) % 4) % 4)


def main(src: str, dst: str) -> None:
    raw = open(src, "rb").read()
    magic, version, _ = struct.unpack("<4sII", raw[:12])
    assert magic == b"glTF" and version == 2, "not a glTF 2.0 binary"
    json_len, json_type = struct.unpack("<I4s", raw[12:20])
    assert json_type == b"JSON"
    gltf = json.loads(raw[20 : 20 + json_len])
    bin_header = 20 + json_len
    bin_len, bin_type = struct.unpack("<I4s", raw[bin_header : bin_header + 8])
    assert bin_type == b"BIN\x00"
    blob = raw[bin_header + 8 : bin_header + 8 + bin_len]

    assert len(gltf["images"]) == 1, "expected the single colour map of moon_small.glb"
    image = gltf["images"][0]
    view_index = image["bufferView"]
    views = gltf["bufferViews"]

    # Rebuild the binary chunk view by view so every other view keeps its bytes and only offsets move.
    out = bytearray()
    for i, view in enumerate(views):
        start = view.get("byteOffset", 0)
        data = blob[start : start + view["byteLength"]]
        if i == view_index:
            img = Image.open(io.BytesIO(data)).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=QUALITY, optimize=True)
            data = buf.getvalue()
            image["mimeType"] = "image/jpeg"
        while len(out) % 4:
            out.append(0)
        view["byteOffset"] = len(out)
        view["byteLength"] = len(data)
        out += data
    gltf["buffers"][0]["byteLength"] = len(out)
    gltf.setdefault("asset", {})["extras"] = {
        "derivedFrom": "NASA SVS 14959 moon_small.glb",
        "change": f"colour map re-encoded to {SIZE}x{SIZE} JPEG; geometry and material unchanged",
    }

    json_bytes = pad(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    bin_bytes = pad(bytes(out), b"\x00")
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    with open(dst, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes)
        f.write(struct.pack("<I4s", len(bin_bytes), b"BIN\x00") + bin_bytes)
    print(json.dumps({
        "source": src, "sourceBytes": len(raw), "sourceSha256": hashlib.sha256(raw).hexdigest(),
        "output": dst, "outputBytes": total, "outputSha256": hashlib.sha256(open(dst, "rb").read()).hexdigest(),
    }, indent=2))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
