/**
 * Tests for dsh-better-memo — the HOST half only (`index.js` + `lib/store.js`).
 *
 * The client half is a web component that needs a live Cordis host to mount, so
 * it is not exercised here. What IS proven here is the contract the panel and the
 * five agent tools rely on:
 *
 *   - the three tiers are filed where they belong: `session` is visible only to
 *     its own session, `profile` to every session of the profile, `user` to the
 *     panel (and, after an approval, to `memo_read_private`) but never to any
 *     other tool;
 *   - the five tools register under their own names, and `memo_read_private`
 *     only when the host approval service exists;
 *   - the two read tools each return exactly one tier, drop `done`, and are
 *     hidden by their `when` condition while that tier is empty;
 *   - the two edit tools have their tier baked in (no `scope` in the schema),
 *     `memo_edit_shared` always writes `scope=profile`, and neither can reach a
 *     `user` row or another session's `session` row;
 *   - `memo_read_private` needs a fresh approval every call: allowed returns the
 *     rows, denied/cancelled/unavailable return no content at all;
 *   - `when` and `execute` contain their own failures (a throw there fails the
 *     whole model step, so it must never happen);
 *   - `LIMITS` truncates title/body;
 *   - the routes answer 403 without the `x-better-memo` marker;
 *   - every write returns the fresh state payload the panel swaps in.
 *
 * The host wiring through `ctx.inject(['webServer'], …)` needs a live host, so the
 * route handlers are driven directly (`serveState` / `serveWrite` / `serveRequest`)
 * with real Request/Response objects, and `apply()` is driven with a fake ctx that
 * captures the registered tools and can supply a fake approval service — enough
 * to prove the contract without a server.
 *
 * Run: node test/memo.test.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ------------------------------------------------------- tiny test harness */

let groups = 0;
let failed = 0;
const failures = [];
const queue = [];

function test(name, fn) {
  queue.push({ name, fn });
}

