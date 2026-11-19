# Changelog

## 0.2.0 — 2026-11-20

改成浮窗卡片（用户口径：不要整页）。

- **入口**：顶栏胶囊（slot `shell.overlay`）。没有该 slot 的环境退回右下角固定圆钮。
- **浮窗卡片**：点胶囊弹出，一条一条列三档备忘录（彩色圆点区分 session / profile / user），**点一条 = 直接复制**（`标题\n正文`），浮出「已复制」1.2 秒；点外部 / ESC / 再点胶囊关闭，退出走 160ms 动画后卸载。
- **设置页**：卡片右上角齿轮 → 同一个浮层切成整页模式（`min(720px,92vw) × min(80vh)`），里面是完整的三组管理界面（新增表单、勾完成、行内改、两次确认删）+ 开关「在会话 tab 行显示「备忘录」入口」。
- **tab 座位默认不显示**（`settings.showTabEntry = false`），只有打开开关才注册 `conversation.view` 座位；开关即时生效，不需要重启。
- 后端新增 `GET /better-memo/settings?showTabEntry=1|0`（marker 头 `x-better-memo: 1`），`/state` 现在带 `settings` 字段。
- 修：从设置页返回卡片时列表不刷新（现在返回即重取 state）；输入框/下拉在深色主题下底色与宿主不一致。

## 0.1.0 — 2026-11-20

首版。

- 三层备忘录：`session`（本会话）/ `profile`（本 profile 所有会话）/ `user`（仅用户可见）。
- 两个 agent 工具：`memo_list` 查收、`memo_edit` 增改删。`user` 档不进 `memo_list`，也不接受工具写入。
- 存储：`$DSH_HOME/memo/memos.json`，原子写；上限 500 条，标题 120 字、正文 4000 字。
- 面板进入 / 列表错峰 / 删除退出三处动效，`prefers-reduced-motion` 下退化。