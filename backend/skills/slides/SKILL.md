---
name: slides
description: MUST read before making a presentation, slide deck, PPT/PPTX, or pitch deck.
title: 幻灯片
categories: 内容、设计
summary: 用 HTML 制作演示文稿：先列大纲，再逐页设计，渲染检查后导出 PDF 和 PPTX。
---
# Slides

Decks are one HTML file of fixed-size slides (1280x720), rendered and exported with `slides_export`.

1. **Plan**: write the outline first (`deck_outline.md`): audience, one-sentence message, then one line per
   slide (its takeaway, not a topic). 8-15 slides for most talks. Research facts before writing them.
2. **Start from the template**: copy `skills/slides/template.html` to e.g. `~/slides/<name>/index.html`. Keep its
   `<script>` (viewer: arrow keys, scaling) and base CSS; change the `:root` colors and fonts to suit the topic.
3. **One `<section class="slide">` per slide**, using the layouts in the template (`title`, `section`, `content`,
   `two-col`, `image`, `stat`, `quote`). Rules:
   - The slide title states the takeaway ("出口额三年翻倍"), body text supports it. ≤ 6 bullets, ≤ 15 words each.
   - Text must fit: never shrink below 20px body / 40px titles; split into two slides instead.
   - Real visuals beat decoration: charts (Chart.js from the CDN in the template, `animation: false`), tables,
     diagrams, images (search with info_search_image and download, or media_generate_image when available).
     Put images in the deck folder and reference them relatively.
   - Speaker notes go in `<aside class="notes">` inside the slide.
4. **Render and check**: call `slides_export` with the HTML path; its result shows you every rendered slide. Fix
   overflow, overlap, empty space and contrast in the HTML, then export again. No need to open the browser.
5. **Deliver** the PDF and PPTX (and the HTML) as attachments. The PPTX has one image per slide (not editable
   text); say so if the user may want to edit it.
