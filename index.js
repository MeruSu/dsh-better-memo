/**
 * dsh-better-memo — Host half.
 *
 * Five agent tools, split by tier so the model never has to choose a scope:
 *   memo_list          read  session  (this session only)
 *   memo_list_shared   read  profile  (every session of this profile)
 *   memo_edit          write session
 *   memo_edit_shared   write profile
 *   memo_read_private  read  user     (only after a one-shot user approval)
 *
 * The two read tools are conditionally registered: a tier with no entries is not
 * even declared to the model (`ctx.tools.register(def, { when })`, evaluated once
 * per model step). The write tools stay unconditional, otherwise the first memo
 * could never be written. `memo_read_private` is only registered when the host
 * approval service exists; it is never a hard dependency.
 *
 * One HTTP prefix serves the client half (`/better-memo/state`, `/write`,
 * `/settings`). Scope rules live in lib/store.js. The one rule worth repeating
 * here: the `user` tier is the user's own drawer — no tool returns it except
 * `memo_read_private` after approval, and no tool writes it at all.
 */
import { addEntry, deleteEntry, patchSettings, read, readSettings, updateEntry, visibleTo, write, LIMITS } from './lib/store.js';

export const name = 'dsh-better-memo';
export const inject = ['tools', 'systemPrompt'];

export const ROUTE = '/better-memo';
const MARKER = { 'x-better-memo': '1' };

/** Tool names, exported so tests and probes do not spell them out twice. */
export const TOOL_NAMES = Object.freeze({
  listSession: 'memo_list',
  listShared: 'memo_list_shared',
  editSession: 'memo_edit',
  editShared: 'memo_edit_shared',
  readPrivate: 'memo_read_private',
});

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

