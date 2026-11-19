/**
 * dsh-better-memo — Host half.
 *
 * Two agent tools (`memo_list`, `memo_edit`) and one HTTP prefix the client half
 * reads and writes through (`/better-memo/state`, `/better-memo/write`).
 *
 * Scope rules live in lib/store.js. The one rule worth repeating here: the
 * `user` scope is the user's own drawer. No tool returns it and no tool writes
 * it — only the panel does, over the route.
 */
import { addEntry, AGENT_SCOPES, deleteEntry, patchSettings, read, readSettings, updateEntry, visibleTo, write, LIMITS } from './lib/store.js';

export const name = 'dsh-better-memo';
export const inject = ['tools', 'systemPrompt'];

export const ROUTE = '/better-memo';
const MARKER = { 'x-better-memo': '1' };

const OUT = {
  schema: { type: 'object', additionalProperties: true },
  render(_args, value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const limit = 20000;
    if (text.length <= limit) return [{ type: 'text', text }];
    return [{ type: 'text', text: `${text.slice(0, limit)}\n…[truncated ${text.length - limit} chars]` }];
  },
};

function schema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

/** The profile this host process serves: `--profile <name>` on argv, else default. */
export function profileOf(argv = process.argv, env = process.env) {
  const fromEnv = env.DSH_PROFILE;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  const list = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < list.length; index += 1) {
    const item = String(list[index]);
    if (item === '--profile' && index + 1 < list.length) return String(list[index + 1]);
    if (item.startsWith('--profile=')) return item.slice('--profile='.length);
  }
  return 'default';
}

function markerOk(request) {
  try {
    return request.headers.get('x-better-memo') === '1';
  } catch {
    return false;
  }
}

