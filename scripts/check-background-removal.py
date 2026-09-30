"""Local CPU experiment; never called by the shop or connected to its database.

Run in the isolated .tools/background-removal/venv with the pinned requirements.
Only an alpha mask is inferred: source RGB pixels are not regenerated.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import resource
import time

os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("U2NET_HOME", str(Path(".tools/background-removal/models").resolve()))

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps
import numpy as np
import onnxruntime as ort

MODELS = {
    "birefnet-general-lite": (1024, "4fab47adc4ff364be1713e97b7e66334"),
    "u2netp": (320, "8e83ca70e441ab06c318d82300c84806"),
    "u2net": (320, "60024c5c889badc19c04ad937298a77b"),
}


def load_model(name, compact=False, graph_optimization="all"):
    path = Path(os.environ["U2NET_HOME"]) / f"{name}.onnx"
    # No automatic network access: download and verify the explicit model first.
    if not path.is_file() or hashlib.md5(path.read_bytes()).hexdigest() != MODELS[name][1]:
        raise ValueError(f"Missing or corrupt local model: {name}")
    options = ort.SessionOptions()
    options.intra_op_num_threads = int(os.environ["OMP_NUM_THREADS"])
    options.inter_op_num_threads = 1
    if compact:
        options.enable_cpu_mem_arena = False
        options.enable_mem_pattern = False
    if graph_optimization == "extended":
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED
    return ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])


def predict_mask(session, image, name):
    # Model preprocessing follows the rembg v2.0.72 model contract (see docs).
    size = MODELS[name][0]
    pixels = np.asarray(image.convert("RGB").resize((size, size), Image.Resampling.LANCZOS), dtype=np.float32)
    pixels = pixels / max(float(pixels.max()), 1e-6)
    normalized = (pixels - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)
    tensor = np.ascontiguousarray(normalized.transpose(2, 0, 1)[None])
    prediction = session.run(None, {session.get_inputs()[0].name: tensor})[0][0, 0]
    if name == "birefnet-general-lite":
        prediction = 1.0 / (1.0 + np.exp(-np.clip(prediction, -80, 80)))
    low, high = float(prediction.min()), float(prediction.max())
    if not np.isfinite(prediction).all() or high - low < 1e-8:
        raise ValueError("Model produced an empty or invalid mask")
    mask = np.clip((prediction - low) / (high-low) * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(mask).resize(image.size, Image.Resampling.LANCZOS)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def panel(image, color):
    base = Image.new("RGBA", image.size, color)
    base.alpha_composite(image.convert("RGBA"))
    return ImageOps.contain(base.convert("RGB"), (620, 430))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", choices=list(MODELS), default="birefnet-general-lite")
    parser.add_argument("--compact-memory", action="store_true", help="Disable ORT allocation caching for a constrained CPU worker")
    parser.add_argument("--graph-optimization", choices=["all", "extended"], default="all")
    args = parser.parse_args()
    # Deliberately fail instead of overwriting an earlier experiment.
    args.output.mkdir(parents=True, exist_ok=False)
    Image.MAX_IMAGE_PIXELS = 24_000_000
    report = {"platform": platform.platform(), "processor": platform.machine(),
              "provider": "CPUExecutionProvider", "threads": os.environ["OMP_NUM_THREADS"],
              "model": args.model, "compact_memory": args.compact_memory,
              "graph_optimization": args.graph_optimization, "max_edge": 1600,
              "versions": {p: importlib.metadata.version(p) for p in ["onnxruntime", "pillow", "numpy"]},
              "results": []}
    if platform.system() == "Linux":
        report["cgroup_limits"] = {name: (Path("/sys/fs/cgroup") / name).read_text().strip()
                                  for name in ["memory.max", "memory.swap.max", "cpu.max", "pids.max"]
                                  if (Path("/sys/fs/cgroup") / name).is_file()}
    session = None
    sheet = Image.new("RGB", (1920, 490 * len(args.images)), "#f4f3ef")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype(str(Path(__file__).resolve().parents[1] / "public/fonts/manrope-0.ttf"), 22)
    for index, path in enumerate(args.images):
        before = digest(path)
        with Image.open(path) as opened:
            if opened.format not in ["PNG", "JPEG", "WEBP"] or opened.width * opened.height > 24_000_000:
                raise ValueError("Unsupported image or more than 24 MP")
            original = ImageOps.exif_transpose(opened).convert("RGBA")
        original.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        alpha = np.asarray(original.getchannel("A"))
        pre_cut = bool(np.any(alpha < 250))
        start = time.perf_counter()
        if pre_cut:
            result = original.copy()
            method = "existing_alpha_preserved"
        else:
            if session is None:
                session_start = time.perf_counter()
                session = load_model(args.model, args.compact_memory, args.graph_optimization)
                report["model_load_seconds"] = round(time.perf_counter() - session_start, 3)
                start = time.perf_counter()
            mask = predict_mask(session, original, args.model)
            result = original.copy()
            result.putalpha(mask.convert("L"))
            method = "predicted_alpha_only"
        seconds = round(time.perf_counter() - start, 3)
        stem = f"sample-{index+1}"
        result.save(args.output / f"{stem}-cutout.png")
        original.save(args.output / f"{stem}-original.png")
        result.getchannel("A").save(args.output / f"{stem}-mask.png")
        rgb_equal = ImageChops.difference(original.convert("RGB"), result.convert("RGB")).getbbox() is None
        assert rgb_equal and digest(path) == before
        out_alpha = np.asarray(result.getchannel("A"))
        row = {"sample": stem, "source_name": path.name, "source_sha256": before,
               "dimensions": result.size, "method": method, "inference_seconds": seconds,
               "rgb_unchanged_from_resized_source": rgb_equal, "source_file_unchanged": True,
               "transparent_fraction": round(float(np.mean(out_alpha == 0)), 4),
               "opaque_fraction": round(float(np.mean(out_alpha == 255)), 4)}
        report["results"].append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
        for col, (im, color, label) in enumerate([(original, "white", "Исходное фото"),
                                                (result, "#25272c", "После · тёмный фон"),
                                                (result, "#cb181a", "После · красный фон")]):
            preview = panel(im, color)
            x, y = col * 640, index * 490
            draw.text((x+14, y+12), f"{index+1}. {label}", fill="#222222", font=font)
            sheet.paste(preview, (x + (640-preview.width)//2, y+48+(430-preview.height)//2))
    report["process_peak_rss_bytes"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if platform.system() == "Darwin" else 1024)
    memory_peak = Path("/sys/fs/cgroup/memory.peak")
    if platform.system() == "Linux" and memory_peak.is_file():
        report["cgroup_memory_peak_bytes"] = int(memory_peak.read_text().strip())
    report["model_files"] = [{"name": p.name, "bytes": p.stat().st_size, "sha256": digest(p)}
                             for p in Path(os.environ["U2NET_HOME"]).glob(f"{args.model}.onnx")]
    (args.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n")
    sheet.save(args.output / "comparison.jpg", quality=93)


if __name__ == "__main__":
    main()
