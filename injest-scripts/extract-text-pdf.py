#!/usr/bin/env python
"""
extract-text-pdf.py - Fast path for born-digital PDFs.

    python injest-scripts/extract-text-pdf.py BPHS

Some PDFs carry a real text layer put there by the typesetter; others carry a
scanner's legacy OCR, which is usually worse than re-OCR'ing the page images.
This script is for the first kind only. Run `--probe` to tell them apart before
committing to either route.

    python injest-scripts/extract-text-pdf.py --probe

-- Why this matters here -----------------------------------------------------
All four PDFs in kb-general/ report a text layer, but they are not equivalent:

  Santhanam_Part1.pdf   scanner OCR.  "If there 5e a birth ... Mars ot Saturn",
                        and Devanagari reduced to  Rdt e3t crfq FFt ii {n $t r
  BPHS.pdf              born-digital. Clean prose, no OCR artefacts at all,
                        `Ch. N. Title` headings for all 97 chapters, and 1887
                        numbered verses. No Devanagari.

So the scanned volumes still need marker (hours on a GPU), while BPHS.pdf
extracts perfectly in seconds. Checking first turned an 11-hour job into a
5-second one, and produced *better* structure than the OCR route: chapter
coverage goes from 10% to complete.

Output mirrors the kb-text/<name>/ layout so ingestion picks it up unchanged,
with `Ch. N. Title` rewritten as `#### Chapter N Title` to match the heading
form the structure parser already understands.
"""

import json
import re
import sys
from pathlib import Path

import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "kb-general"
DST = ROOT / "kb-text"

CHAPTER_RE = re.compile(r"Ch\.\s*(\d{1,3})\.\s*([^\n]{0,70})")


def read_pages(pdf_path: Path):
    doc = pdfium.PdfDocument(str(pdf_path))
    return [doc[i].get_textpage().get_text_range() for i in range(len(doc))]


def probe() -> None:
    """Report whether each PDF's text layer is trustworthy."""
    print(f"{'file':26} {'pages':>6} {'MB':>6}  {'devanagari':>10}  {'english':>7}  verdict")
    for pdf in sorted(SRC.glob("*.pdf")):
        pages = read_pages(pdf)
        sample = "\n".join(pages[len(pages) // 4 : len(pages) // 4 + 12])
        dev = sum(1 for c in sample if "ऀ" <= c <= "ॿ")

        # Judge the ENGLISH by whether common function words survive.
        #
        # An earlier version counted stray digits inside words and got every
        # file backwards. Sharma's PDFs use a legacy non-Unicode font, so their
        # English decodes to digits and Devanagari glyphs rather than to mangled
        # letters -- there were no garbled *words* to count because there were
        # no words at all. Function words are the robust signal: real English
        # runs 10-25% of them, a broken encoding is near 0%.
        words = re.findall(r"[A-Za-z]{2,}", sample)
        common = {"the", "of", "and", "is", "be", "will", "in", "to", "or",
                  "if", "with", "for", "that", "are", "as", "by", "from",
                  "this", "he", "his", "which", "not"}
        hits = sum(1 for w in words if w.lower() in common)
        ratio = hits / max(1, len(words))

        if ratio > 0.10:
            verdict = "clean English -- extract directly"
        elif dev > 200:
            verdict = "Devanagari OK, English broken -- needs OCR"
        else:
            verdict = "unusable text layer -- needs OCR"

        print(f"{pdf.name:26} {len(pages):6} {pdf.stat().st_size/1e6:6.1f}  "
              f"{dev:10}  {ratio*100:6.1f}%  {verdict}")


def extract(name: str) -> None:
    pdf = SRC / f"{name}.pdf"
    if not pdf.exists():
        print(f"!! {pdf} not found")
        return

    pages = read_pages(pdf)
    out_dir = DST / name
    out_dir.mkdir(parents=True, exist_ok=True)

    body: list[str] = []
    toc: list[dict] = []

    for page_no, raw in enumerate(pages):
        text = raw.replace("\r", "")
        # Rejoin words split across a line break by hyphenation.
        text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)

        for line in text.split("\n"):
            line = line.strip()
            if not line:
                body.append("")
                continue

            m = CHAPTER_RE.match(line)
            if m:
                num, title = int(m.group(1)), m.group(2).strip(" .")
                # Match the heading form the markdown structure parser expects.
                body.append(f"\n#### Chapter {num} {title}\n")
                toc.append({"chapter": num, "title": title, "page": page_no})
                continue

            body.append(line)

    md = "\n".join(body)
    # Collapse runs of blank lines left by page furniture.
    md = re.sub(r"\n{3,}", "\n\n", md)

    (out_dir / f"{name}.md").write_text(md, encoding="utf-8")
    (out_dir / f"{name}_meta.json").write_text(
        json.dumps({"source_pdf": pdf.name, "pages": len(pages),
                    "extraction": "text-layer", "table_of_contents": toc},
                   indent=2, ensure_ascii=False),
        encoding="utf-8")

    chapters = sorted({t["chapter"] for t in toc})
    print(f"{name}: {len(md):,} chars, {len(pages)} pages, "
          f"{len(chapters)} chapters ({min(chapters)}-{max(chapters)})" if chapters
          else f"{name}: {len(md):,} chars, no chapters detected")
    print(f"  -> {out_dir}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or "--probe" in args:
        probe()
        if not args:
            print("\nusage: python injest-scripts/extract-text-pdf.py <NAME> [...]")
    else:
        for n in args:
            extract(n)
