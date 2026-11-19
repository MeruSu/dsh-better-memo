/**
 * Tests for dsh-better-memo — the HOST half only (`index.js` + `lib/store.js`).
 *
 * The client half is a web component that needs a live Cordis host to mount, so
 * it is not exercised here. What IS proven here is the contract the panel and the
 * two agent tools rely on:
 *
 *   - the three scopes are filed where they belong: `session` is visible only to
 *     its own session, `profile` to every session of the profile, `user` to the
 *     panel but never to an agent tool;
 *   - `memo_list` merges session+profile, drops `done`, and never returns `user`;
 *   - `memo_edit` refuses a `user` entry and a cross-session `session` entry;
 *   - `LIMITS` truncates title/body;
 *   - the routes answer 403 without the `x-better-memo` marker;
 *   - every write returns the fresh state payload the panel swaps in.
 *
 * The host wiring through `ctx.inject(['webServer'], …)` needs a live host, so the
 * route handlers are driven directly (`serveState` / `serveWrite` / `serveRequest`)
 * with real Request/Response objects, and `apply()` is driven with a fake ctx that
 * captures the registered tools — enough to prove the contract without a server.
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

/** Drive `apply()` with the fake ctx from the spec and return the registered tools. */
function registerTools() {
  const map = new Map();
  const ctx = {
    tools: { register(spec) { map.set(spec.name, spec); } },
    systemPrompt: { section() {} },
    inject() {},
    effect() {},
  };
  host.apply(ctx);
  return map;
}

/* ---------------------------------------------------- 1. the three scopes */

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

/* ----------------------------------------------------- 2. memo_list contract */

test("memo_list merges session+profile, drops done, never returns user", async () => {
  reset();
  const db = store.read();
  store.addEntry(db, { scope: "session", sessionId: "sess-A", profile: "profile-test", title: "给A", body: "" });
  const doneRow = store.addEntry(db, { scope: "session", sessionId: "sess-A", profile: "profile-test", title: "已完成", body: "" });
  store.updateEntry(db, { id: doneRow.id, done: true });
  store.addEntry(db, { scope: "profile", profile: "profile-test", title: "共享", body: "" });
  store.addEntry(db, { scope: "user", profile: "profile-test", title: "私藏", body: "" });
  store.write(db);

  const memoList = registerTools().get("memo_list");
  assert(memoList !== undefined, "memo_list is registered");

  const fromA = await memoList.execute({}, { agent: { id: "sess-A" } });
  assertEqual(fromA.ok, true, "memo_list answers ok");
  assertEqual(fromA.count, 2, "A gets its own session row + the profile row, done and user excluded");
  assert(fromA.memos.every((row) => row.scope === "session" || row.scope === "profile"), "no user scope leaks out");
  assert(fromA.memos.every((row) => row.done !== true), "completed rows are filtered out");
  assert(fromA.memos.every((row) => row.title !== "私藏"), "the user row never reaches the agent");

  const fromB = await memoList.execute({}, { agent: { id: "sess-B" } });
  assertEqual(fromB.count, 1, "session B only gets the profile row");
  assertEqual(fromB.memos[0].title, "共享", "and it is the profile row");

  const noSession = await memoList.execute({}, {});
  assertEqual(noSession.ok, false, "a tool call with no session is refused");
});

/* ------------------------------------- 3. memo_edit must not cross a boundary */

test("memo_edit refuses a user entry and a cross-session entry", async () => {
  reset();
  const db = store.read();
  const userRow = store.addEntry(db, { scope: "user", profile: "profile-test", title: "私藏", body: "不能改", createdBy: "user" });
  const sessionA = store.addEntry(db, { scope: "session", sessionId: "sess-A", profile: "profile-test", title: "A的", body: "" });
  const profileRow = store.addEntry(db, { scope: "profile", profile: "profile-test", title: "共享", body: "" });
  store.write(db);

  const memoEdit = registerTools().get("memo_edit");
  assert(memoEdit !== undefined, "memo_edit is registered");

  const editUser = await memoEdit.execute({ op: "update", id: userRow.id, title: "黑客" }, { agent: { id: "sess-B" } });
  assertEqual(editUser.ok, false, "a user entry cannot be updated by an agent");

  const deleteUser = await memoEdit.execute({ op: "delete", id: userRow.id }, { agent: { id: "sess-B" } });
  assertEqual(deleteUser.ok, false, "a user entry cannot be deleted by an agent");

  const editCross = await memoEdit.execute({ op: "update", id: sessionA.id, title: "越权" }, { agent: { id: "sess-B" } });
  assertEqual(editCross.ok, false, "session B cannot edit session A's row");

  const unchanged = store.read();
  assertEqual(unchanged.entries.find((row) => row.id === userRow.id)?.title, "私藏", "the user row is untouched");
  assertEqual(unchanged.entries.find((row) => row.id === sessionA.id)?.title, "A的", "session A's row is untouched");

  const ownSession = await memoEdit.execute({ op: "update", id: sessionA.id, title: "A改" }, { agent: { id: "sess-A" } });
  assertEqual(ownSession.ok, true, "session A may edit its own row");
  assertEqual(ownSession.memo.title, "A改", "and the edit lands");

  const ownProfile = await memoEdit.execute({ op: "update", id: profileRow.id, done: true }, { agent: { id: "sess-A" } });
  assertEqual(ownProfile.ok, true, "the profile row is editable from any session of the profile");
  assertEqual(ownProfile.memo.done, true, "the done flag lands");

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
