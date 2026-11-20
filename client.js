/**
 * dsh-better-memo — Client half (0.2.0 popout form).
 *
 * Shape: a top-bar capsule (slot shell.overlay) opens a floating card list;
 * every row copies its memo to the clipboard on click. The gear turns the same
 * overlay into a centered management page (the three-scope CRUD UI) whose first
 * row carries the showTabEntry switch. When that switch is on, a
 * conversation.view tab seat is registered; when off, it is disposed. When
 * shell.overlay is not declared (plain web) the capsule falls back to a fixed
 * round button in the bottom-right corner of document.body.
 *
 * Hard constraints held here on purpose (each has burned a release before):
 *   - every declaration lives inside factory(): the host concatenates every
 *     plugin client into ONE module, so a top-level const collides and the whole
 *     page dies with "Identifier X has already been declared".
 *   - CSS is plain string concatenation, never a template literal: one stray
 *     backtick truncates the file and the bundle fails to parse.
 *   - ctx.get('slots') is used instead of ctx.slots (property access throws
 *     when the service is not injected, and the whole entry shows "failed").
 *   - no native confirm; no background on the 40px drag band; the capsule is
 *     -webkit-app-region:no-drag.
 *
 * Data path: GET /better-memo/state?sessionId=…, GET /better-memo/write?… and
 * GET /better-memo/settings?showTabEntry=1|0 — all with the x-better-memo: 1
 * marker. Writes answer the full fresh state payload, which the panels swap in.
 */
