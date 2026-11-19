# Changelog

## 0.1.0 — 2026-11-20

首版。

- 三层备忘录：`session`（本会话）/ `profile`（本 profile 所有会话）/ `user`（仅用户可见）。
- 两个 agent 工具：`memo_list` 查收、`memo_edit` 增改删。`user` 档不进 `memo_list`，也不接受工具写入。
- 浏览器半段：会话 tab 行新增「备忘录」座位，点开是面板——三组列表 + 常驻新增表单 + 行内改 + 两次确认删除。
- 存储：`$DSH_HOME/memo/memos.json`，原子写；上限 500 条，标题 120 字、正文 4000 字。
- 面板进入 / 列表错峰 / 删除退出三处动效，`prefers-reduced-motion` 下退化。
