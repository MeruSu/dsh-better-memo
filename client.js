/**
 * dsh-better-memo — Client half.
 *
 * One tab seat on conversation.view (better-memo-seat, order 1, label
 * 「备忘录」) that renders the three-scope memo panel. Everything lives inside
 * factory(require) — the host concatenates every plugin client into one module,
 * so a single top-level const would collide with another plugin and take the
 * whole page down.
 *
 * Data path: the panel only ever talks to the host route /better-memo
 * (GET /state?sessionId=… and GET /write?…), always with the
 * x-better-memo: 1 marker. The host's webserver answers GET/HEAD only, so
 * writes are GETs too. Every write answers the full, fresh state payload, which
 * the panel swaps straight in — no follow-up read.
 *
 * The current session id comes from the seat component's props.sessionId;
 * when a view has none, the 本会话 group is hidden and the session scope option
 * is disabled rather than guessed.
 *
 * DO NOT introduce a top-level declaration, a template literal in the CSS, or a
 * native confirm dialog (deletes use an inline two-step confirm instead).
 */
window.__ModuleLoader__.load({
  id: 'dsh-better-memo',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'better-memo';
    const VERSION = '0.1.0';
    const SLOT = 'conversation.view';
    const SEAT_ID = 'better-memo-seat';
    const ROUTE = '/better-memo';
    const MARKER = { 'x-better-memo': '1' };
    const STYLE_ID = 'better-memo-style';
    const CONFIRM_MS = 3000;
    const OUT_MS = 160;
    const MAX_STAGGER = 8;
    const STAGGER_MS = 40;

    const FALLBACK_LIMITS = { title: 120, body: 4000, entries: 500 };
    const GROUP_LABEL = { session: '本会话', profile: '本 profile', user: '仅我可见' };
    const HINT_TEXT =
      '本会话只在本会话里出现；本 profile 会出现在同一 profile 的所有会话；' +
      '仅我可见只有你自己在这个面板里看得到，AI 读不到，也改不了。';

    /** One style element per page, injected once; guarded by this flag inside the factory. */
    let styleInjected = false;

    /* CSS is plain string concatenation on purpose: a template literal here would
       let an accidental backtick truncate the file and break the whole bundle. */
    const CSS = [
      '.bm-panel{display:flex;flex-direction:column;gap:14px;padding:16px 20px;font-size:13px;color:inherit;box-sizing:border-box;animation:bm-enter-frames 200ms cubic-bezier(.22,1,.36,1) both}',
      '.bm-panel *{box-sizing:border-box}',
      '.bm-head{display:flex;align-items:center;gap:6px}',
      '.bm-title{font-size:15px;font-weight:600;margin:0}',
      '.bm-version{font-size:11px;color:var(--dsw-alias-label-secondary,#8a8f98);margin-left:2px}',
      '.bm-head-spacer{flex:1 1 auto}',
      '.bm-btn{font:inherit;font-size:12px;line-height:1;border-radius:7px;border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.32));background:transparent;color:inherit;padding:7px 12px;cursor:pointer}',
      '.bm-btn:hover{border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.5))}',
      '.bm-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.bm-btn-primary{background:var(--dsw-alias-accent,#3b82f6);border-color:transparent;color:#fff}',
      '.bm-btn-ghost{border-color:transparent;color:var(--dsw-alias-label-secondary,#8a8f98);padding:6px 8px}',
      '.bm-btn-danger{color:var(--dsw-alias-danger,#e5484d);border-color:var(--dsw-alias-danger,#e5484d)}',
      '.bm-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#8a8f98)}',
      '.bm-form{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:10px;background:var(--dsw-alias-bg-l2,rgba(127,127,127,.07));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16))}',
      '.bm-form-top{display:flex;gap:8px;align-items:center}',
      '.bm-field{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#8a8f98)}',
      '.bm-input{font:inherit;font-size:13px;width:100%;border-radius:8px;border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.32));background:var(--dsw-alias-bg-base,transparent);color:inherit;padding:8px 10px}',
      '.bm-input:focus{outline:none;border-color:var(--dsw-alias-accent,#3b82f6)}',
      '.bm-select{font:inherit;font-size:13px;border-radius:8px;border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.32));background:var(--dsw-alias-bg-base,transparent);color:inherit;padding:6px 8px}',
      '.bm-textarea{resize:vertical;min-height:58px;line-height:19px}',
      '.bm-form-actions{display:flex;justify-content:flex-end;gap:8px}',
      '.bm-note{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6)}',
      '.bm-groups{display:flex;flex-direction:column;gap:14px}',
      '.bm-group{display:flex;flex-direction:column;gap:8px}',
      '.bm-group-head{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#8a8f98);margin:0}',
      '.bm-empty{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary,#9aa0a6);padding:4px 2px}',
      '.bm-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}',
      '.bm-row{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));background:var(--dsw-alias-bg-l1,rgba(127,127,127,.04));animation:bm-item-frames 240ms cubic-bezier(.22,1,.36,1) both}',
      '.bm-row-out{animation:bm-out-frames 160ms cubic-bezier(.4,0,1,1) forwards;pointer-events:none}',
      '.bm-row-head{display:flex;align-items:flex-start;gap:8px}',
      '.bm-check{display:flex;align-items:flex-start;gap:8px;flex:1 1 auto;min-width:0;cursor:pointer}',
      '.bm-check input{margin:2px 0 0}',
      '.bm-row-title{font-size:13px;font-weight:500;word-break:break-word}',
      '.bm-done{text-decoration:line-through;color:var(--dsw-alias-label-tertiary,#9aa0a6)}',
      '.bm-row-body{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#8a8f98);white-space:pre-wrap;word-break:break-word;max-height:120px;overflow:auto}',
      '.bm-row-actions{display:flex;justify-content:flex-end;gap:6px}',
      '.bm-edit{display:flex;flex-direction:column;gap:6px}',
      '.bm-edit-actions{display:flex;justify-content:flex-end;gap:6px}',
      '.bm-error{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid var(--dsw-alias-danger,#e5484d);color:var(--dsw-alias-danger,#e5484d);font-size:12px}',
      '.bm-error-spacer{flex:1 1 auto}',
      '.bm-loading{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary,#8a8f98)}',
      '@keyframes bm-enter-frames{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
      '@keyframes bm-item-frames{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      '@keyframes bm-out-frames{to{opacity:0;transform:scale(.92)}}',
      '@keyframes bm-fade-frames{from{opacity:0}to{opacity:1}}',
      '@media (prefers-reduced-motion: reduce){.bm-panel,.bm-row:not(.bm-row-out){animation-name:bm-fade-frames !important;animation-duration:120ms !important;animation-delay:0ms !important}.bm-row-out{animation:bm-out-frames 1ms linear forwards !important}}',
    ].join('\n');

    function injectStyle() {
      if (styleInjected === true) return;
      styleInjected = true;
      try {
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

    /**
     * The panel. props.sessionId is the id of the conversation currently shown
     * on this tab; the host passes it to every conversation.view seat.
     */
    function Panel(props) {
      injectStyle();

      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : '';
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

      function displayTitle(entry) {
        if (typeof entry.title === 'string' && entry.title !== '') return entry.title;
        const first = String(entry.body || '').split('\n')[0].trim();
        if (first === '') return '（无标题）';
        return first.length > 40 ? first.slice(0, 40) + '…' : first;
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
                  h('option', { key: 'profile', value: 'profile' }, '本 profile'),
                  h('option', { key: 'user', value: 'user' }, '仅我可见'),
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
                '这个视图没带会话，只能用「本 profile」或「仅我可见」。',
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
                rows: 3,
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
                  displayTitle(entry),
                ),
              ]),
            ]),
          );
          if (typeof entry.body === 'string' && entry.body !== '') {
            children.push(h('div', { key: 'body', className: 'bm-row-body' }, entry.body));
          }
          const confirming = confirmId === entry.id;
          children.push(
            h('div', { key: 'actions', className: 'bm-row-actions' }, [
              h(
                'button',
                {
                  key: 'edit',
                  type: 'button',
                  className: 'bm-btn',
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
                  className: confirming ? 'bm-btn bm-btn-danger' : 'bm-btn',
                  'data-bm-delete': entry.id,
                  onClick: function () {
                    requestDelete(entry);
                  },
                },
                confirming ? '确定删？' : '删',
              ),
            ]),
          );
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
          h('div', { key: 'head', className: 'bm-group-head' }, GROUP_LABEL[key] + ' (' + entries.length + ')'),
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
          renderHead(),
          showHint ? h('p', { key: 'hint', className: 'bm-hint' }, HINT_TEXT) : null,
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
     * `ctx.slots` throws until the entry declares it, so ask with `ctx.get`,
     * and retry briefly: the client half can apply before the renderer has
     * published the service. No scope capture, no polling loop of our own.
     */
    function apply(ctx) {
      const waitForSlots = (attemptsLeft) => {
        let slots = null;
        try {
          slots = typeof ctx.get === 'function' ? ctx.get('slots') : undefined;
        } catch (thrown) {
          slots = undefined;
        }
        if (slots === undefined || slots === null) {
          if (attemptsLeft > 0) setTimeout(() => waitForSlots(attemptsLeft - 1), 250);
          return;
        }
        try {
          if (slots.spec(SLOT) === undefined) {
            if (attemptsLeft > 0) setTimeout(() => waitForSlots(attemptsLeft - 1), 250);
            return;
          }
          slots.register(
            {
              name: SLOT,
              id: SEAT_ID,
              order: 1,
              label: () => '备忘录',
            },
            Panel,
          );
        } catch (thrown) {
          console.error('[better-memo] seat registration failed', thrown);
        }
      };
      waitForSlots(20);
    }

    return { apply };
  },
});
