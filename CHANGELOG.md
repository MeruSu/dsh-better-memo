# Changelog

## 0.3.0 — 2026-11-21

把 AI 工具从 2 个拆成 4 个（每档一个，档位固定），并新增「经批准后读仅用户可见」的工具。面板 UI 与 `client.js` 本次**零改动**。

- **四个档位工具，`scope` 不再暴露给模型**（AI 选错 scope 是 0.2.x 的实际故障来源）：
  - `memo_list`（读 `session`）/ `memo_list_shared`（读 `profile`）——每个读工具**只返回自己那一档**，`done` 仍过滤；`memo_list` 不再混着 profile 条目返回。
  - `memo_edit`（写 `session`）/ `memo_edit_shared`（写 `profile`）——`add` 的 scope 由工具固定，`memo_edit_shared` 写入的条目 `scope` 恒为 `profile`；`args.scope` 一律忽略。
  - `op=add|update|delete` 不变；`update` 现在可改 `done`（勾完成 / 取消）。`update`/`delete` 只认**自己那一档**的条目：跨会话、跨档、`user` 条目都返回 `{ ok:false, error:… }`。
- **读工具按需注册**：`ctx.tools.register(def, { when })`，每模型步求值一次。`memo_list` 仅在本会话确有 `session` 条目时暴露，`memo_list_shared` 仅在 `profile` 档非空时暴露；为空时工具**连声明都不下发、也调不到**。写工具恒可用（否则第一条永远写不出来）。`when` 内部不抛异常：读盘失败 / 拿到 `agent` 里没有 id 都当作「不暴露」，避免 `TOOL_ACTIVATION_FAILED` 打死整个 step。
- **新增 `memo_read_private`**（读 `user`，仅用户可见）：
  - 走宿主自带的批准服务（`ctx.approval` 的 `request({ agent, toolName, reason, signal })`，派给客户端批准面板），**软依赖** `ctx.get('approval')`——不放进 `exports.inject`，拿不到就不注册这个工具。
  - 暴露条件：`user` 档非空。批准**一次性**：每次调用都重新问，不做永久授权。
  - 允许 → 返回标题 + 正文 + id + 时间（`approval:'allowed-once'`、`oneShot:true`）；拒绝 / 取消 / 不可用 → 只返回 `{ ok:false, error:'user denied' | 'cancelled' | 'approval unavailable' }`，**不返回任何条目内容，连标题和条数都没有**。
  - 只能在模型轮次进行中调用（批准服务自身的要求）。
- `systemPrompt` 注入文案重写：本会话用 `memo_list`/`memo_edit`，全局共享用 `memo_list_shared`/`memo_edit_shared`，仅用户可见只能申请（`memo_read_private`）且可能被拒。
- 测试：原 6 组全部保留（其中第 2、3 组按新契约改写：读工具不再合并两档、写工具不再能改别的档），新增 6 组共 12 组 —— 五个工具注册与软依赖、`when` 空库为 false 且有 `session` 条目时为 true、`memo_list` 只含 `session`、`memo_list_shared` 只含 `profile`、`memo_edit` 写不到 `user`（含 `args.scope='user'` 的偷写）、`memo_edit_shared` 写入 `scope=profile`、`memo_read_private` 允许返回内容 / 拒绝零泄露、`when` 与 `execute` 不抛异常。
- 已知不同步：`client.js` 里的 `VERSION` 仍是 `0.2.3`（本次按要求不动客户端），面板自报版本会与包版本不一致，等客户端改动一起抬。

## 0.2.3 — 2026-11-20

按更正后的口径重做 0.2.2：**不是宽度，是高度**（用户：宽度改回去，每一正文的高度改成 3 倍）。

- **回退 0.2.2 的宽度改动**：删掉 `.bm-page:has(.bm-edit)` 那条（编辑时整页放宽到 `min(1760px,96vw)`），也删掉 `.bm-page` 上的 `transition:width` —— 设置页宽度回到 0.2.1 的 `min(720px,92vw)`，进出编辑不再伸缩。
- **正文高度一律 3 倍**（原来 62px 的框、120px 的只读正文）：
  - 编辑态正文框 `min-height` 62 → **186px**（`rows` 3 行 → 8 行）；
  - 新增表单正文框 62 → **186px**；
  - 每条备忘录只读正文的 `max-height` 120 → **360px**（长正文不用在小框里滚了）。
- 宿主半边零改动，工具和三档语义不变；版本号 0.2.3。

## 0.2.2 — 2026-11-20

只改编辑区尺寸（用户：编辑栏太小，尤其修改的时候，正文框宽度要翻三倍）。

- **改一条时整页放宽**：`.bm-page:has(.bm-edit)` 从 `min(720px,92vw)` 放到 `min(1760px,96vw)`，正文框可用宽从约 660px 变成约 1700px（窗口够宽时约 2.6–3 倍）；宽度带 180ms 过渡，进出编辑不闪跳。收起编辑后自动回到 720px。
- **正文框加高**：编辑态 `min-height` 62 → **200px**、`rows` 3 → **8**；新增表单的正文框 62 → **120px**。
- 版本号 0.2.2（client 与 package 同步）；宿主半边零改动。

## 0.2.1 — 2026-11-20

视觉与手感修（用户：黑的看不清、UI 有点丑、点设置页外面也该收起）。

- **浮窗卡片与设置页固定浅色**：不再跟宿主深色主题走，卡片/设置页底色 `#fff`、正文 `#1f2328`、次要文字 `#57606a`，边框与阴影全部按浅色重配；输入框、下拉、开关行同步改浅色底（`#f2f5f9`），不再出现「白底白字」或「黑底黑字」。
- **顶栏胶囊同样改白底**（原来深灰底 + 继承宿主文字色，深色主题下几乎看不清）。
- **卡片重排**：行改成扁平列表 + 悬停高亮，去掉每行的方框；归属用彩色圆点 + 同色系小药丸标签（会话蓝 / 共享绿 / 私人橙）；标题与摘要两行；底部一行灰字提示「点一行即可复制；齿轮里管理全部」；计数改成浅色药丸。
- **点设置页外的区域也会收起设置页**（原来只有 ESC 和关闭按钮），用 `mousedown` 判定，从设置页内部拖到外面不会误触。
- **胶囊只在真会话里出现**：欢迎页 / 新建但还没说话的会话不显示这个按钮（读 `sessions.list` 的 `retainedBy.mainView` 且跳过 `blank` 会话，订阅列表变化后即时显隐）。
- 胶囊与同行图标按钮对齐：高 28、圆角 8、`top:11px`（原来 28 高但 `top:6px`、圆角 14，比同行高出一截）。
- 三档文案改为「本会话 / 全局共享 / 仅用户」（分组标题、下拉选项、提示语同步）。
- `memo_edit` 的 `add` 显式拒绝 `scope=user`：schema 早已把 user 排除，但直接调用会绕过枚举写出 user 条目，现在返回错误。
- `memo_edit` 的 `add` 不给 `scope` 时不再报错，**默认写到本会话**（`session`）；要跨会话共享才显式写 `profile`。
- 每条备忘录都记下来源会话 `sessionId`（写 `profile` 时也记），`memo_list` 与面板接口返回里都带这个字段。
- 版本号 0.2.1（client 与 package 同步）。

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