function shape(entry) {
  return {
    id: entry.id,
    scope: entry.scope,
    sessionId: entry.sessionId,
    title: entry.title,
    body: entry.body,
    done: entry.done,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function panelPayload({ sessionId, profile, env = process.env }) {
  const db = read(env);
  const seen = visibleTo(db, { sessionId, profile });
  return {
    ok: true,
    profileName: profile,
    sessionId,
    session: seen.session.map(shape),
    profile: seen.profile.map(shape),
    user: seen.user.map(shape),
    limits: LIMITS,
    settings: readSettings(db),
  };
}

export function serveState(request, env = process.env) {
  if (markerOk(request) === false) return Response.json({ ok: false, reason: 'no-marker' }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const sessionId = params.get('sessionId');
    return Response.json(panelPayload({
      sessionId: sessionId === null || sessionId === '' ? null : sessionId,
      profile: profileOf(process.argv, process.env),
      env,
    }));
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return Response.json({ ok: false, reason: 'error', error: message }, { status: 500 });
  }
}

export function serveWrite(request, env = process.env) {
  if (markerOk(request) === false) return Response.json({ ok: false, reason: 'no-marker' }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const sessionId = params.get('sessionId');
    const scope = params.get('scope');
    const profile = profileOf(process.argv, process.env);
    const db = read(env);
    const op = params.get('op');
    if (op === 'add') {
      addEntry(db, {
        scope: scope === null ? 'user' : scope,
        sessionId: sessionId === null || sessionId === '' ? null : sessionId,
        profile,
        title: params.get('title') ?? '',
        body: params.get('body') ?? '',
        createdBy: 'user',
      });
    } else if (op === 'update') {
      updateEntry(db, {
        id: params.get('id') ?? '',
        title: params.get('title') === null ? undefined : params.get('title'),
        body: params.get('body') === null ? undefined : params.get('body'),
        done: params.get('done') === null ? undefined : params.get('done') === '1',
      });
    } else if (op === 'delete') {
      deleteEntry(db, { id: params.get('id') ?? '' });
    } else {
      return Response.json({ ok: false, reason: 'bad-op', error: `unknown op "${String(op)}"` }, { status: 400 });
    }
    write(db, env);
    return Response.json(panelPayload({ sessionId: sessionId === null || sessionId === '' ? null : sessionId, profile, env }));
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return Response.json({ ok: false, reason: 'error', error: message }, { status: 400 });
  }
}

/**
 * Settings are the plugin's own preferences (not memo content). They live next
 * to the entries but are patched separately and are never exposed to the agent
 * tools. Query-param style, matching /write: `?showTabEntry=1|0`.
 */
export function serveSettings(request, env = process.env) {
  if (markerOk(request) === false) return Response.json({ ok: false, reason: 'no-marker' }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const patch = {};
    if (params.has('showTabEntry')) {
      const raw = String(params.get('showTabEntry'));
      patch.showTabEntry = raw === '1' || raw === 'true';
    }
    if (Object.keys(patch).length === 0) {
      return Response.json({ ok: false, reason: 'bad-query', error: 'expected ?showTabEntry=1|0' }, { status: 400 });
    }
    const db = read(env);
    const settings = patchSettings(db, patch);
    write(db, env);
    return Response.json({ ok: true, settings });
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return Response.json({ ok: false, reason: 'error', error: message }, { status: 400 });
  }
}

/** One prefix, dispatched by pathname so router order cannot pick the handler. */
export function serveRequest(request, env = process.env) {
  let pathname = '';
  try {
    pathname = new URL(request.url).pathname.replace(/\/+$/, '');
  } catch {
    pathname = '';
  }
  if (pathname === `${ROUTE}/state`) return serveState(request, env);
  if (pathname === `${ROUTE}/write`) return serveWrite(request, env);
  if (pathname === `${ROUTE}/settings`) return serveSettings(request, env);
  return Response.json({ ok: false, reason: 'not-found' }, { status: 404 });
}

export function apply(ctx, config = {}) {
  if (config?.announceToAgent !== false && ctx.systemPrompt?.section) {
    ctx.systemPrompt.section({
      name: 'tool:better-memo',
      order: 142,
      text:
        '备忘录（memo）有三种归属：session（只发给本会话）、profile（发给本 profile 的所有会话）、user（只有用户自己看得到，你看不到）。' +
        '会话开始时若用户提到「备忘录 / 备忘 / 记一下 / 待办」，先调 memo_list 看有没有留给你的条目；收到后按条目办事。' +
        '要记东西用 memo_edit（op=add）。只能写 session 和 profile 两种归属，写不了 user。',
    });
  }

  const sessionOf = (exec) => {
    const id = exec?.agent?.id;
    return typeof id === 'string' && id !== '' ? id : null;
  };

  ctx.tools.register({
    name: 'memo_list',
    description:
      '查看当前会话应当查收的备忘录：本会话的 session 条目 + 本 profile 的 profile 条目。' +
      '归 user（仅用户可见）的条目不会出现在这里。',
    parameters: schema({}),
    output: OUT,
    async execute(_args, exec) {
      const sessionId = sessionOf(exec);
      if (sessionId === null) return { ok: false, error: 'no session in this call' };
      const profile = profileOf();
      const db = read();
      const seen = visibleTo(db, { sessionId, profile });
      const rows = [...seen.session, ...seen.profile].filter((entry) => entry.done !== true);
      return {
        ok: true,
        profile,
        sessionId,
        count: rows.length,
        memos: rows.map((entry) => ({ ...shape(entry), scope: entry.scope })),
      };
    },
  });

  ctx.tools.register({
    name: 'memo_edit',
    description:
      '新增 / 修改 / 删除备忘录。op=add 需要 title 或 body，scope 默认 session（归本会话），' +
      '要共享才写 profile；op=update / op=delete 需要 id。只能改自己看得到的 session / profile 条目，user 条目改不了。',
    parameters: schema(
      {
        op: { type: 'string', enum: ['add', 'update', 'delete'], description: '要做的操作。' },
        id: { type: 'string', description: 'update / delete 用的条目 id（memo_list 返回的那个）。' },
        scope: { type: 'string', enum: AGENT_SCOPES, description: 'add 用：默认 session，只给本会话；写 profile 才会给本 profile 所有会话。' },
        title: { type: 'string', description: `一句话标题，最多 ${LIMITS.title} 字。` },
        body: { type: 'string', description: `正文，最多 ${LIMITS.body} 字。` },
        done: { type: 'boolean', description: 'update 用：是否标记为已完成。' },
      },
      ['op'],
    ),
    output: OUT,
    async execute(args, exec) {
      const sessionId = sessionOf(exec);
      if (sessionId === null) return { ok: false, error: 'no session in this call' };
      const profile = profileOf();
      const db = read();
      const op = args?.op;
      try {
        if (op === 'add') {
          const scope = args?.scope === undefined ? 'session' : args?.scope;
          if (AGENT_SCOPES.includes(scope) === false) {
            return { ok: false, error: `scope must be one of ${AGENT_SCOPES.join('|')} (you cannot write "user")` };
          }
          const entry = addEntry(db, {
            scope,
            sessionId,
            profile,
            title: args?.title,
            body: args?.body,
            createdBy: 'agent',
          });
          write(db);
          return { ok: true, op: 'add', memo: shape(entry) };
        }
        if (op === 'update' || op === 'delete') {
          const visible = visibleTo(db, { sessionId, profile });
          const reachable = [...visible.session, ...visible.profile].some((entry) => entry.id === args?.id);
          if (reachable === false) return { ok: false, error: `no memo with id "${String(args?.id)}" that you may change` };
          const entry = op === 'update'
            ? updateEntry(db, { id: args.id, title: args.title, body: args.body, done: args.done })
            : deleteEntry(db, { id: args.id });
          write(db);
          return { ok: true, op, memo: shape(entry) };
        }
        return { ok: false, error: `unknown op "${String(op)}"` };
      } catch (thrown) {
        return { ok: false, error: thrown instanceof Error ? thrown.message : String(thrown) };
      }
    },
  });

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'prefix',
          path: ROUTE,
          resource: (request) => serveRequest(request),
        }),
      'better-memo: state and write',
    );
  });
}
