# 备忘录 · dsh-better-memo

给 DeepSeek Harness 加一层**三层备忘录**：同一个面板里管三档归属，其中两档 AI 能读能改，第三档只有你自己看得到。

| 作用域 | 谁收得到 | AI 能看 | AI 能写 |
|---|---|---|---|
| **本会话** `session` | 只有这一个会话 | ✅ | ✅ |
| **本 profile** `profile` | 这个 profile 的所有会话 | ✅ | ✅ |
| **仅我可见** `user` | 只有面板里的你 | ❌ 永远不返回 | ❌ 只有你能写 |

## 安装

```bash
dsh plugin --profile <你的 profile> add dsh-better-memo
```

装完**重启该 profile 的 GUI**（浏览器半段与 locale 元数据都是启动时读的）。

## 用

会话 tab 行里会多一个 **备忘录** 座位，点开就是面板：

- 三组分开列：`本会话 (n)` / `本 profile (n)` / `仅我可见 (n)`
- 顶上常驻新增表单：选作用域 → 填标题/正文 → 存下
- 每行可以勾完成、行内改、删（删除要点两次，3 秒内不确认自动恢复）

## 给 AI 的两个工具

- **`memo_list`** —— 返回本会话该查收的条目：本会话的 `session` + 本 profile 的 `profile`，已勾完成的会过滤掉。**`仅我可见` 的条目永远不会出现在这里。**
- **`memo_edit`** —— `op=add|update|delete`。`add` 必须给 `scope`（`session` 或 `profile`）；`update`/`delete` 要 `id`。只能改自己看得到的条目，跨会话或 `user` 条目会被拒。

在预设的系统提示里建议加一句（本插件已自带一段提示词，一般不用再写）：

> 会话开始时如果用户提到「备忘录 / 备忘 / 记一下 / 待办」，先调 `memo_list`。

## 数据放哪

`$DSH_HOME/memo/memos.json`（`DSH_HOME` 缺省 `~/.dsh`），一个 JSON 文件，原子写。删掉它等于清空全部备忘录。

条目上限 500 条；标题 120 字、正文 4000 字（超出截断）。

## 已知限制

- 入口是 **tab 座位 + tab 内容面板**，不是浮层弹窗。顶栏那套要处理 Windows 上 40px 拖拽带与窗口按钮挤压，属于另一次改动。
- 单机单文件，没有多端同步。
- profile 档只在本 profile 内共享；跨 profile 不共享（`session` 条目记了所属 profile，切 profile 后看不到）。
- 没有提醒/定时：这不是提醒插件，是备忘录。

## License

MIT
