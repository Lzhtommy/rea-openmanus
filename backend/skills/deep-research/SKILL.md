---
name: deep-research
description: MUST read before the first search of any research, investigation, comparison, or report-writing task.
---
# Deep research

1. Break the question into dimensions (e.g. market size, applications, supply chain, competitors, regulation, risks) and search each with focused queries. Issue several info_search_web calls in one turn when they are independent.
2. Read primary sources, not snippets: call info_extract_webpage on the most authoritative results — several URLs in one turn so they are fetched in parallel. Prefer regulators, official statistics, company filings, and original research over news rewrites.
3. Keep a notes file (e.g. `research_notes.md`) with each fact, its number, and its source URL as you go. Where sources disagree (different scopes or definitions), record both and say why they differ instead of picking one.
4. When there are many similar entities to research, use agent_map_reduce with one item per entity.
5. Write the report in Markdown section by section, cite sources inline as links, and end with key findings and an outlook. Re-read the finished file to check every claim has a source, then attach it in the final message with kind="result". Deliver Markdown unless the user asked for another format; for PDF or Word read the document-export skill first.
