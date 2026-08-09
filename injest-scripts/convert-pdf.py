#!/usr/bin/env python
"""
convert-pdf.py - Convert a source PDF in kb-general/ to markdown in kb-text/.

    python injest-scripts/convert-pdf.py Sharma_Part1
    python injest-scripts/convert-pdf.py Sharma_Part1 Sharma_Part2

Batch sizes are capped for an 8 GB card by default. Override with
MARKER_DETECTION_BATCH / MARKER_LAYOUT_BATCH / MARKER_RECOGNITION_BATCH.

Output mirrors the layout the Santhanam volumes already use, so the ingestion
pipeline picks the result up with no changes:

    kb-text/<name>/<name>.md
    kb-text/<name>/<name>_meta.json
    kb-text/<name>/_page_*_Figure_*.jpeg      (extracted images)

Uses the `marker` PDF pipeline on GPU when one is available.

-- Why the batch sizes are pinned ---------------------------------------------
Run with marker's defaults on an 8 GB laptop 4070, this did not merely run slow,
it *degraded*: bbox detection took 236 s for the first batch, then 1163, then
1638, then 1939, with the ETA climbing from 3h49m to 29h37m while VRAM sat at
7871 of 8188 MiB. That is thrashing -- once the card is full, each batch spends
more time spilling and refetching than computing, so the job never converges.

Small batches keep the working set inside VRAM. Throughput is far higher even
though each step does less.

-- Note on the environment ---------------------------------------------------
marker was unusable in this interpreter until scipy and pandas were upgraded:
numpy 2.4.3 was installed while scipy pinned <1.28 (numpy.Inf was removed in
numpy 2.0), and pandas was still compiled against numpy 1.x. Both were upgraded
forward rather than downgrading numpy, which would have dragged the whole
environment backwards.
"""

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "kb-general"
DST = ROOT / "kb-text"

# Conservative for 8 GB of VRAM. Raise on a bigger card.
BATCH_CONFIG = {
    "detection_batch_size":   int(os.environ.get("MARKER_DETECTION_BATCH", 4)),
    "layout_batch_size":      int(os.environ.get("MARKER_LAYOUT_BATCH", 4)),
    "recognition_batch_size": int(os.environ.get("MARKER_RECOGNITION_BATCH", 16)),
    "ocr_error_batch_size":   int(os.environ.get("MARKER_OCR_ERROR_BATCH", 4)),
}


def convert(name: str, converter) -> None:
    pdf = SRC / f"{name}.pdf"
    if not pdf.exists():
        print(f"  !! {pdf} not found", flush=True)
        return

    out_dir = DST / name
    out_dir.mkdir(parents=True, exist_ok=True)

    size_mb = pdf.stat().st_size / 1e6
    print(f"\n== {name}  ({size_mb:.1f} MB) ==", flush=True)
    started = time.time()

    from marker.output import text_from_rendered

    rendered = converter(str(pdf))
    text, _ext, images = text_from_rendered(rendered)

    (out_dir / f"{name}.md").write_text(text, encoding="utf-8")

    # marker exposes the table of contents / page metadata on the rendered doc.
    meta = getattr(rendered, "metadata", None) or {}
    (out_dir / f"{name}_meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    for img_name, img in (images or {}).items():
        try:
            img.save(out_dir / img_name)
        except Exception as e:  # a single bad image must not lose the whole run
            print(f"     (skipped image {img_name}: {e})", flush=True)

    mins = (time.time() - started) / 60
    print(
        f"   -> {len(text):,} chars, {len(images or {})} images, {mins:.1f} min"
        f"\n   -> {out_dir}",
        flush=True,
    )


def main() -> None:
    names = sys.argv[1:]
    if not names:
        print(__doc__)
        sys.exit(2)

    try:
        import torch

        dev = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    except Exception:
        dev = "unknown"
    print(f"device: {dev}", flush=True)

    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict

    print(f"batch config: {BATCH_CONFIG}", flush=True)
    print("loading marker models...", flush=True)
    converter = PdfConverter(artifact_dict=create_model_dict(), config=BATCH_CONFIG)

    for name in names:
        convert(name, converter)
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    main()
