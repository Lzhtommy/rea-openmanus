---
name: skill-creator
description: MUST read when the user asks to create, write, or improve a skill (a reusable SKILL.md instruction package).
title: 技能创建器
categories: 自动化、编程
summary: 把一套可复用的做法写成技能：澄清需求、编写 SKILL.md 和配套脚本、实测后交付。
---
# Creating a skill

A skill is a directory with a `SKILL.md` and optional supporting files (scripts, templates, reference docs).
Agents see only each skill's `name` and `description` up front and read the body when a task matches, so:

1. Clarify what recurring task the skill covers, what a good result looks like, and any fixed formats,
   tools, or data sources. Ask the user only for what you cannot infer; one round of questions at most.
2. Write it to `~/skills-draft/<name>/SKILL.md` (`<name>`: lowercase letters, digits and hyphens):
   ```
   ---
   name: <name>
   description: <when to use it, starting with a trigger phrase, e.g. "MUST read before ...". One sentence.>
   title: <short display name in the user's language>
   categories: <one or two of 编程、数据、自动化、商业、设计、媒体、内容、应用>
   ---
   # <Title>
   <the procedure: numbered steps, decisions, output format, quality checks, pitfalls>
   ```
3. Keep the body under ~300 lines of imperative, specific instructions. Put long reference material or
   reusable code in sibling files (e.g. `scripts/build.py`, `reference.md`) and tell the reader when to open them.
4. Test it: run the procedure once on a small realistic example and fix the instructions where you
   stumbled. Test any bundled scripts.
5. Deliver with message_notify_user (kind="result"), attaching `~/skills-draft/<name>/SKILL.md`. Tell the user
   they can add it with "添加到我的技能" on the file card.
