---
name: document-export
description: MUST read before producing a PDF, Word (.docx), or slide file, or converting Markdown/HTML to another format.
---
# Document export

Only produce the formats the user asked for. A report defaults to Markdown; do not add Word or PDF versions unprompted.

## PDF: render HTML with Chromium (do not use reportlab, xhtml2pdf, or fpdf)
Chinese fonts are installed system-wide (Noto Sans CJK SC, Noto Serif CJK SC, WenQuanYi Zen Hei). Chromium uses them directly;
reportlab-style libraries cannot load these .ttc/CFF fonts, so do not download or convert fonts.

1. Markdown to HTML: `pandoc report.md -s -o report.html --metadata title="..."`
2. Add CSS: `body { font-family: "Noto Sans CJK SC", sans-serif; line-height: 1.7; max-width: 800px; margin: auto; }`
   plus table borders as needed.
3. Print with Playwright (already installed):
```python
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        page = await browser.new_page()
        await page.goto(Path("report.html").resolve().as_uri())
        await page.pdf(path="report.pdf", format="A4", print_background=True,
                       margin={"top": "18mm", "bottom": "18mm", "left": "16mm", "right": "16mm"})
        await browser.close()

asyncio.run(main())
```
4. Verify with `pdffonts report.pdf` (CJK fonts embedded) and `pdftotext report.pdf - | head`.

## Word (.docx)
`pandoc report.md -o report.docx` (add `--reference-doc=ref.docx` only if custom styles are needed). Do not hand-build documents with python-docx unless pandoc cannot express it.
