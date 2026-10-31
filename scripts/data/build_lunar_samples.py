"""Build Quest-sized 3D models of real lunar samples from NASA Astromaterials 3D.

Astromaterials 3D (NASA JSC, ARES Acquisition & Curation Office) photographs Apollo samples and Antarctic meteorites in
the curation labs and reconstructs them by photogrammetry, in metres. The same models are listed on Sketchfab by the
Astromaterials3D account under CC0, but Sketchfab only serves downloads to a signed-in account, so this script takes
the web-resolution model from NASA's own public bucket instead: same data, primary source.

For each sample it downloads NASA's metadata and web-resolution zip (OBJ + JPEG colour map + model-parameters PDF),
then: obj2gltf -> weld -> simplify to about 30,000 triangles (meshoptimizer) -> colour map resized to 2048 x 2048 ->
JPEG. AGENTS.md section 6 caps MVP textures at 2048 x 2048 and keeps the Quest frame budget. Units and the NASA
coordinate registration are kept. Every number in provenance.json is read from NASA's files or measured from the
output by this script; nothing is typed in by hand.

Usage: python3 -I scripts/data/build_lunar_samples.py <work dir for downloads> [sample ...]
Needs network, Node (npx fetches obj2gltf 3 and @gltf-transform/cli 4) and, optionally, pdftotext.
"""
import datetime
import hashlib
import json
import pathlib
import re
import shutil
import struct
import subprocess
import sys
import urllib.request
import zipfile

BUCKET = "https://ares-a3d.s3.us-gov-east-1.amazonaws.com/samples"
PAGE = "https://ares.jsc.nasa.gov/astromaterials3d/sample-details.htm?sample="
CATALOGUES = {
    "lunar": "https://ares.jsc.nasa.gov/astromaterials3d/explorer/lunar_sample_metadata.json",
    "meteorite": "https://ares.jsc.nasa.gov/astromaterials3d/explorer/meteorite_sample_metadata.json",
}
OUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "planets" / "moon" / "samples"
TARGET_TRIANGLES = 30_000
TEXTURE = 2048
JPEG_QUALITY = 88

# Sample -> its listing on Sketchfab (Astromaterials3D account, CC0 Public Domain), from the Sketchfab search API.
SAMPLES = {
    "15016-0": "73c4fa8c048e46638f9f19d5b2785624",
    "15556-0": "172910c9e278470c9d3597fce00b0b60",
    "10022-53": "0650d0ed3e3944438638f58f9534f2a9",
    "14321-1404": "f26186952d794c9db1f27225e0346246",
    "67016-2": "c13f6dde7b0b459ab182327cf47f58c3",
    "MIL090036-35": "fac3f65895d74752a507a151ea56a7e8",
}

NPX = ["npx", "--yes"]
OBJ2GLTF = NPX + ["obj2gltf@3"]
GLTF_TRANSFORM = NPX + ["@gltf-transform/cli@4"]


def fetch(url: str, dst: pathlib.Path) -> pathlib.Path:
    if not dst.exists():
        with urllib.request.urlopen(url, timeout=300) as r, open(dst, "wb") as f:
            shutil.copyfileobj(r, f)
    return dst


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)


def glb_stats(path: pathlib.Path) -> dict:
    """Triangles, vertices, texture size and bounding box, read straight from the GLB's JSON chunk."""
    raw = path.read_bytes()
    json_len = struct.unpack("<I", raw[12:16])[0]
    gltf = json.loads(raw[20 : 20 + json_len])
    acc = gltf["accessors"]
    tris = verts = 0
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for mesh in gltf["meshes"]:
        for p in mesh["primitives"]:
            pos = acc[p["attributes"]["POSITION"]]
            verts += pos["count"]
            tris += acc[p["indices"]]["count"] // 3
            lo = [min(a, b) for a, b in zip(lo, pos["min"])]
            hi = [max(a, b) for a, b in zip(hi, pos["max"])]
    return {
        "triangles": tris,
        "vertices": verts,
        "boundingBoxM": {"min": [round(v, 6) for v in lo], "max": [round(v, 6) for v in hi]},
        "extentCm": [round((b - a) * 100, 1) for a, b in zip(lo, hi)],
    }