function messageOf(thrown) {
  return thrown instanceof Error ? thrown.message : String(thrown);
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

/** The user tier has no scope/session provenance to offer the agent. */
function privateShape(entry) {
  return {
    id: entry.id,
    title: entry.title,
    body: entry.body,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * The session id behind an agent, or null. `agent.id` IS the session id — the
 * agent registry refuses an agent whose id differs from `agent.session.id`.
 * Tolerates a missing/odd agent and never throws.
 */
function agentSessionId(agent) {
  try {
    const id = agent?.id;
    return typeof id === 'string' && id !== '' ? id : null;
  } catch {
    return null;
  }
}

/**
 * What an agent may see, read from disk once. Returns null when the call has no
 * session to attribute it to. Never throws outward: `read()` already degrades a
 * corrupt file to an empty db, and every caller wraps this anyway.
 */
function contextFor(agent) {
  const sessionId = agentSessionId(agent);
  if (sessionId === null) return null;
  const profile = profileOf();
  const db = read();
  return { sessionId, profile, db, seen: visibleTo(db, { sessionId, profile }) };
}

/**
 * Whether one tier holds anything for this agent. This backs every `when`
 * callback, so it must never throw: a rejection here fails the whole model step
 * prep with TOOL_ACTIVATION_FAILED. An unreadable file reads as empty (read()
 * returns an empty db), which correctly hides the tool.
 *
 * Deliberately uncached: one small JSON read per model step is cheaper than a
 * cache that can serve a stale "empty" right after a write.
 */
function tierNotEmpty(agent, tier) {
  try {
    const context = contextFor(agent);
    if (context === null) return false;
    return context.seen[tier].length > 0;
  } catch {
    return false;
  }
}

/** A soft dependency: present or not, the plugin works either way. */
function softService(ctx, serviceName) {
  try {
    const get = ctx?.get;
    if (typeof get !== 'function') return undefined;
    const service = get.call(ctx, serviceName);
    return service === undefined || service === null ? undefined : service;
  } catch {
    return undefined;
  }
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

/**
 * A read tool for one fixed tier. Only that tier's rows come back, `done` rows
 * are dropped, and `when` keeps the tool out of the declarations entirely while
 * the tier is empty.
 */
function registerReadTool(ctx, { name: toolName, tier, description }) {
  ctx.tools.register({
    name: toolName,
    description,
    parameters: schema({}),
    output: OUT,
    async execute(_args, exec) {
      try {
        const context = contextFor(exec?.agent);
        if (context === null) return { ok: false, error: 'no session in this call' };
        const rows = context.seen[tier].filter((entry) => entry.done !== true);
        return {
          ok: true,
          scope: tier,
          sessionId: context.sessionId,
          profile: context.profile,
          count: rows.length,
          memos: rows.map(shape),
        };
      } catch (thrown) {
        return { ok: false, error: messageOf(thrown) };
      }
    },
    when: (activation) => tierNotEmpty(activation?.agent, tier),
  });
}

/**
 * A write tool for one fixed tier. The scope is baked in — it is not a schema
 * field, because letting the model pick a scope was the actual failure mode.
 * add/update/delete are reachability-checked against the same db that is then
 * mutated, so a session can never touch another session's row, another tier's
 * row, or a `user` row.
 */
function registerEditTool(ctx, { name: toolName, tier, description }) {
  ctx.tools.register({
    name: toolName,
    description,
    parameters: schema(
      {
        op: { type: 'string', enum: ['add', 'update', 'delete'], description: '要做的操作。' },
        id: { type: 'string', description: 'update / delete 用的条目 id（读工具返回的那个）。' },
        title: { type: 'string', description: `一句话标题，最多 ${LIMITS.title} 字。` },
        body: { type: 'string', description: `正文，最多 ${LIMITS.body} 字。` },
        done: { type: 'boolean', description: 'update 用：是否标记为已完成（可反复来回改）。' },
      },
      ['op'],
    ),
    output: OUT,
    async execute(args, exec) {
      try {
        const context = contextFor(exec?.agent);
        if (context === null) return { ok: false, error: 'no session in this call' };
        const op = args?.op;
        const db = context.db;
        const reachable = context.seen[tier];
        if (op === 'add') {
          const entry = addEntry(db, {
            scope: tier,
            sessionId: context.sessionId,
            profile: context.profile,
            title: args?.title,
            body: args?.body,
            createdBy: 'agent',
          });
          write(db);
          return { ok: true, scope: tier, op: 'add', memo: shape(entry) };
        }
        if (op === 'update' || op === 'delete') {
          const target = reachable.find((entry) => entry.id === args?.id);
          if (target === undefined) {
            return { ok: false, error: `no ${tier} memo with id "${String(args?.id)}" that you may change` };
          }
          const entry = op === 'update'
            ? updateEntry(db, { id: args.id, title: args.title, body: args.body, done: args.done })
            : deleteEntry(db, { id: args.id });
          write(db);
          return { ok: true, scope: tier, op, memo: shape(entry) };
        }
        return { ok: false, error: `unknown op "${String(op)}"` };
      } catch (thrown) {
        return { ok: false, error: messageOf(thrown) };
      }
    },
  });
}

/** Map an approval outcome to a refusal that carries no user content. */
function refusalOf(outcome) {
  if (outcome === 'rejected') return 'user denied';
  if (outcome === 'cancelled') return 'cancelled';
  return 'approval unavailable';
}

/**
 * Read the `user` tier behind a one-shot approval. The approval seam is the
 * host's own (`ctx.approval`, `request({ agent, toolName, reason, signal })`)
 * and MUST be called inside an open turn — it throws outside one. Every call
 * asks again; nothing is remembered, so the grant cannot outlive the call.
 *
 * Refusals return a bare `{ ok:false, error }`: no entries, no titles, not even
 * a count. Only an `allowed-once` outcome produces content, and it is read
 * fresh after the decision (the user may have edited the drawer meanwhile).
 */
function registerPrivateTool(ctx, approval) {
  ctx.tools.register({
    name: TOOL_NAMES.readPrivate,
    description:
      '申请读取「仅用户可见」这一档（user，用户自己的抽屉）。每次调用都要用户当场批准，批准一次性，下次还要重新问；' +
      '被拒、取消或没有批准服务时不返回任何条目内容（连标题都不给）。',
    parameters: schema({}),
    output: OUT,
    when: (activation) => approval !== undefined && tierNotEmpty(activation?.agent, 'user'),
    async execute(_args, exec) {
      try {
        if (approval === undefined) return { ok: false, error: 'approval unavailable' };
        const agent = exec?.agent;
        const sessionId = agentSessionId(agent);
        if (sessionId === null || agent === undefined) return { ok: false, error: 'no session in this call' };
        const profile = profileOf();
        if (visibleTo(read(), { sessionId, profile }).user.length === 0) {
          return { ok: true, approval: 'not-needed', oneShot: true, count: 0, memos: [] };
        }
        let outcome;
        try {
          outcome = await approval.request({
            agent,
            toolName: TOOL_NAMES.readPrivate,
            reason: 'read the user-only memos',
            signal: exec?.signal,
          });
        } catch {
          return { ok: false, error: 'approval unavailable' };
        }
        if (outcome !== 'allowed-once') return { ok: false, error: refusalOf(outcome) };
        const rows = visibleTo(read(), { sessionId, profile }).user;
        return {
          ok: true,
          approval: 'allowed-once',
          oneShot: true,
          count: rows.length,
          memos: rows.map(privateShape),
        };
      } catch (thrown) {
        // Nothing user-shaped may ride out on a failure path.
        return { ok: false, error: messageOf(thrown) };
      }
    },
  });
}

export function apply(ctx, config = {}) {
  if (config?.announceToAgent !== false && ctx.systemPrompt?.section) {
    ctx.systemPrompt.section({
      name: 'tool:better-memo',
      order: 142,
      text:
        '备忘录（memo）有三档归属：本会话（session，只在本会话内可见）、全局共享（profile，本 profile 所有会话可见）、仅用户可见（user，只有用户本人看得到）。' +
        '本会话的备忘用 memo_list 读、memo_edit 写；要让所有会话都看到就用 memo_list_shared 读、memo_edit_shared 写——两个写工具都已固定档位，不用（也不能）选 scope，各自只能改自己那一档。' +
        '会话开始时若用户提到「备忘录 / 备忘 / 记一下 / 待办」，先调对应档的读工具；收到后按条目办事。' +
        '仅用户可见的条目只能申请读取（memo_read_private）：每次都要用户当场批准，可能被拒，被拒时什么内容也不会给你。',
    });
  }

  registerReadTool(ctx, {
    name: TOOL_NAMES.listSession,
    tier: 'session',
    description:
      '查看「本会话」这一档的备忘录：只含写在这个会话里的 session 条目（已勾完成的过滤掉）。' +
      '全局共享档请用 memo_list_shared；仅用户可见的条目不会出现在这里。',
  });

  registerReadTool(ctx, {
    name: TOOL_NAMES.listShared,
    tier: 'profile',
    description:
      '查看「全局共享」这一档的备忘录：本 profile 所有会话都能看到的 profile 条目（已勾完成的过滤掉）。' +
      '本会话专属的条目请用 memo_list；仅用户可见的条目不会出现在这里。',
  });

  registerEditTool(ctx, {
    name: TOOL_NAMES.editSession,
    tier: 'session',
    description:
      '新增 / 修改 / 删除「本会话」这一档（session，只在本会话内可见）。op=add 需要 title 或 body；' +
      'op=update / op=delete 需要 id（memo_list 返回的那个），update 可改 title / body / done。' +
      '只能动本会话的 session 条目：别的会话的条目、全局共享档都会被拒，user 档也写不了。要共享请用 memo_edit_shared。',
  });

  registerEditTool(ctx, {
    name: TOOL_NAMES.editShared,
    tier: 'profile',
    description:
      '新增 / 修改 / 删除「全局共享」这一档（profile，本 profile 所有会话都能看到）。op=add 需要 title 或 body；' +
      'op=update / op=delete 需要 id（memo_list_shared 返回的那个），update 可改 title / body / done。' +
      '只动全局共享档的条目：本会话专属与 user 档都写不了。',
  });

  // Soft dependency: the approval seam is optional, so it is never in
  // `exports.inject`. Without it the private-read tool simply does not exist.
  const approval = softService(ctx, 'approval');
  if (approval !== undefined) {
    registerPrivateTool(ctx, approval);
  } else if (typeof ctx?.inject === 'function') {
    let registered = false;
    try {
      ctx.inject(['approval'], (scope) => {
        if (registered) return;
        const later = softService(scope, 'approval');
        if (later === undefined) return;
        registered = true;
        registerPrivateTool(ctx, later);
      });
    } catch {
      /* no approval seam here: the private-read tool stays unregistered */
    }
  }

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