---
name: browser-tasks
description: MUST read before logging in, filling forms, booking, ordering, or purchasing anything in the browser.
title: 浏览器操作
categories: 自动化
summary: 在浏览器里登录、填写表单、预订和下单时遵循的安全步骤：先确认、不猜密码、遇到验证码请用户接管。
---
# Interactive browser tasks

- Never guess credentials. If a login, 2FA, or CAPTCHA appears, use message_ask_user with suggest_user_takeover="browser".
- Before any purchase, booking, or submission that commits the user, summarize the details and get explicit confirmation via message_ask_user.
- After each click or input, check the new observation before the next action; element indexes change after navigation.