def jpeg_size(path: pathlib.Path) -> list[int]:
    """Width and height of the GLB's colour map, from the JPEG's SOF segment (walked segment by segment)."""
    raw = path.read_bytes()
    json_len = struct.unpack("<I", raw[12:16])[0]
    gltf = json.loads(raw[20 : 20 + json_len])
    view = gltf["bufferViews"][gltf["images"][0]["bufferView"]]
    start = 20 + json_len + 8 + view.get("byteOffset", 0)
    jpg = raw[start : start + view["byteLength"]]
    i = 2  # after SOI
    while i < len(jpg):
        marker = jpg[i + 1]
        length = struct.unpack(">H", jpg[i + 2 : i + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", jpg[i + 5 : i + 9])
            return [w, h]
        i += 2 + length
    raise ValueError("no SOF segment")


def model_parameters(pdf: pathlib.Path) -> dict:
    """The facts NASA's model-parameters PDF states about photography and scale, verbatim where it is text."""
    if not shutil.which("pdftotext"):
        return {}
    text = subprocess.run(["pdftotext", str(pdf), "-"], check=True, capture_output=True, text=True).stdout
    flat = " ".join(text.split())
    out: dict = {}
    if m := re.search(r"captured on ([0-9:.]+)", flat):
        out["photographyCaptured"] = m.group(1)
    if m := re.search(r"Camera: ([^•]+?) • Images", flat):
        out["camera"] = m.group(1).strip()
    if m := re.search(r"Low Resolution Model: .*?Scale: (Units: [^•]+?)(?: CREDITS| •)", flat):
        out["scale"] = m.group(1).strip()
    if m := re.search(r"Acknowledgment: (.+?) For a list", flat):
        out["acknowledgment"] = m.group(1).strip()
    return out


def build(sample: str, sketchfab_uid: str, work: pathlib.Path, catalogue: dict) -> dict:
    meta = catalogue[sample]
    folder = f"2b_{sample}_SFM_Web-Resolution-Model_Coordinate-Registered"
    stem = f"{sample}_SFM_Web-Resolution-Model_Coordinate-Registered"
    zip_url = f"{BUCKET}/{sample}/{folder}/{stem}.zip"
    src = fetch(zip_url, work / f"{sample}.zip")
    unpacked = work / sample
    with zipfile.ZipFile(src) as z:
        z.extractall(unpacked)
    obj = unpacked / f"{stem}.obj"
    pdf = next(unpacked.glob("*Model-Parameters.pdf"), None)
    faces = sum(1 for line in obj.open() if line.startswith("f "))

    steps = work / f"{sample}.steps"
    steps.mkdir(exist_ok=True)
    run(OBJ2GLTF + ["-i", str(obj), "-o", str(steps / "0.glb")])
    run(GLTF_TRANSFORM + ["weld", str(steps / "0.glb"), str(steps / "1.glb")])
    ratio = min(1.0, TARGET_TRIANGLES / faces)
    run(GLTF_TRANSFORM + ["simplify", str(steps / "1.glb"), str(steps / "2.glb"), "--ratio", f"{ratio:.4f}", "--error", "0.01"])
    run(GLTF_TRANSFORM + ["resize", str(steps / "2.glb"), str(steps / "3.glb"), "--width", str(TEXTURE), "--height", str(TEXTURE)])
    dst_dir = OUT / sample
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / f"{sample}.glb"
    run(GLTF_TRANSFORM + ["jpeg", str(steps / "3.glb"), str(dst), "--quality", str(JPEG_QUALITY)])

    provenance = {
        "assetFile": dst.name,
        "sample": meta.get("display_name", sample),
        "classification": meta.get("classification"),
        "origin": meta.get("origin"),
        "collected": meta.get("collected"),
        "collection": meta.get("origin_category_title"),
        "source": {
            "organization": "NASA Astromaterials 3D (ARES Acquisition & Curation Office, Johnson Space Center)",
            "pageUrl": PAGE + sample,
            "file": f"{stem}.zip",
            "fileUrl": zip_url,
            "bytes": src.stat().st_size,
            "sha256": sha256(src),
            "downloadedAt": datetime.date.today().isoformat(),
            "sourceModel": f"Web-resolution photogrammetry (SfM) model, coordinate-registered, {faces:,} faces",
            "modelParameters": model_parameters(pdf) if pdf else {},
            "alsoListedAt": {
                "url": f"https://sketchfab.com/3d-models/{sketchfab_uid}",
                "account": "Astromaterials3D",
                "license": "CC0 Public Domain",
                "note": "Same NASA model. Sketchfab downloads need a signed-in account, so the file was taken from NASA's bucket.",
            },
        },
        "credit": "NASA/Astromaterials 3D",
        "license": "CC0 Public Domain (Sketchfab listing). NASA media are generally not copyrighted in the United States; keep the credit and follow NASA's media usage guidelines.",
        "derivation": {
            "script": "scripts/data/build_lunar_samples.py",
            "change": f"OBJ to glTF (obj2gltf 3), vertices welded and simplified to about {TARGET_TRIANGLES:,} triangles with meshoptimizer (@gltf-transform/cli 4, error 0.01), colour map resized to {TEXTURE} x {TEXTURE} and stored as JPEG quality {JPEG_QUALITY}. Units (metres) and NASA's coordinate registration are unchanged.",
            "bytes": dst.stat().st_size,
            "sha256": sha256(dst),
            **glb_stats(dst),
            "textureSize": jpeg_size(dst),
        },
        "use": "A laboratory specimen returned to Earth, shown at its true size. It is reference material: the app never derives measurements of lunar terrain from it, and it is not evidence about a site unless an evidence pack cites it.",
    }
    (dst_dir / "provenance.json").write_text(json.dumps(provenance, indent=2, ensure_ascii=False) + "\n")
    return {"id": sample, "file": f"{sample}/{dst.name}", "sample": provenance["sample"], "classification": provenance["classification"], "collected": provenance["collected"]}


def main(work_dir: str, samples: list[str]) -> None:
    work = pathlib.Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    catalogue: dict = {}
    for name, url in CATALOGUES.items():
        catalogue.update(json.loads(fetch(url, work / f"{name}_sample_metadata.json").read_text()))
    chosen = samples or list(SAMPLES)
    index = [build(s, SAMPLES[s], work, catalogue) for s in chosen]
    if not samples:
        (OUT / "catalog.json").write_text(json.dumps({"credit": "NASA/Astromaterials 3D", "samples": index}, indent=2, ensure_ascii=False) + "\n")
    for row in index:
        print(row["id"], row["classification"])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