async function runOne(name, fn) {
  groups += 1;
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (thrown) {
    failed += 1;
    failures.push({ name, thrown });
    console.log(`FAIL ${name}`);
    console.log(`  ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  }
}

function assert(condition, message) {
  if (condition !== true) throw new Error(message ?? "assertion failed");
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message ?? "not equal"}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
    );
  }
}

/* ------------------------------------------------------ isolated store file */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-memo-test-"));
const FILE = path.join(TMP, "memos.json");
process.env.DSH_MEMO_FILE = FILE;
process.env.DSH_PROFILE = "profile-test";

function reset() {
  try {
    fs.rmSync(FILE, { force: true });
  } catch {
    /* first run: nothing there */
  }
}

const store = await import("../lib/store.js");
const host = await import("../index.js");

/**
 * Drive `apply()` with a fake ctx and return the registered tools. `approval`
 * stands in for `ctx.approval`; omitting it proves the soft dependency (the
 * private-read tool then must not exist). `inject` only answers the optional
 * approval dependency, never webServer.
 */
function registerTools({ approval } = {}) {
  const map = new Map();
  const services = approval === undefined ? {} : { approval };
  const ctx = {
    tools: { register(spec) { map.set(spec.name, spec); } },
    systemPrompt: { section() {} },
    get(serviceName) { return services[serviceName]; },
    inject(deps, callback) {
      if (approval !== undefined && Array.isArray(deps) && deps.includes("approval")) callback({ approval });
    },
    effect() {},
  };
  host.apply(ctx);
  return map;
}

/** The activation context the host feeds a tool's `when` on every model step. */
function activation(agent = { id: "sess-A" }) {
  return { agent, modelSelection: { provider: "test", model: "test" }, signal: new AbortController().signal };
}

function enabled(tools, name, agent) {
  const spec = tools.get(name);
  if (spec === undefined) return false;
  if (typeof spec.when !== "function") return true;
  return spec.when(activation(agent)) === true;
}

/** A stand-in approval seam that records every request and returns one outcome. */
function fakeApproval(outcome, calls = []) {
  return {
    async request(req) {
      calls.push(req);
      return outcome;
    },
  };
}

/* ---------------------------------------------------- 1. the three tiers */

test("the three scopes are filed where they belong", () => {
  reset();
  const db = store.read();
  const sessionRow = store.addEntry(db, {
    scope: "session",
    sessionId: "sess-A",
    profile: "profile-test",
    title: "会话备忘",
    body: "只给 A",
    createdBy: "agent",
  });
  const profileRow = store.addEntry(db, {
    scope: "profile",
    profile: "profile-test",
    title: "profile 备忘",
    body: "整个 profile",
    createdBy: "agent",
  });
  const userRow = store.addEntry(db, {
    scope: "user",
    profile: "profile-test",
    title: "私藏",
    body: "只有面板看得到",
    createdBy: "user",
  });
  assert(sessionRow.scope === "session", "the session row keeps its scope");
  assert(profileRow.profile === "profile-test", "the profile row is tagged with this profile");
  assert(userRow.scope === "user", "the user row keeps its scope");

  const seenA = store.visibleTo(db, { sessionId: "sess-A", profile: "profile-test" });
  assertEqual(seenA.session.length, 1, "session A sees its own session row");
  assertEqual(seenA.profile.length, 1, "session A sees the profile row");
  assertEqual(seenA.user.length, 1, "the panel (seenA) also sees the user row");

  const seenB = store.visibleTo(db, { sessionId: "sess-B", profile: "profile-test" });
  assertEqual(seenB.session.length, 0, "another session does NOT see session A's row");
  assertEqual(seenB.profile.length, 1, "another session of the same profile sees the profile row");
  assertEqual(seenB.user.length, 1, "the user row is still visible to the user's panel from B");

  const seenOther = store.visibleTo(db, { sessionId: "sess-B", profile: "another-profile" });
  assertEqual(seenOther.profile.length, 0, "a different profile does not see the profile row");

  store.write(db);
  assertEqual(store.read().entries.length, 3, "all three rows survive a write/read round-trip");
});

/* --------------------------------- 2. memo_list is the session tier only now */

test("memo_list returns the session tier only; memo_list_shared the profile tier only", async () => {
  reset();
  const db = store.read();
  store.addEntry(db, { scope: "session", sessionId: "sess-A", profile: "profile-test", title: "给A", body: "" });
  const doneRow = store.addEntry(db, { scope: "session", sessionId: "sess-A", profile: "profile-test", title: "已完成", body: "" });
  store.updateEntry(db, { id: doneRow.id, done: true });
  store.addEntry(db, { scope: "session", sessionId: "sess-B", profile: "profile-test", title: "给B", body: "" });
  store.addEntry(db, { scope: "profile", profile: "profile-test", title: "共享", body: "" });
  store.addEntry(db, { scope: "user", profile: "profile-test", title: "私藏", body: "" });
  store.write(db);

  const tools = registerTools();
  const memoList = tools.get("memo_list");
  const memoListShared = tools.get("memo_list_shared");
  assert(memoList !== undefined, "memo_list is registered");
  assert(memoListShared !== undefined, "memo_list_shared is registered");

  const fromA = await memoList.execute({}, { agent: { id: "sess-A" } });
  assertEqual(fromA.ok, true, "memo_list answers ok");
  assertEqual(fromA.count, 1, "A gets only its own non-done session row");
  assert(fromA.memos.every((row) => row.scope === "session"), "memo_list returns the session tier only");
  assert(fromA.memos.every((row) => row.title !== "共享"), "no profile row leaks into memo_list");
  assert(fromA.memos.every((row) => row.title !== "私藏"), "no user row leaks into memo_list");
  assert(fromA.memos.every((row) => row.done !== true), "completed rows are filtered out");

  const fromB = await memoList.execute({}, { agent: { id: "sess-B" } });
  assertEqual(fromB.count, 1, "session B sees only its own session row");
  assertEqual(fromB.memos[0].title, "给B", "and it is B's own row");

  const sharedFromA = await memoListShared.execute({}, { agent: { id: "sess-A" } });
  assertEqual(sharedFromA.ok, true, "memo_list_shared answers ok");
  assertEqual(sharedFromA.count, 1, "the shared tier holds exactly the profile row");
  assert(sharedFromA.memos.every((row) => row.scope === "profile"), "memo_list_shared returns the profile tier only");
  assertEqual(sharedFromA.memos[0].title, "共享", "and it is the profile row");

  const sharedFromB = await memoListShared.execute({}, { agent: { id: "sess-B" } });
  assertEqual(sharedFromB.count, 1, "another session of the same profile sees the same shared row");

  const noSession = await memoList.execute({}, {});
  assertEqual(noSession.ok, false, "a tool call with no session is refused");
});

/* ---------------------------- 3. the two edit tools cannot cross a boundary */

test("memo_edit stays in the session tier; memo_edit refuses user and cross-session", async () => {
  reset();
  const db = store.read();
  const userRow = store.addEntry(db, { scope: "user", profile: "profile-test", title: "私藏", body: "不能改", createdBy: "user" });
  const sessionA = store.addEntry(db, { scope: "session", sessionId: "sess-A", profile: "profile-test", title: "A的", body: "" });
  const profileRow = store.addEntry(db, { scope: "profile", profile: "profile-test", title: "共享", body: "" });
  store.write(db);

  const tools = registerTools();
  const memoEdit = tools.get("memo_edit");
  assert(memoEdit !== undefined, "memo_edit is registered");

  const editUser = await memoEdit.execute({ op: "update", id: userRow.id, title: "黑客" }, { agent: { id: "sess-B" } });
  assertEqual(editUser.ok, false, "a user entry cannot be updated by an agent");

  const deleteUser = await memoEdit.execute({ op: "delete", id: userRow.id }, { agent: { id: "sess-B" } });
  assertEqual(deleteUser.ok, false, "a user entry cannot be deleted by an agent");

  const editCross = await memoEdit.execute({ op: "update", id: sessionA.id, title: "越权" }, { agent: { id: "sess-B" } });
  assertEqual(editCross.ok, false, "session B cannot edit session A's row");

  const editShared = await memoEdit.execute({ op: "update", id: profileRow.id, title: "越权" }, { agent: { id: "sess-A" } });
  assertEqual(editShared.ok, false, "memo_edit cannot reach into the shared tier (that is memo_edit_shared)");

  const unchanged = store.read();
  assertEqual(unchanged.entries.find((row) => row.id === userRow.id)?.title, "私藏", "the user row is untouched");
  assertEqual(unchanged.entries.find((row) => row.id === sessionA.id)?.title, "A的", "session A's row is untouched");
  assertEqual(unchanged.entries.find((row) => row.id === profileRow.id)?.title, "共享", "the shared row is untouched");

  const ownSession = await memoEdit.execute({ op: "update", id: sessionA.id, title: "A改" }, { agent: { id: "sess-A" } });
  assertEqual(ownSession.ok, true, "session A may edit its own row");
  assertEqual(ownSession.memo.title, "A改", "and the edit lands");

  const ownDone = await memoEdit.execute({ op: "update", id: sessionA.id, done: true }, { agent: { id: "sess-A" } });
  assertEqual(ownDone.ok, true, "update can tick done");
  assertEqual(ownDone.memo.done, true, "the done flag lands");
  const undone = await memoEdit.execute({ op: "update", id: sessionA.id, done: false }, { agent: { id: "sess-A" } });
  assertEqual(undone.memo.done, false, "update can un-tick done too");

  const badOp = await memoEdit.execute({ op: "explode" }, { agent: { id: "sess-A" } });
  assertEqual(badOp.ok, false, "an unknown op is refused");
});

/* --------------------------------------------------------- 4. limits clamp */

test("LIMITS truncate an over-long title and body", () => {
  reset();
  assertEqual(store.LIMITS.title, 120, "title limit is 120");
  assertEqual(store.LIMITS.body, 4000, "body limit is 4000");
  assertEqual(store.LIMITS.entries, 500, "entry limit is 500");

  const db = store.read();
  const row = store.addEntry(db, {
    scope: "user",
    profile: "profile-test",
    title: "x".repeat(300),
    body: "y".repeat(5000),
    createdBy: "user",
  });
  assertEqual(row.title.length, store.LIMITS.title, "the title is cut to the limit on add");
  assertEqual(row.body.length, store.LIMITS.body, "the body is cut to the limit on add");

  store.write(db);
  const reread = store.read();
  assertEqual(reread.entries[0].title.length, 120, "the title is still 120 after a disk round-trip");
  assertEqual(reread.entries[0].body.length, 4000, "the body is still 4000 after a disk round-trip");
});

/* --------------------------------------------------- 5. the route needs the marker */

test("the route refuses a request without the marker header", async () => {
  reset();
  const stateRes = host.serveState(new Request("http://local/better-memo/state?sessionId=sess-A"));
  assertEqual(stateRes.status, 403, "state without the marker is 403");
  const stateBody = await stateRes.json();
  assertEqual(stateBody.ok, false, "the refusal is not ok");
  assertEqual(stateBody.reason, "no-marker", "the reason is no-marker");

  const writeRes = host.serveWrite(new Request("http://local/better-memo/write?op=delete&id=x"));
  assertEqual(writeRes.status, 403, "write without the marker is 403");
  assertEqual((await writeRes.json()).reason, "no-marker", "write reports no-marker too");
});

/* -------------------------------------- 6. a write returns the fresh state */

test("a write returns the fresh state the panel can swap in", async () => {
  reset();
  const marker = { headers: { "x-better-memo": "1" } };

  const addRes = host.serveWrite(
    new Request(
      "http://local/better-memo/write?op=add&scope=session&sessionId=sess-A&title=" +
        encodeURIComponent("记一条") +
        "&body=" +
        encodeURIComponent("正文"),
      marker,
    ),
  );
  assertEqual(addRes.status, 200, "a marked write answers 200");
  const added = await addRes.json();
  assertEqual(added.ok, true, "the write reports ok");
  assertEqual(added.session.length, 1, "the returned state already holds the new session row");
  assertEqual(added.session[0].title, "记一条", "with the title we sent");
  assertEqual(added.limits.title, 120, "the payload carries the limits for the UI");

  const stateRes2 = host.serveState(
    new Request("http://local/better-memo/state?sessionId=sess-A", marker),
  );
  const state = await stateRes2.json();
  assertEqual(state.session.length, 1, "state reads back the stored row");

  const updated = await host
    .serveWrite(
      new Request(
        "http://local/better-memo/write?op=update&id=" +
          encodeURIComponent(added.session[0].id) +
          "&done=1&sessionId=sess-A",
        marker,
      ),
    )
    .json();
  assertEqual(updated.ok, true, "the update reports ok");
  assertEqual(updated.session[0].done, true, "the update returns the row already marked done");

  const notFound = host.serveRequest(new Request("http://local/better-memo/nope", marker));
  assertEqual(notFound.status, 404, "an unknown path under the prefix is 404");
});

/* ---------------------------------- 7. the five tools, and the soft approval */

test("five tools register; memo_read_private needs the approval service", () => {
  reset();
  const withSeam = registerTools({ approval: fakeApproval("allowed-once") });
  assertEqual(withSeam.size, 5, "all five tools register when the approval seam exists");
  assertEqual(withSeam.has(host.TOOL_NAMES.listSession), true, "memo_list is there");
  assertEqual(withSeam.has(host.TOOL_NAMES.listShared), true, "memo_list_shared is there");
  assertEqual(withSeam.has(host.TOOL_NAMES.editSession), true, "memo_edit is there");
  assertEqual(withSeam.has(host.TOOL_NAMES.editShared), true, "memo_edit_shared is there");
  assertEqual(withSeam.has(host.TOOL_NAMES.readPrivate), true, "memo_read_private is there");

  const noSeam = registerTools();
  assertEqual(noSeam.size, 4, "without an approval seam the four tier tools still register");
  assertEqual(noSeam.has(host.TOOL_NAMES.readPrivate), false, "and memo_read_private is not registered at all");

  const editParams = withSeam.get(host.TOOL_NAMES.editSession).parameters;
  assertEqual(editParams.properties.scope, undefined, "memo_edit does not expose a scope field");
  assertEqual(withSeam.get(host.TOOL_NAMES.editShared).parameters.properties.scope, undefined, "neither does memo_edit_shared");
  assertEqual(withSeam.get(host.TOOL_NAMES.editSession).when, undefined, "memo_edit is unconditional");
  assertEqual(withSeam.get(host.TOOL_NAMES.editShared).when, undefined, "memo_edit_shared is unconditional");
  assertEqual(typeof withSeam.get(host.TOOL_NAMES.listSession).when, "function", "memo_list is conditional");
  assertEqual(typeof withSeam.get(host.TOOL_NAMES.listShared).when, "function", "memo_list_shared is conditional");
  assertEqual(typeof withSeam.get(host.TOOL_NAMES.readPrivate).when, "function", "memo_read_private is conditional");
});

/* ------------------------------- 8. the when conditions follow the store */

test("an empty store hides both read tools; a session row reveals memo_list", async () => {
  reset();
  const tools = registerTools({ approval: fakeApproval("allowed-once") });
  assertEqual(enabled(tools, "memo_list", { id: "sess-A" }), false, "empty store: memo_list is not exposed");
  assertEqual(enabled(tools, "memo_list_shared", { id: "sess-A" }), false, "empty store: memo_list_shared is not exposed");
  assertEqual(enabled(tools, "memo_read_private", { id: "sess-A" }), false, "empty store: memo_read_private is not exposed");
  assertEqual(enabled(tools, "memo_edit", { id: "sess-A" }), true, "memo_edit stays available, or nothing could be written");
  assertEqual(enabled(tools, "memo_edit_shared", { id: "sess-A" }), true, "memo_edit_shared stays available too");

  const db = store.read();
  store.addEntry(db, { scope: "session", sessionId: "sess-A", profile: "profile-test", title: "只给A", body: "" });
  store.write(db);

  assertEqual(enabled(tools, "memo_list", { id: "sess-A" }), true, "a session row exposes memo_list to that session");
  assertEqual(enabled(tools, "memo_list", { id: "sess-B" }), false, "but not to another session");
  assertEqual(enabled(tools, "memo_list_shared", { id: "sess-A" }), false, "a session row does not expose the shared reader");

  const rows = await tools.get("memo_list").execute({}, { agent: { id: "sess-A" } });
  assertEqual(rows.count, 1, "memo_list returns the one session row");
  assertEqual(rows.memos[0].scope, "session", "and it carries the session scope");

  const sharedDb = store.read();
  store.addEntry(sharedDb, { scope: "profile", profile: "profile-test", title: "共享", body: "" });
  store.write(sharedDb);
  assertEqual(enabled(tools, "memo_list_shared", { id: "sess-B" }), true, "a profile row exposes memo_list_shared to every session");

  const sharedRows = await tools.get("memo_list_shared").execute({}, { agent: { id: "sess-B" } });
  assertEqual(sharedRows.count, 1, "memo_list_shared returns exactly the shared row");
  assertEqual(sharedRows.memos[0].scope, "profile", "with the profile scope");
});

/* -------------------------- 9. neither when nor execute may ever throw */

test("when and execute contain their own failures", async () => {
  reset();
  const tools = registerTools({ approval: fakeApproval("allowed-once") });

  // A corrupt store file: read() degrades it to an empty db, so `when` says no.
  fs.writeFileSync(FILE, "{ this is not json", "utf8");
  assertEqual(enabled(tools, "memo_list", { id: "sess-A" }), false, "a corrupt file hides memo_list instead of throwing");
  assertEqual(enabled(tools, "memo_list_shared", { id: "sess-A" }), false, "a corrupt file hides memo_list_shared instead of throwing");
  assertEqual(enabled(tools, "memo_read_private", { id: "sess-A" }), false, "a corrupt file hides memo_read_private instead of throwing");

  // A hostile agent: `agent.id` throws on access.
  const hostile = { get id() { throw new Error("boom"); } };
  assertEqual(enabled(tools, "memo_list", hostile), false, "a throwing agent id reads as 'not exposed'");

  const noAgent = await tools.get("memo_list").execute({}, {});
  assertEqual(noAgent.ok, false, "execute without an agent returns an error object, not a throw");
  const hostileExec = await tools.get("memo_edit").execute({ op: "update", id: "x" }, { agent: hostile });
  assertEqual(hostileExec.ok, false, "execute with a hostile agent returns an error object too");

  const badUpdate = await tools.get("memo_edit").execute({ op: "update", id: "nope", title: "" }, { agent: { id: "sess-A" } });
  assertEqual(badUpdate.ok, false, "an unreachable id is a refusal, not an exception");

  reset();
  const empty = await tools.get("memo_edit").execute({ op: "add", title: "" }, { agent: { id: "sess-A" } });
  assertEqual(empty.ok, false, "adding an empty memo reports the store rule as an error object");
});

/* --------------------------- 10. memo_edit_shared owns the profile tier */

test("memo_edit_shared writes scope=profile and cannot reach other tiers", async () => {
  reset();
  const db = store.read();
  const userRow = store.addEntry(db, { scope: "user", profile: "profile-test", title: "私藏", body: "不能改", createdBy: "user" });
  const sessionRow = store.addEntry(db, { scope: "session", sessionId: "sess-A", profile: "profile-test", title: "A的", body: "" });
  store.write(db);

  const editShared = registerTools().get("memo_edit_shared");
  assert(editShared !== undefined, "memo_edit_shared is registered");

  const added = await editShared.execute({ op: "add", title: "全共享", body: "每个会话都能看" }, { agent: { id: "sess-B" } });
  assertEqual(added.ok, true, "memo_edit_shared adds");
  assertEqual(added.memo.scope, "profile", "and the row's scope is profile, not session");
  assertEqual(added.memo.sessionId, "sess-B", "the source session is still recorded for provenance");

  const stored = store.read().entries.find((row) => row.id === added.memo.id);
  assertEqual(stored.scope, "profile", "the profile scope survives the disk round-trip");
  assertEqual(store.visibleTo(store.read(), { sessionId: "sess-Z", profile: "profile-test" }).profile.length, 1, "another session sees it");

  const touchUser = await editShared.execute({ op: "update", id: userRow.id, title: "黑客" }, { agent: { id: "sess-B" } });
  assertEqual(touchUser.ok, false, "memo_edit_shared cannot update a user row");
  const delUser = await editShared.execute({ op: "delete", id: userRow.id }, { agent: { id: "sess-B" } });
  assertEqual(delUser.ok, false, "memo_edit_shared cannot delete a user row");
  const touchSession = await editShared.execute({ op: "update", id: sessionRow.id, title: "越权" }, { agent: { id: "sess-B" } });
  assertEqual(touchSession.ok, false, "memo_edit_shared cannot reach a session row");

  const tick = await editShared.execute({ op: "update", id: added.memo.id, done: true }, { agent: { id: "sess-C" } });
  assertEqual(tick.ok, true, "any session of the profile may tick a shared row");
  assertEqual(tick.memo.done, true, "the done flag lands on the shared row");

  const removed = await editShared.execute({ op: "delete", id: added.memo.id }, { agent: { id: "sess-C" } });
  assertEqual(removed.ok, true, "any session of the profile may delete a shared row");
  assertEqual(store.read().entries.length, 2, "the shared row is gone, the other two remain");
});

/* ------------------------- 11. memo_edit can never write the user tier */

test("memo_edit cannot write a user row, even when the call smuggles scope=user", async () => {
  reset();
  const tools = registerTools();
  const memoEdit = tools.get("memo_edit");

  const smuggled = await memoEdit.execute(
    { op: "add", scope: "user", title: "偷写", body: "不该出现在 user 档" },
    { agent: { id: "sess-A" } },
  );
  assertEqual(smuggled.ok, true, "the add still succeeds (it is a session memo)");
  assertEqual(smuggled.memo.scope, "session", "but scope=user in the args is ignored: memo_edit is session-only");

  const db = store.read();
  assertEqual(db.entries.length, 1, "exactly one row landed");
  assertEqual(db.entries[0].scope, "session", "and it is a session row");
  assertEqual(store.visibleTo(db, { sessionId: "sess-A", profile: "profile-test" }).user.length, 0, "the user tier is still empty");

  const editShared = tools.get("memo_edit_shared");
  const smuggledShared = await editShared.execute(
    { op: "add", scope: "user", title: "也偷写" },
    { agent: { id: "sess-A" } },
  );
  assertEqual(smuggledShared.memo.scope, "profile", "memo_edit_shared ignores scope=user and writes profile");
  assertEqual(store.read().entries.filter((row) => row.scope === "user").length, 0, "still nothing in the user tier");
});

/* ------- 12. memo_read_private: allowed returns rows, refused returns nothing */

test("memo_read_private needs a fresh approval and leaks nothing when refused", async () => {
  reset();
  const db = store.read();
  store.addEntry(db, { scope: "user", profile: "profile-test", title: "私藏标题", body: "私藏正文", createdBy: "user" });
  store.addEntry(db, { scope: "user", profile: "profile-test", title: "第二封", body: "", createdBy: "user" });
  store.write(db);

  /* allowed */
  const calls = [];
  const allowedTools = registerTools({ approval: fakeApproval("allowed-once", calls) });
  const reader = allowedTools.get("memo_read_private");
  assertEqual(enabled(allowedTools, "memo_read_private", { id: "sess-A" }), true, "a user row exposes the private reader");
  const agent = { id: "sess-A" };
  const granted = await reader.execute({}, { agent, signal: new AbortController().signal });
  assertEqual(granted.ok, true, "an allowed-once outcome returns content");
  assertEqual(granted.approval, "allowed-once", "the payload says what was granted");
  assertEqual(granted.oneShot, true, "and that it was one-shot");
  assertEqual(granted.count, 2, "both user rows come back");
  assertEqual(granted.memos[0].title, "私藏标题", "with their titles");
  assertEqual(granted.memos[0].body, "私藏正文", "and bodies");
  assertEqual(typeof granted.memos[0].id, "string", "and ids");
  assert(granted.memos.every((row) => typeof row.createdAt === "number"), "and timestamps");

  assertEqual(calls.length, 1, "the approval seam was asked exactly once");
  assertEqual(calls[0].toolName, "memo_read_private", "the request names the tool");
  assertEqual(calls[0].reason, "read the user-only memos", "the request carries the reason");
  assertEqual(calls[0].agent, agent, "the request borrows the calling agent (approval needs agent.session)");
  assert(calls[0].signal !== undefined, "the request borrows the call signal");

  /* a second call asks again: no standing grant */
  const again = await reader.execute({}, { agent, signal: new AbortController().signal });
  assertEqual(again.ok, true, "the second call is allowed again");
  assertEqual(calls.length, 2, "but only because it asked a second time");

  /* denied: nothing at all comes back */
  const denied = await registerTools({ approval: fakeApproval("rejected") })
    .get("memo_read_private")
    .execute({}, { agent, signal: new AbortController().signal });
  assertEqual(denied.ok, false, "a rejection is not ok");
  assertEqual(denied.error, "user denied", "and it says so");
  assertEqual(denied.memos, undefined, "no rows on the refusal path");
  assertEqual(denied.count, undefined, "not even a count");
  const deniedText = JSON.stringify(denied);
  assert(deniedText.includes("私藏") === false, "no user title rides out on a refusal");
  assert(deniedText.includes("正文") === false, "no user body either");

  /* cancelled, unavailable, and a throwing seam all fail the same way */
  const cancelled = await registerTools({ approval: fakeApproval("cancelled") })
    .get("memo_read_private")
    .execute({}, { agent, signal: new AbortController().signal });
  assertEqual(cancelled.error, "cancelled", "a cancelled request says cancelled");
  assert(JSON.stringify(cancelled).includes("私藏") === false, "cancelled leaks nothing");

  const unavailable = await registerTools({ approval: fakeApproval("something-else") })
    .get("memo_read_private")
    .execute({}, { agent, signal: new AbortController().signal });
  assertEqual(unavailable.error, "approval unavailable", "an unknown outcome reads as unavailable");

  const throwing = await registerTools({
    approval: { async request() { throw new Error("approval.request() outside an open turn: nope"); } },
  })
    .get("memo_read_private")
    .execute({}, { agent, signal: new AbortController().signal });
  assertEqual(throwing.ok, false, "a throwing approval seam is contained");
  assertEqual(throwing.error, "approval unavailable", "and reported without the raw user data");
  assert(JSON.stringify(throwing).includes("私藏") === false, "and leaks nothing");

  /* when follows the user tier, and the store's user rows are untouched */
  reset();
  assertEqual(enabled(allowedTools, "memo_read_private", { id: "sess-A" }), false, "an empty user tier hides the private reader");
  assertEqual(store.read().entries.length, 0, "reading the private tier had no write side effect");
});

/* ------------------------------------------------------------- run + summary */

for (const item of queue) await runOne(item.name, item.fn);

console.log("");
if (failed > 0) {
  for (const failure of failures) {
    console.log(`FAILED ${failure.name}: ${failure.thrown?.stack ?? failure.thrown}`);
  }
  console.log(`FAILED — ${failed} of ${groups} groups`);
  process.exit(1);
} else {
  console.log(`PASS — ${groups} groups`);
}