window.__ModuleLoader__.load({
  id: 'dsh-better-memo',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ReactDOM = require('react-dom');
    const ReactDOMClient = require('react-dom/client');

    const NS = 'better-memo';
    const VERSION = '0.2.3';
    const SLOT = 'conversation.view';
    const SEAT_ID = 'better-memo-seat';
    const TOPBAR_SLOT = 'shell.overlay';
    const CAPSULE_ID = 'better-memo.capsule';
    const FALLBACK_HOST_ID = 'better-memo-overlay-fallback';
    const ROUTE = '/better-memo';
    const MARKER = { 'x-better-memo': '1' };
    const STYLE_ID = 'better-memo-style';
    const CONFIRM_MS = 3000;
    const OUT_MS = 160;
    const STAGGER_MS = 40;
    /* (MAX_STAGGER - 1) * STAGGER_MS = 280ms, the spec's stagger cap. */
    const MAX_STAGGER = 8;
    const COPY_MS = 1200;
    const RETRY_LIMIT = 20;
    const RETRY_MS = 250;

    const FALLBACK_LIMITS = { title: 120, body: 4000, entries: 500 };
    const GROUP_LABEL = { session: '本会话：', profile: '全局共享：', user: '仅用户：' };
    const SCOPE_TAG = { session: '会话', profile: '共享', user: '私人' };
    const HINT_TEXT =
      '本会话只在本会话里出现；全局共享会出现在同一 profile 的所有会话；' +
      '仅用户只有你自己在这个面板里看得到，AI 读不到，也改不了。';

    /** One style element per page, injected once; guarded by this flag inside the factory. */
    let styleInjected = false;

    /* CSS is plain string concatenation on purpose: a template literal here would
       let an accidental backtick truncate the file and break the whole bundle. */
    const CSS = [
      /* ---- management UI (unchanged from 0.1.0) ---- */
      '.bm-panel{display:flex;flex-direction:column;gap:16px;padding:16px 18px 20px;font-size:13px;color:inherit;box-sizing:border-box;animation:bm-enter-frames 200ms cubic-bezier(.22,1,.36,1) both}',
      '.bm-panel *{box-sizing:border-box}',
      '.bm-head{display:flex;align-items:center;gap:6px}',
      '.bm-title{font-size:15px;font-weight:600;margin:0}',
      '.bm-version{font-size:11px;color:var(--dsw-alias-label-secondary,#8a8f98);margin-left:2px}',
      '.bm-head-spacer{flex:1 1 auto}',
      '.bm-btn{font:inherit;font-size:12px;line-height:1;border-radius:8px;border:1px solid var(--dsw-alias-border-l3,rgba(15,23,42,.16));background:var(--bm-surface,#fff);color:inherit;padding:7px 12px;cursor:pointer;transition:background 120ms ease,border-color 120ms ease}',
      '.bm-btn:hover{background:var(--bm-hover,#eff3f8);border-color:var(--dsw-alias-border-l4,rgba(15,23,42,.22))}',
      '.bm-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.bm-btn-primary{background:var(--dsw-alias-accent,#3b82f6);border-color:transparent;color:#fff}',
      '.bm-btn-primary:hover{background:#2560d8;border-color:transparent}',
      '.bm-btn-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary,#8a8f98);padding:6px 8px}',
      '.bm-btn-ghost:hover{background:var(--bm-hover,#eff3f8);color:var(--dsw-alias-label-primary,#1f2328)}',
      '.bm-btn-danger{color:var(--dsw-alias-danger,#e5484d);border-color:rgba(209,36,47,.35);background:#fff}',
      '.bm-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#8a8f98)}',
      '.bm-form{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:12px;background:var(--bm-surface-2,#f6f8fa);border:1px solid var(--bm-line,rgba(15,23,42,.09))}',
      '.bm-form-top{display:flex;gap:8px;align-items:center}',
      '.bm-field{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#8a8f98)}',
      '.bm-input{font:inherit;font-size:13px;width:100%;border-radius:8px;border:1px solid var(--dsw-alias-border-l3,rgba(15,23,42,.16));background:#fff;color:inherit;padding:8px 10px;transition:border-color 120ms ease,box-shadow 120ms ease}',
      '.bm-input:focus{outline:none;border-color:var(--dsw-alias-accent,#3b82f6);box-shadow:0 0 0 3px rgba(47,111,237,.14)}',
      '.bm-select{font:inherit;font-size:13px;border-radius:8px;border:1px solid var(--dsw-alias-border-l3,rgba(15,23,42,.16));background:#fff;color:inherit;padding:6px 8px}',
      '.bm-textarea{resize:vertical;min-height:62px;line-height:19px}',
      '.bm-form .bm-textarea{min-height:186px}',
      // 改一条的时候正文框是主角：高 200px（原来 62），并且把整个页面撑宽到接近窗口
      '.bm-edit{padding:2px 0 4px}',
      '.bm-edit .bm-textarea{min-height:186px;font-size:13px}',
      '.bm-form-actions{display:flex;justify-content:flex-end;gap:8px}',
      '.bm-note{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6)}',
      '.bm-groups{display:flex;flex-direction:column;gap:18px}',
      '.bm-group{display:flex;flex-direction:column;gap:4px}',
      '.bm-group-head{font-size:11.5px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary,#8a8f98);margin:0 0 2px;text-transform:none}',
      '.bm-empty{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary,#9aa0a6);padding:6px 2px}',
      '.bm-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}',
      '.bm-row{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:10px;border:1px solid transparent;background:transparent;animation:bm-item-frames 240ms cubic-bezier(.22,1,.36,1) both;transition:background 120ms ease,border-color 120ms ease}',
      '.bm-row:hover{background:var(--bm-hover,#eff3f8);border-color:var(--bm-line,rgba(15,23,42,.09))}',
      '.bm-row-out{animation:bm-out-frames 160ms cubic-bezier(.4,0,1,1) forwards;pointer-events:none}',
      '.bm-row-head{display:flex;align-items:flex-start;gap:8px}',
      '.bm-check{display:flex;align-items:flex-start;gap:8px;flex:1 1 auto;min-width:0;cursor:pointer}',
      '.bm-check input{margin:2px 0 0;accent-color:var(--dsw-alias-accent,#3b82f6)}',
      '.bm-row-title{font-size:13px;font-weight:500;line-height:18px;word-break:break-word}',
      '.bm-done{text-decoration:line-through;color:var(--dsw-alias-label-tertiary,#9aa0a6)}',
      '.bm-row-body{margin:0;padding-left:26px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#8a8f98);white-space:pre-wrap;word-break:break-word;max-height:360px;overflow:auto}',
      '.bm-row-actions{display:flex;flex:0 0 auto;gap:2px;opacity:.55;transition:opacity 120ms ease}',
      '.bm-row:hover .bm-row-actions,.bm-row:focus-within .bm-row-actions{opacity:1}',
      '.bm-row-act{font-size:11.5px;padding:4px 8px;border-radius:6px}',
      '.bm-edit{display:flex;flex-direction:column;gap:6px}',
      '.bm-edit-actions{display:flex;justify-content:flex-end;gap:6px}',
      '.bm-error{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid rgba(209,36,47,.32);background:rgba(209,36,47,.06);color:#b3252f;font-size:12px}',
      '.bm-error-spacer{flex:1 1 auto}',
      '.bm-loading{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary,#8a8f98)}',
      /* ---- entry capsule ---- */
      '.bm-capsule{position:fixed;top:11px;right:150px;z-index:2147483000;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:8px;border:1px solid rgba(15,23,42,.14);background:#fff;color:#1f2328;font:inherit;font-size:12px;line-height:1;cursor:pointer;pointer-events:auto;-webkit-app-region:no-drag;box-shadow:0 1px 3px rgba(16,24,40,.10);transition:background 120ms ease,border-color 120ms ease}',
      '.bm-capsule:hover{background:#f2f5f9;border-color:rgba(15,23,42,.22)}',
      '.bm-capsule[data-bm-open="1"]{border-color:#2f6fed;background:#fff}',
      '.bm-capsule-floating{top:auto;right:16px;bottom:16px;height:40px;min-width:40px;padding:0 14px;border-radius:20px;box-shadow:0 8px 22px rgba(16,24,40,.18)}',
      '.bm-capsule-label{font-weight:500;white-space:nowrap;color:#1f2328}',
      '.bm-capsule-count{min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#2f6fed;color:#fff;font-size:10px;line-height:16px;text-align:center}',
      /* ---- popout surfaces: light and high contrast whatever the host theme is ---- */
      '.bm-card,.bm-page{--bm-fg:#1f2328;--bm-fg2:#57606a;--bm-fg3:#8b949e;--bm-line:rgba(15,23,42,.09);--bm-line-2:rgba(15,23,42,.14);--bm-hover:#eff3f8;--bm-surface:#fff;--bm-surface-2:#f6f8fa;--bm-accent:#2f6fed;color-scheme:light;--dsw-alias-bg-base:#fff;--dsw-alias-bg-l1:#fff;--dsw-alias-bg-l2:#f2f5f9;--dsw-alias-label-primary:#1f2328;--dsw-alias-label-secondary:#57606a;--dsw-alias-label-tertiary:#8b949e;--dsw-alias-border-l2:rgba(15,23,42,.10);--dsw-alias-border-l3:rgba(15,23,42,.16);--dsw-alias-border-l4:rgba(15,23,42,.22);--dsw-alias-accent:#2f6fed;--dsw-alias-danger:#d1242f}',
      /* ---- floating card ---- */
      '.bm-card{position:fixed;top:40px;right:150px;width:332px;max-height:58vh;z-index:2147483100;display:flex;flex-direction:column;border-radius:14px;border:1px solid var(--bm-line-2);background:var(--bm-surface);color:var(--bm-fg);box-shadow:0 12px 32px rgba(16,24,40,.14),0 2px 6px rgba(16,24,40,.08);overflow:hidden;pointer-events:auto;-webkit-app-region:no-drag;animation:bm-enter-frames 200ms cubic-bezier(.22,1,.36,1) both}',
      '.bm-card-floating{top:auto;right:16px;bottom:64px}',
      '.bm-card-out{animation:bm-out-frames 160ms cubic-bezier(.4,0,1,1) forwards;pointer-events:none}',
      '.bm-card-head{display:flex;align-items:center;gap:8px;padding:11px 12px 11px 14px;border-bottom:1px solid var(--bm-line)}',
      '.bm-card-title{font-size:13.5px;font-weight:600;letter-spacing:.01em;color:var(--bm-fg)}',
      '.bm-card-count{min-width:18px;padding:1px 6px;border-radius:9px;background:var(--bm-surface-2);color:var(--bm-fg2);font-size:11px;line-height:15px;text-align:center}',
      '.bm-card-spacer{flex:1 1 auto}',
      '.bm-card-gear{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--bm-fg3);cursor:pointer;transition:background 120ms ease,color 120ms ease}',
      '.bm-card-gear:hover{background:var(--bm-hover);color:var(--bm-fg)}',
      '.bm-card-body{display:flex;flex-direction:column;gap:2px;padding:6px;overflow:auto}',
      '.bm-card-foot{padding:8px 14px 10px;border-top:1px solid var(--bm-line);font-size:11px;color:var(--bm-fg3)}',
      '.bm-card-empty{margin:0;padding:22px 8px;text-align:center;font-size:12px;color:var(--bm-fg3)}',
      '.bm-card-error{display:flex;align-items:center;gap:8px;margin:4px;padding:10px;border-radius:8px;border:1px solid rgba(209,36,47,.32);background:rgba(209,36,47,.06);color:#b3252f;font-size:12px}',
      '.bm-card-item{display:flex;align-items:flex-start;gap:9px;width:100%;text-align:left;padding:9px 10px;border-radius:10px;border:1px solid transparent;background:transparent;color:var(--bm-fg);font:inherit;cursor:pointer;animation:bm-item-frames 240ms cubic-bezier(.22,1,.36,1) both;transition:background 120ms ease,border-color 120ms ease}',
      '.bm-card-item:hover{background:var(--bm-hover);border-color:var(--bm-line)}',
      '.bm-card-item:active{background:#e8eef7}',
      '.bm-card-dot{flex:0 0 auto;width:7px;height:7px;margin-top:6px;border-radius:50%;background:var(--bm-fg3);box-shadow:0 0 0 3px rgba(15,23,42,.08)}',
      '.bm-card-dot[data-bm-scope="session"]{background:#2f6fed;box-shadow:0 0 0 3px rgba(47,111,237,.14)}',
      '.bm-card-dot[data-bm-scope="profile"]{background:#12a150;box-shadow:0 0 0 3px rgba(18,161,80,.14)}',
      '.bm-card-dot[data-bm-scope="user"]{background:#e08700;box-shadow:0 0 0 3px rgba(224,135,0,.16)}',
      '.bm-card-item-text{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0}',
      '.bm-card-item-title{font-size:13px;font-weight:500;line-height:17px;color:var(--bm-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.bm-card-item-sub{font-size:11.5px;line-height:15px;color:var(--bm-fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.bm-card-tag{flex:0 0 auto;align-self:center;padding:2px 7px;border-radius:999px;font-size:10.5px;line-height:14px;color:var(--bm-fg2);background:var(--bm-surface-2);border:1px solid var(--bm-line)}',
      '.bm-card-tag[data-bm-scope="session"]{color:#2559c4;background:rgba(47,111,237,.09);border-color:rgba(47,111,237,.18)}',
      '.bm-card-tag[data-bm-scope="profile"]{color:#0d7f42;background:rgba(18,161,80,.09);border-color:rgba(18,161,80,.18)}',
      '.bm-card-tag[data-bm-scope="user"]{color:#a86200;background:rgba(224,135,0,.10);border-color:rgba(224,135,0,.20)}',
      '.bm-card-toast{position:absolute;right:12px;bottom:12px;padding:7px 13px;border-radius:999px;background:var(--bm-accent);color:#fff;font-size:12px;line-height:1;box-shadow:0 8px 20px rgba(16,24,40,.22);animation:bm-fade-frames 120ms ease both}',
      /* ---- settings page ---- */
      '.bm-overlay-backdrop{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;background:rgba(16,24,40,.32);pointer-events:auto;-webkit-app-region:no-drag}',
      '.bm-page{display:flex;flex-direction:column;width:min(720px,92vw);height:min(80vh,80vh);max-height:80vh;border-radius:16px;border:1px solid var(--bm-line-2);background:var(--bm-surface);color:var(--bm-fg);box-shadow:0 24px 64px rgba(16,24,40,.22),0 4px 12px rgba(16,24,40,.10);overflow:hidden;animation:bm-enter-frames 200ms cubic-bezier(.22,1,.36,1) both}',
      '.bm-page-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--bm-line)}',
      '.bm-page-back{font-size:12px}',
      '.bm-page-title{font-size:14px;font-weight:600;color:var(--bm-fg)}',
      '.bm-page-spacer{flex:1 1 auto}',
      '.bm-page-close{font-size:18px;line-height:1;padding:4px 10px}',
      '.bm-page-switch{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--bm-line);flex-wrap:wrap;background:var(--bm-surface-2)}',
      '.bm-switch{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--bm-fg);cursor:pointer}',
      '.bm-switch input{cursor:pointer;margin:0}',
      '.bm-switch-error{font-size:11px;color:#d1242f}',
      '.bm-page-body{flex:1 1 auto;overflow:auto;min-height:0;background:var(--bm-surface)}',
      /* ---- keyframes ---- */
      '@keyframes bm-enter-frames{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}',
      '@keyframes bm-item-frames{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      '@keyframes bm-out-frames{from{opacity:1;transform:none}to{opacity:0;transform:scale(.96)}}',
      '@keyframes bm-fade-frames{from{opacity:0}to{opacity:1}}',
      '@keyframes bm-fade-out-frames{to{opacity:0}}',
      /* reduced motion: opacity only, no displacement, no stagger. */
      '@media (prefers-reduced-motion: reduce){.bm-panel,.bm-row:not(.bm-row-out){animation-name:bm-fade-frames !important;animation-duration:120ms !important;animation-delay:0ms !important}.bm-card,.bm-card-item,.bm-page{animation-name:bm-fade-frames !important;animation-duration:120ms !important;animation-delay:0ms !important}.bm-card-out{animation:bm-fade-out-frames 120ms linear forwards !important}.bm-row-out{animation:bm-out-frames 1ms linear forwards !important}}',
    ].join('\n');

    function injectStyle() {
      if (styleInjected === true) return;
      styleInjected = true;
      try {
        if (typeof document === 'undefined') return;
        if (document.getElementById(STYLE_ID) !== null) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
      } catch (thrown) {
        /* styling is best effort: the panel still works without it */
      }
    }

    function messageOf(thrown) {
      return thrown instanceof Error ? thrown.message : String(thrown);
    }

    function prefersReduced() {
      try {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (thrown) {
        return false;
      }
    }

    function queryOf(params) {
      const query = new URLSearchParams();
      const keys = Object.keys(params);
      for (let index = 0; index < keys.length; index += 1) {
        const value = params[keys[index]];
        if (value !== undefined && value !== null) query.set(keys[index], String(value));
      }
      return query.toString();
    }

    async function requestState(sessionId) {
      const query = queryOf({ sessionId: sessionId === '' ? undefined : sessionId });
      const response = await fetch(ROUTE + '/state?' + query, { method: 'GET', headers: MARKER });
      let payload = null;
      try {
        payload = await response.json();
      } catch (thrown) {
        payload = null;
      }
      if (response.ok === false || payload === null || payload.ok === false) {
        const reason = payload && payload.reason ? payload.reason : 'HTTP ' + response.status;
        const detail = payload && payload.error ? '：' + payload.error : '';
        throw new Error(reason + detail);
      }
      return payload;
    }

    async function requestWrite(params) {
      const response = await fetch(ROUTE + '/write?' + queryOf(params), { method: 'GET', headers: MARKER });
      let payload = null;
      try {
        payload = await response.json();
      } catch (thrown) {
        payload = null;
      }
      if (response.ok === false || payload === null || payload.ok === false) {
        const reason = payload && payload.reason ? payload.reason : 'HTTP ' + response.status;
        const detail = payload && payload.error ? '：' + payload.error : '';
        throw new Error(reason + detail);
      }
      return payload;
    }

    /** Persist showTabEntry. GET + query (the host webserver only answers GET/HEAD). */
    async function requestSettings(showTabEntry) {
      const query = queryOf({ showTabEntry: showTabEntry === true ? '1' : '0' });
      const response = await fetch(ROUTE + '/settings?' + query, { method: 'GET', headers: MARKER });
      let payload = null;
      try {
        payload = await response.json();
      } catch (thrown) {
        payload = null;
      }
      if (response.ok === false || payload === null || payload.ok === false) {
        const reason = payload && payload.reason ? payload.reason : 'HTTP ' + response.status;
        const detail = payload && payload.error ? '：' + payload.error : '';
        throw new Error(reason + detail);
      }
      return payload;
    }

    /** Read {showTabEntry} out of a state or settings payload; missing settings means off. */
    function settingsOf(source) {
      const settings = source && typeof source === 'object' && source.settings && typeof source.settings === 'object'
        ? source.settings
        : null;
      return { showTabEntry: settings !== null && settings.showTabEntry === true };
    }

    /**
     * The id of the session currently shown in the main view, or '' when the
     * view is not on a real conversation. A session that exists but is still
     * blank (`session.blank === true`) counts as "no conversation": the host
     * renders the welcome screen for it, and the capsule stays hidden there.
     */
    function currentSessionId(ctx) {
      try {
        const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined;
        if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== 'function') return '';
        const snapshot = sessions.list.getSnapshot();
        const byId = snapshot && snapshot.byId ? snapshot.byId : null;
        if (!byId) return '';
        const ids = Object.keys(byId);
        for (let index = 0; index < ids.length; index += 1) {
          const record = byId[ids[index]];
          if (record && record.blank === true) continue;
          const retained = record && record.retainedBy ? record.retainedBy : null;
          if (retained && (retained.mainView | 0) > 0) return ids[index];
        }
        return '';
      } catch (thrown) {
        return '';
      }
    }

    function displayTitleOf(entry) {
      if (entry && typeof entry.title === 'string' && entry.title !== '') return entry.title;
      const first = String(entry && entry.body ? entry.body : '').split('\n')[0].trim();
      if (first === '') return '（无标题）';
      return first.length > 40 ? first.slice(0, 40) + '…' : first;
    }

    function bodyFirstLine(entry) {
      const body = entry && typeof entry.body === 'string' ? entry.body : '';
      const first = body.split('\n')[0].trim();
      return first.length > 48 ? first.slice(0, 48) + '…' : first;
    }

    /** The clipboard text for one memo: 标题 newline 正文. */
    function buildCopyText(entry) {
      const body = entry && typeof entry.body === 'string' ? entry.body : '';
      let title = entry && typeof entry.title === 'string' && entry.title !== '' ? entry.title : '';
      if (title === '') {
        const first = body.split('\n')[0].trim();
        title = first.length > 40 ? first.slice(0, 40) + '…' : first || '（无标题）';
      }
      return body === '' ? title : title + '\n' + body;
    }

    /** Clipboard write: async Clipboard API first, then execCommand plus a temp textarea. */
    async function copyTextToClipboard(text) {
      const value = String(text);
      try {
        const nav = typeof navigator !== 'undefined' ? navigator : null;
        if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
          await nav.clipboard.writeText(value);
          return true;
        }
      } catch (thrown) {
        /* Clipboard API rejected (permissions / insecure context): use the fallback. */
      }
      try {
        if (typeof document === 'undefined') return false;
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        area.style.left = '-1000px';
        area.style.opacity = '0';
        (document.body || document.documentElement).appendChild(area);
        let ok = false;
        try {
          area.select();
          ok = document.execCommand('copy') === true;
        } catch (thrown) {
          ok = false;
        }
        if (area.parentNode) area.parentNode.removeChild(area);
        return ok;
      } catch (thrown) {
        return false;
      }
    }

    function gearIcon() {
      return h(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        [
          h('circle', { key: 'c', cx: 12, cy: 12, r: 3 }),
          h('path', {
            key: 'p',
            d:
              'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
          }),
        ],
      );
    }

    /** Flatten the three scopes into one card list, session then profile then user. */
    function flattenEntries(payload) {
      const out = [];
      if (!payload) return out;
      const scopes = ['session', 'profile', 'user'];
      for (let s = 0; s < scopes.length; s += 1) {
        const scope = scopes[s];
        const rows = Array.isArray(payload[scope]) ? payload[scope] : [];
        for (let index = 0; index < rows.length; index += 1) {
          out.push({ entry: rows[index], scope: scope });
        }
      }
      return out;
    }

    /**
     * The management UI (three scopes, add form, done toggle, inline edit, two
     * step delete). Rendered as the tab seat (embedded=false, with its own head)
     * or inside the overlay page (embedded=true, head supplied by the page).
     */
    function MemoPanel(props) {
      injectStyle();

      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : '';
      const embedded = props && props.embedded === true;
      const hasSession = sessionId !== '';

      const [payload, setPayload] = React.useState(null);
      const [loading, setLoading] = React.useState(true);
      const [error, setError] = React.useState(null);

      const [scope, setScope] = React.useState(hasSession ? 'session' : 'profile');
      const [title, setTitle] = React.useState('');
      const [body, setBody] = React.useState('');
      const [submitting, setSubmitting] = React.useState(false);

      const [editingId, setEditingId] = React.useState(null);
      const [editTitle, setEditTitle] = React.useState('');
      const [editBody, setEditBody] = React.useState('');

      const [confirmId, setConfirmId] = React.useState(null);
      const [removingId, setRemovingId] = React.useState(null);
      const [showHint, setShowHint] = React.useState(false);

      const confirmTimer = React.useRef(null);

      const limits = payload && payload.limits ? payload.limits : FALLBACK_LIMITS;
      const effectiveScope = !hasSession && scope === 'session' ? 'profile' : scope;

      function fetchNow() {
        setLoading(true);
        setError(null);
        requestState(sessionId)
          .then(function (next) {
            setPayload(next);
            setLoading(false);
          })
          .catch(function (thrown) {
            setError(messageOf(thrown));
            setLoading(false);
          });
      }

      React.useEffect(
        function () {
          fetchNow();
        },
        [sessionId],
      );

      React.useEffect(
        function () {
          return function () {
            if (confirmTimer.current !== null) {
              clearTimeout(confirmTimer.current);
              confirmTimer.current = null;
            }
          };
        },
        [],
      );

      function applyPayload(next) {
        if (next && next.ok !== false) setPayload(next);
      }

      function submitAdd() {
        const cleanTitle = title.trim();
        const cleanBody = body.trim();
        if (cleanTitle === '' && cleanBody === '') return;
        setSubmitting(true);
        setError(null);
        const params = { op: 'add', scope: effectiveScope, title: cleanTitle, body: cleanBody };
        params.sessionId = sessionId;
        requestWrite(params)
          .then(function (next) {
            applyPayload(next);
            setTitle('');
            setBody('');
            setSubmitting(false);
          })
          .catch(function (thrown) {
            setError(messageOf(thrown));
            setSubmitting(false);
          });
      }

      function toggleDone(entry) {
        setError(null);
        requestWrite({ op: 'update', id: entry.id, done: entry.done === true ? '0' : '1', sessionId: sessionId })
          .then(applyPayload)
          .catch(function (thrown) {
            setError(messageOf(thrown));
          });
      }

      function startEdit(entry) {
        setConfirmId(null);
        setEditingId(entry.id);
        setEditTitle(entry.title);
        setEditBody(entry.body);
      }

      function cancelEdit() {
        setEditingId(null);
        setEditTitle('');
        setEditBody('');
      }

      function saveEdit(entry) {
        const cleanTitle = editTitle.trim();
        const cleanBody = editBody.trim();
        if (cleanTitle === '' && cleanBody === '') {
          setError('标题和正文不能都空');
          return;
        }
        setError(null);
        requestWrite({ op: 'update', id: entry.id, title: cleanTitle, body: cleanBody, sessionId: sessionId })
          .then(function (next) {
            applyPayload(next);
            cancelEdit();
          })
          .catch(function (thrown) {
            setError(messageOf(thrown));
          });
      }

      function requestDelete(entry) {
        if (confirmId === entry.id) {
          performDelete(entry);
          return;
        }
        setConfirmId(entry.id);
        if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
        confirmTimer.current = setTimeout(function () {
          setConfirmId(null);
          confirmTimer.current = null;
        }, CONFIRM_MS);
      }

      function performDelete(entry) {
        setConfirmId(null);
        if (confirmTimer.current !== null) {
          clearTimeout(confirmTimer.current);
          confirmTimer.current = null;
        }
        setError(null);
        setRemovingId(entry.id);
        const wait = prefersReduced() ? 0 : OUT_MS;
        setTimeout(function () {
          requestWrite({ op: 'delete', id: entry.id, sessionId: sessionId })
            .then(function (next) {
              setRemovingId(null);
              applyPayload(next);
            })
            .catch(function (thrown) {
              setRemovingId(null);
              setError(messageOf(thrown));
            });
        }, wait);
      }

      function renderHead() {
        return h('div', { key: 'head', className: 'bm-head' }, [
          h('span', { key: 'title', className: 'bm-title' }, '备忘录'),
          h('span', { key: 'version', className: 'bm-version' }, 'v' + VERSION),
          h('span', { key: 'spacer', className: 'bm-head-spacer' }),
          h(
            'button',
            {
              key: 'hint',
              type: 'button',
              className: 'bm-btn bm-btn-ghost',
              'data-bm-hint-toggle': '1',
              onClick: function () {
                setShowHint(!showHint);
              },
            },
            showHint ? '收起说明' : '说明',
          ),
          h(
            'button',
            {
              key: 'refresh',
              type: 'button',
              className: 'bm-btn bm-btn-ghost',
              'data-bm-refresh': '1',
              disabled: loading,
              onClick: fetchNow,
            },
            loading ? '刷新中…' : '刷新',
          ),
        ]);
      }

      function renderForm() {
        return h('div', { key: 'form', className: 'bm-form' }, [
          h('div', { key: 'top', className: 'bm-form-top' }, [
            h('label', { key: 'scope', className: 'bm-field' }, [
              h('span', { key: 'sl', className: 'bm-field-label' }, '作用域'),
              h(
                'select',
                {
                  key: 'select',
                  className: 'bm-select',
                  'data-bm-scope': '1',
                  value: effectiveScope,
                  disabled: submitting,
                  onChange: function (event) {
                    setScope(event.target.value);
                  },
                },
                [
                  h('option', { key: 'session', value: 'session', disabled: !hasSession }, '本会话'),
                  h('option', { key: 'profile', value: 'profile' }, '全局共享'),
                  h('option', { key: 'user', value: 'user' }, '仅用户'),
                ],
              ),
            ]),
          ]),
          h('input', {
            key: 'title',
            className: 'bm-input',
            'data-bm-input': 'title',
            type: 'text',
            placeholder: '一句话',
            maxLength: limits.title,
            value: title,
            disabled: submitting,
            onChange: function (event) {
              setTitle(event.target.value);
            },
          }),
          h('textarea', {
            key: 'body',
            className: 'bm-input bm-textarea',
            'data-bm-input': 'body',
            rows: 3,
            placeholder: '要记住的事',
            maxLength: limits.body,
            value: body,
            disabled: submitting,
            onChange: function (event) {
              setBody(event.target.value);
            },
          }),
          hasSession
            ? null
            : h(
                'p',
                { key: 'note', className: 'bm-note' },
                '这个视图没带会话，只能用「全局共享」或「仅用户」。',
              ),
          h('div', { key: 'actions', className: 'bm-form-actions' }, [
            h(
              'button',
              {
                key: 'save',
                type: 'button',
                className: 'bm-btn bm-btn-primary',
                'data-bm-add': '1',
                disabled: submitting || (title.trim() === '' && body.trim() === ''),
                onClick: submitAdd,
              },
              submitting ? '存中…' : '存下',
            ),
          ]),
        ]);
      }

      function renderRow(entry, index) {
        const editing = editingId === entry.id;
        const removing = removingId === entry.id;
        const delay = Math.min(index * STAGGER_MS, (MAX_STAGGER - 1) * STAGGER_MS) + 'ms';
        const style = removing ? undefined : { animationDelay: delay };
        const children = [];

        if (editing) {
          children.push(
            h('div', { key: 'edit', className: 'bm-edit' }, [
              h('input', {
                key: 'et',
                className: 'bm-input',
                type: 'text',
                maxLength: limits.title,
                placeholder: '一句话',
                value: editTitle,
                onChange: function (event) {
                  setEditTitle(event.target.value);
                },
              }),
              h('textarea', {
                key: 'eb',
                className: 'bm-input bm-textarea',
                rows: 8,
                maxLength: limits.body,
                placeholder: '要记住的事',
                value: editBody,
                onChange: function (event) {
                  setEditBody(event.target.value);
                },
              }),
              h('div', { key: 'ea', className: 'bm-edit-actions' }, [
                h(
                  'button',
                  {
                    key: 'save',
                    type: 'button',
                    className: 'bm-btn bm-btn-primary',
                    'data-bm-edit-save': entry.id,
                    onClick: function () {
                      saveEdit(entry);
                    },
                  },
                  '存',
                ),
                h(
                  'button',
                  {
                    key: 'cancel',
                    type: 'button',
                    className: 'bm-btn',
                    'data-bm-edit-cancel': entry.id,
                    onClick: cancelEdit,
                  },
                  '取消',
                ),
              ]),
            ]),
          );
        } else {
          const confirming = confirmId === entry.id;
          children.push(
            h('div', { key: 'head', className: 'bm-row-head' }, [
              h('label', { key: 'label', className: 'bm-check' }, [
                h('input', {
                  key: 'cb',
                  type: 'checkbox',
                  'data-bm-done': entry.id,
                  checked: entry.done === true,
                  onChange: function () {
                    toggleDone(entry);
                  },
                }),
                h(
                  'span',
                  { key: 't', className: entry.done === true ? 'bm-row-title bm-done' : 'bm-row-title' },
                  displayTitleOf(entry),
                ),
              ]),
              h('div', { key: 'actions', className: 'bm-row-actions' }, [
                h(
                  'button',
                  {
                    key: 'edit',
                    type: 'button',
                    className: 'bm-btn bm-btn-ghost bm-row-act',
                    'data-bm-edit': entry.id,
                    onClick: function () {
                      startEdit(entry);
                    },
                  },
                  '改',
                ),
                h(
                  'button',
                  {
                    key: 'delete',
                    type: 'button',
                    className: confirming ? 'bm-btn bm-btn-danger bm-row-act' : 'bm-btn bm-btn-ghost bm-row-act',
                    'data-bm-delete': entry.id,
                    onClick: function () {
                      requestDelete(entry);
                    },
                  },
                  confirming ? '确定删？' : '删',
                ),
              ]),
            ]),
          );
          if (typeof entry.body === 'string' && entry.body !== '') {
            children.push(h('div', { key: 'body', className: 'bm-row-body' }, entry.body));
          }
        }

        return h(
          'li',
          {
            key: entry.id,
            className: 'bm-row' + (removing ? ' bm-row-out' : ''),
            'data-bm-row': entry.id,
            style: style,
          },
          children,
        );
      }

      function renderGroup(key) {
        const entries = payload !== null && Array.isArray(payload[key]) ? payload[key] : [];
        const list =
          entries.length === 0
            ? h('p', { key: 'empty', className: 'bm-empty' }, '这一栏还空着')
            : h(
                'ul',
                { key: 'list', className: 'bm-list' },
                entries.map(function (entry, index) {
                  return renderRow(entry, index);
                }),
              );
        return h('section', { key: key, className: 'bm-group', 'data-bm-group': key }, [
          h('div', { key: 'head', className: 'bm-group-head' }, GROUP_LABEL[key] + String(entries.length)),
          list,
        ]);
      }

      function renderError() {
        return h('div', { key: 'error', className: 'bm-error', 'data-bm-error': '1' }, [
          h('span', { key: 'msg' }, '出错了：' + error),
          h('span', { key: 'spacer', className: 'bm-error-spacer' }),
          h(
            'button',
            {
              key: 'retry',
              type: 'button',
              className: 'bm-btn',
              'data-bm-retry': '1',
              onClick: fetchNow,
            },
            '重试',
          ),
        ]);
      }

      const groups = hasSession ? ['session', 'profile', 'user'] : ['profile', 'user'];

      return h(
        'div',
        {
          className: 'bm-panel',
          'data-better-memo': 'panel',
          'data-better-memo-version': VERSION,
        },
        [
          embedded ? null : renderHead(),
          !embedded && showHint ? h('p', { key: 'hint', className: 'bm-hint' }, HINT_TEXT) : null,
          renderForm(),
          error !== null ? renderError() : null,
          loading && payload === null ? h('p', { key: 'loading', className: 'bm-loading' }, '加载中…') : null,
          payload !== null
            ? h(
                'div',
                { key: 'groups', className: 'bm-groups' },
                groups.map(function (key) {
                  return renderGroup(key);
                }),
              )
            : null,
        ],
      );
    }

    /**
     * The overlay: capsule button plus either the floating card or the full page.
     * Both card and page are portalled to document.body so a fixed position is
     * never trapped by the shell.overlay container's stacking context.
     */
    function OverlayEntry(props) {
      injectStyle();

      const getSessionId = props && typeof props.getSessionId === 'function' ? props.getSessionId : function () { return ''; };
      const subscribeSessions = props && typeof props.subscribe === 'function' ? props.subscribe : null;
      const seat = props && props.seat ? props.seat : null;
      const variant = props && props.variant === 'floating' ? 'floating' : 'topbar';

      const [phase, setPhase] = React.useState('closed');
      const [closing, setClosing] = React.useState(false);
      const [payload, setPayload] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [settings, setSettings] = React.useState({ showTabEntry: false });
      const [settingsSaving, setSettingsSaving] = React.useState(false);
      const [settingsError, setSettingsError] = React.useState(null);
      const [toast, setToast] = React.useState(null);
      const [sessionId, setSessionId] = React.useState(function () {
        return getSessionId();
      });
      const [hasSession, setHasSession] = React.useState(function () {
        return getSessionId() !== '';
      });

      const cardRef = React.useRef(null);
      const capsuleRef = React.useRef(null);
      const toastTimer = React.useRef(null);

      function fetchState(sid) {
        setLoading(true);
        setError(null);
        requestState(sid)
          .then(function (next) {
            setPayload(next);
            setSettings(settingsOf(next));
            setLoading(false);
          })
          .catch(function (thrown) {
            setError(messageOf(thrown));
            setLoading(false);
          });
      }

      React.useEffect(function () {
        const sid = getSessionId();
        setSessionId(sid);
        setHasSession(sid !== '');
        requestState(sid)
          .then(function (next) {
            setPayload(next);
            setSettings(settingsOf(next));
          })
          .catch(function () {
            /* the capsule still opens; its first refresh will retry */
          });
        return function () {
          if (toastTimer.current !== null) {
            clearTimeout(toastTimer.current);
            toastTimer.current = null;
          }
        };
      }, []);

      /* The capsule belongs to a conversation. On the new-session / welcome
         screen there is no session in the main view, so it stays hidden. */
      React.useEffect(function () {
        if (subscribeSessions === null) return undefined;
        const sync = function () {
          const next = getSessionId();
          setSessionId(function (prev) {
            return prev === next ? prev : next;
          });
          setHasSession(next !== '');
          if (next === '') setPhase('closed');
        };
        sync();
        let stop = null;
        try {
          stop = subscribeSessions(sync);
        } catch (thrown) {
          stop = null;
        }
        return function () {
          if (typeof stop === 'function') stop();
        };
      }, []);

      React.useEffect(
        function () {
          if (toast === null) return undefined;
          if (toastTimer.current !== null) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(function () {
            toastTimer.current = null;
            setToast(null);
          }, COPY_MS);
          return function () {
            if (toastTimer.current !== null) {
              clearTimeout(toastTimer.current);
              toastTimer.current = null;
            }
          };
        },
        [toast],
      );

      function openCard() {
        const sid = getSessionId();
        setSessionId(sid);
        setPhase('card');
        setClosing(false);
        fetchState(sid);
      }

      function requestClose() {
        if (phase === 'card') {
          if (closing) return;
          if (prefersReduced()) {
            setPhase('closed');
            setClosing(false);
          } else {
            setClosing(true);
          }
        } else if (phase === 'page') {
          setPhase('closed');
          setClosing(false);
        }
      }

      function toggle() {
        if (phase === 'closed') openCard();
        else requestClose();
      }

      function toPage() {
        setPhase('page');
        setClosing(false);
      }

      function backToCard() {
        setPhase('card');
        setClosing(false);
        /* The page edits entries; the card list must not show the stale snapshot. */
        fetchState(getSessionId());
      }

      function onCardAnimationEnd(event) {
        if (event && event.target !== cardRef.current) return;
        if (closing) {
          setPhase('closed');
          setClosing(false);
        }
      }

      /* Outside click and ESC close the card. */
      React.useEffect(
        function () {
          if (phase !== 'card') return undefined;
          function onDown(event) {
            const card = cardRef.current;
            const capsule = capsuleRef.current;
            if (card && card.contains(event.target)) return;
            if (capsule && capsule.contains(event.target)) return;
            requestClose();
          }
          function onKey(event) {
            if (event.key === 'Escape') {
              event.stopPropagation();
              requestClose();
            }
          }
          document.addEventListener('mousedown', onDown, true);
          document.addEventListener('keydown', onKey, true);
          return function () {
            document.removeEventListener('mousedown', onDown, true);
            document.removeEventListener('keydown', onKey, true);
          };
        },
        [phase, closing],
      );

      /* ESC backs out of the page; a click on the area outside the page does the same.
         mousedown (not click) so a drag that starts inside the page never counts. */
      React.useEffect(
        function () {
          if (phase !== 'page') return undefined;
          function onKey(event) {
            if (event.key === 'Escape') {
              event.stopPropagation();
              backToCard();
            }
          }
          function onDown(event) {
            const backdrop = document.querySelector('[data-bm-backdrop="1"]');
            if (!backdrop) return;
            if (backdrop.contains(event.target) && event.target !== backdrop) return;
            backToCard();
          }
          document.addEventListener('keydown', onKey, true);
          document.addEventListener('mousedown', onDown, true);
          return function () {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('mousedown', onDown, true);
          };
        },
        [phase],
      );

      function copyEntry(entry) {
        copyTextToClipboard(buildCopyText(entry)).then(function (ok) {
          setToast(ok ? '已复制' : '复制失败');
        }).catch(function () {
          setToast('复制失败');
        });
      }

      function applyShowTab(next) {
        const prev = settings;
        const want = next === true;
        setSettings({ showTabEntry: want });
        setSettingsSaving(true);
        setSettingsError(null);
        requestSettings(want)
          .then(function (result) {
            const resolved = settingsOf(result);
            setSettings({ showTabEntry: resolved.showTabEntry });
            if (seat && typeof seat.setEnabled === 'function') seat.setEnabled(resolved.showTabEntry);
            setSettingsSaving(false);
          })
          .catch(function (thrown) {
            setSettings(prev);
            setSettingsError(messageOf(thrown));
            setSettingsSaving(false);
          });
      }

      const entries = flattenEntries(payload);
      const count = entries.length;

      const capsule = h(
        'button',
        {
          key: 'capsule',
          ref: capsuleRef,
          type: 'button',
          className: 'bm-capsule' + (variant === 'floating' ? ' bm-capsule-floating' : ''),
          'data-bm-entry': '1',
          'data-better-memo-version': VERSION,
          'data-bm-open': phase !== 'closed' ? '1' : '0',
          'aria-label': '备忘录',
          title: '备忘录',
          onClick: toggle,
        },
        [
          h('span', { key: 'label', className: 'bm-capsule-label' }, '备忘录'),
          count > 0 ? h('span', { key: 'count', className: 'bm-capsule-count' }, String(count)) : null,
        ],
      );

      function cardBody() {
        const items = [];
        if (loading && payload === null) {
          items.push(h('p', { key: 'loading', className: 'bm-card-empty' }, '加载中…'));
        } else if (error !== null) {
          items.push(
            h('div', { key: 'error', className: 'bm-card-error' }, [
              h('span', { key: 'm' }, '出错了：' + error),
              h(
                'button',
                {
                  key: 'r',
                  type: 'button',
                  className: 'bm-btn bm-btn-ghost',
                  onClick: function () {
                    fetchState(sessionId);
                  },
                },
                '重试',
              ),
            ]),
          );
        } else if (entries.length === 0) {
          items.push(h('p', { key: 'empty', className: 'bm-card-empty' }, '还没有备忘录'));
        } else {
          entries.forEach(function (item, index) {
            const delay = Math.min(index * STAGGER_MS, (MAX_STAGGER - 1) * STAGGER_MS) + 'ms';
            const sub = bodyFirstLine(item.entry);
            const rowChildren = [
              h('span', { key: 'dot', className: 'bm-card-dot', 'data-bm-scope': item.scope, 'aria-hidden': 'true' }),
              h('span', { key: 'text', className: 'bm-card-item-text' }, [
                h('span', { key: 't', className: 'bm-card-item-title' }, displayTitleOf(item.entry)),
                sub !== '' ? h('span', { key: 's', className: 'bm-card-item-sub' }, sub) : null,
              ]),
              h('span', { key: 'tag', className: 'bm-card-tag', 'data-bm-scope': item.scope }, SCOPE_TAG[item.scope] || item.scope),
            ];
            items.push(
              h(
                'button',
                {
                  key: item.entry.id || 'entry-' + index,
                  type: 'button',
                  className: 'bm-card-item',
                  'data-bm-copy': item.entry.id || '',
                  'data-bm-scope': item.scope,
                  title: displayTitleOf(item.entry),
                  style: closing ? undefined : { animationDelay: delay },
                  onClick: function () {
                    copyEntry(item.entry);
                  },
                },
                rowChildren,
              ),
            );
          });
        }
        return items;
      }

      function cardNode() {
        return h(
          'div',
          {
            key: 'card',
            ref: cardRef,
            className: 'bm-card' + (closing ? ' bm-card-out' : '') + (variant === 'floating' ? ' bm-card-floating' : ''),
            'data-bm-card': '1',
            onAnimationEnd: onCardAnimationEnd,
          },
          [
            h('div', { key: 'head', className: 'bm-card-head' }, [
              h('span', { key: 'title', className: 'bm-card-title' }, '备忘录'),
              h('span', { key: 'count', className: 'bm-card-count' }, String(count)),
              h('span', { key: 'spacer', className: 'bm-card-spacer' }),
              h(
                'button',
                {
                  key: 'gear',
                  type: 'button',
                  className: 'bm-card-gear',
                  'data-bm-gear': '1',
                  'aria-label': '设置',
                  title: '设置',
                  onClick: toPage,
                },
                gearIcon(),
              ),
            ]),
            h('div', { key: 'body', className: 'bm-card-body' }, cardBody()),
            count > 0
              ? h('div', { key: 'foot', className: 'bm-card-foot' }, '点一行即可复制；齿轮里管理全部')
              : null,
            toast !== null ? h('div', { key: 'toast', className: 'bm-card-toast', role: 'status' }, toast) : null,
          ],
        );
      }

      function pageNode() {
        return h('div', { key: 'page', className: 'bm-overlay-backdrop', 'data-bm-backdrop': '1' }, [
          h('div', { key: 'panel', className: 'bm-page', 'data-bm-page': '1' }, [
            h('div', { key: 'head', className: 'bm-page-head' }, [
              h(
                'button',
                { key: 'back', type: 'button', className: 'bm-btn bm-btn-ghost bm-page-back', 'data-bm-back': '1', onClick: backToCard },
                '← 返回',
              ),
              h('span', { key: 'title', className: 'bm-page-title' }, '备忘录设置'),
              h('span', { key: 'spacer', className: 'bm-page-spacer' }),
              h(
                'button',
                {
                  key: 'close',
                  type: 'button',
                  className: 'bm-btn bm-btn-ghost bm-page-close',
                  'data-bm-close': '1',
                  'aria-label': '关闭',
                  onClick: function () {
                    setPhase('closed');
                    setClosing(false);
                  },
                },
                '×',
              ),
            ]),
            h('div', { key: 'switch', className: 'bm-page-switch' }, [
              h('label', { key: 'label', className: 'bm-switch' }, [
                h('input', {
                  key: 'input',
                  type: 'checkbox',
                  'data-bm-showtab': '1',
                  checked: settings.showTabEntry === true,
                  disabled: settingsSaving,
                  onChange: function (event) {
                    applyShowTab(event.target.checked);
                  },
                }),
                h('span', { key: 'text' }, '在会话 tab 行显示「备忘录」入口'),
              ]),
              settingsError !== null ? h('span', { key: 'err', className: 'bm-switch-error' }, settingsError) : null,
            ]),
            h('div', { key: 'body', className: 'bm-page-body' }, h(MemoPanel, { sessionId: sessionId, embedded: true })),
          ]),
        ]);
      }

      if (hasSession === false) return null;

      let overlay = null;
      if (phase === 'card') overlay = cardNode();
      else if (phase === 'page') overlay = pageNode();

      const portal = overlay !== null && typeof document !== 'undefined' && document.body
        ? ReactDOM.createPortal(overlay, document.body)
        : null;

      return h(React.Fragment, null, [capsule, portal]);
    }

    /**
     * Owns the single conversation.view tab seat. Registering and disposing are
     * the two moments the settings switch drives; a not-yet-declared slot is
     * retried (never assumed), matching the "ask slots.spec first" rule.
     */
    function createSeatController(ctx) {
      let dispose = null;
      let enabled = false;
      let attempts = 0;
      let timer = null;

      function slotsOf() {
        try {
          return typeof ctx.get === 'function' ? ctx.get('slots') : undefined;
        } catch (thrown) {
          return undefined;
        }
      }

      function clearTimer() {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      }

      function schedule() {
        clearTimer();
        if (!enabled) return;
        if (attempts >= RETRY_LIMIT) return;
        attempts += 1;
        timer = setTimeout(function () {
          timer = null;
          register();
        }, RETRY_MS);
      }

      function register() {
        if (!enabled || dispose !== null) return;
        const slots = slotsOf();
        if (!slots || typeof slots.register !== 'function') {
          schedule();
          return;
        }
        let declared = false;
        try {
          declared = typeof slots.spec === 'function' && slots.spec(SLOT) !== undefined;
        } catch (thrown) {
          declared = false;
        }
        if (!declared) {
          schedule();
          return;
        }
        try {
          dispose = slots.register(
            { name: SLOT, id: SEAT_ID, order: 1, label: function () { return '备忘录'; } },
            function (props) {
              const sid = props && typeof props.sessionId === 'string' ? props.sessionId : '';
              return h(MemoPanel, { sessionId: sid, embedded: false });
            },
          );
        } catch (thrown) {
          dispose = null;
          schedule();
        }
      }

      function setEnabled(next) {
        const want = next === true;
        enabled = want;
        if (want) {
          attempts = 0;
          register();
        } else {
          clearTimer();
          attempts = 0;
          if (dispose !== null) {
            const drop = dispose;
            dispose = null;
            try {
              drop();
            } catch (thrown) {
              /* host already released it */
            }
          }
        }
      }

      return {
        setEnabled: setEnabled,
        isEnabled: function () { return enabled; },
        hasSeat: function () { return dispose !== null; },
      };
    }

    function mountBodyFallback(deps) {
      if (typeof document === 'undefined' || !document.body) return;
      try {
        const host = document.createElement('div');
        host.id = FALLBACK_HOST_ID;
        host.setAttribute('data-better-memo-overlay', '');
        document.body.appendChild(host);
        const root = ReactDOMClient.createRoot(host);
        root.render(h(OverlayEntry, { seat: deps.seat, getSessionId: deps.getSessionId, subscribe: deps.subscribe, variant: 'floating' }));
      } catch (thrown) {
        console.error('[better-memo] floating entry failed', thrown);
      }
    }

    function apply(ctx) {
      injectStyle();
      const seat = createSeatController(ctx);
      const deps = {
        seat: seat,
        getSessionId: function () {
          return currentSessionId(ctx);
        },
        /* Sessions list changes decide whether a conversation is on screen at
           all; the capsule hides itself while the welcome screen is up. */
        subscribe: function (listener) {
          try {
            const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined;
            if (!sessions || !sessions.list || typeof sessions.list.subscribe !== 'function') return null;
            return sessions.list.subscribe(listener);
          } catch (thrown) {
            return null;
          }
        },
      };

      let overlayMounted = false;
      let seatStarted = false;

      function startSeat() {
        if (seatStarted) return;
        seatStarted = true;
        requestState('')
          .then(function (payload) {
            seat.setEnabled(settingsOf(payload).showTabEntry);
          })
          .catch(function () {
            /* unreachable host: leave the seat off */
          });
      }

      function registerCapsule(slots) {
        if (overlayMounted) return;
        try {
          slots.register(
            { name: TOPBAR_SLOT, id: CAPSULE_ID, order: 0, label: function () { return '备忘录'; } },
            function () {
              return h(OverlayEntry, { seat: seat, getSessionId: deps.getSessionId, subscribe: deps.subscribe, variant: 'topbar' });
            },
          );
          overlayMounted = true;
        } catch (thrown) {
          console.error('[better-memo] capsule registration failed', thrown);
        }
      }

      function mountFloating() {
        if (overlayMounted) return;
        overlayMounted = true;
        mountBodyFallback(deps);
      }

      function boot(attemptsLeft) {
        let slots = null;
        try {
          slots = typeof ctx.get === 'function' ? ctx.get('slots') : undefined;
        } catch (thrown) {
          slots = undefined;
        }
        if (slots === undefined || slots === null) {
          if (attemptsLeft > 0) {
            setTimeout(function () { boot(attemptsLeft - 1); }, RETRY_MS);
            return;
          }
          mountFloating();
          return;
        }
        startSeat();
        let hasOverlay = false;
        try {
          hasOverlay = typeof slots.spec === 'function' && slots.spec(TOPBAR_SLOT) !== undefined;
        } catch (thrown) {
          hasOverlay = false;
        }
        if (hasOverlay) {
          registerCapsule(slots);
          return;
        }
        if (attemptsLeft > 0) {
          setTimeout(function () { boot(attemptsLeft - 1); }, RETRY_MS);
          return;
        }
        mountFloating();
      }

      boot(RETRY_LIMIT);
    }

    return {
      apply,
      /* Exposed only for the headless logic probe; the loader ignores extra keys. */
      __probe: {
        buildCopyText: buildCopyText,
        displayTitleOf: displayTitleOf,
        settingsOf: settingsOf,
        copyTextToClipboard: copyTextToClipboard,
        createSeatController: createSeatController,
        requestSettings: requestSettings,
        currentSessionId: currentSessionId,
        flattenEntries: flattenEntries,
        constants: { VERSION: VERSION, VERSION_STRING: '0.2.0' },
      },
    };
  },
});
