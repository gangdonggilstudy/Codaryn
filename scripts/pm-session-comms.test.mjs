import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createComms, cli, PANES, normalCodexPrompt, herdrTransport } from './pm-session-comms.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(workspace, '.codaryn/session-comms');
const sha = data => createHash('sha256').update(data).digest('hex');
const subject = { base: 'a'.repeat(40), target: 'b'.repeat(40) };
const failure = code => error => error.code === code;
const pmRel = (id, suffix) => '.codaryn/pm-comms/events/' + id + '.' + suffix + '.json';
const local = id => '.codaryn/session-comms/' + id;
async function fixture(t, options = {}) {
  await fs.mkdir(scratch, { recursive: true });
  const temp = await fs.mkdtemp(path.join(scratch, 'test-'));
  t.after(async () => { assert(path.resolve(temp).startsWith(path.resolve(scratch) + path.sep)); await fs.rm(temp, { recursive: true, force: true }); });
  const pm = path.join(temp, 'project'), worker = path.join(pm, '.worktrees/check');
  await fs.mkdir(worker, { recursive: true });
  const agents = Object.fromEntries(Object.entries(PANES).map(([name, pane]) => [name, {
    agent: name === 'claude-worker' ? 'claude' : 'codex', name,
    ...(name === 'claude-worker' ? { agent_session: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: 'claude-session-one' } } : {}),
    pane_id: pane, terminal_id: 'terminal-' + name, agent_status: 'idle', cwd: pm }]));
  const calls = [], config = { getError: null, promptError: null, visibleError: null, visibleText: '› Ask Codex to do anything\n? for shortcuts', checkout: { head: 'c'.repeat(40), branch: 'ops/test' }, gitCalls: 0 };
  const transport = {
    async get(name) { calls.push(['get', name]); if (config.getError) throw config.getError; return { result: { type: 'agent_info', agent: { ...agents[name] } } }; },
    async visible(name) { calls.push(['visible', name]); if (config.visibleError) throw config.visibleError; return config.visibleText; },
    async prompt(name, text) { calls.push(['prompt', name, text]); if (config.promptError) throw config.promptError; return { result: { type: 'agent_prompt' } }; },
  };
  const dependencies = { projectRoot: pm, transport, context: { herdr: '1', pane: PANES['codex-review'] },
    git: async () => { config.gitCalls++; return { ...config.checkout }; }, ...options };
  const make = cwd => createComms({ ...dependencies, cwd });
  const api = make(pm), author = make(worker);
  const write = async (wt, rel, value) => { const file = path.join(wt, rel); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value)); };
  const read = async (wt, rel) => JSON.parse(await fs.readFile(path.join(wt, rel), 'utf8'));
  const spec = id => ({ id, worker: 'codex-worker', pane: PANES['codex-worker'], worktree: worker, subject,
    taskFile: '.codaryn/pm-tools/' + id + '.md', taskSHA: sha('DO-NOT-LOG-CONTENT'),
    report: local(id) + '/report.md', receipt: local(id) + '/ready.json' });
  async function register(id = 'job', patch = {}) {
    const job = { ...spec(id), ...patch }; await write(pm, job.taskFile, 'DO-NOT-LOG-CONTENT'); await api.register(pm, job); return job;
  }
  const dispatch = (id = 'job', settings) => api.dispatch(pm, id, settings);
  const started = (id = 'job') => author.worker('STARTED', pm, worker, id, 'codex-worker');
  const ready = (id = 'job', text = '# Report\n') => author.worker('READY', pm, worker, id, 'codex-worker', text);
  async function completed() { await register(); await dispatch(); await started(); return ready(); }
  return { pm, worker, api, author, make, agents, config, calls, spec, write, read, register, dispatch, started, ready, completed };
}

const historicalWorkers = { 'codex-check': 'w3:pD', 'codex-loop': 'w3:p8', 'codex-sec': 'w3:pC',
  'codex-audit': 'w3:pE', 'codex-probe': 'w3:pF' };
// External v1 record fixture: deliberately never register historical jobs with the new API.
async function historicalRecord(f, name, { id = 'archived-job', closed = true, cwd = true } = {}) {
  const job = { version: 1, id, pm: f.pm, worker: name,
    identity: { name, pane: historicalWorkers[name], terminal: 'old-terminal', sessionSHA: null, ...(cwd ? { cwd: f.pm } : {}) },
    worktree: f.worker, subject, checkout: { ...f.config.checkout },
    report: local(id) + '/report.md', receipt: local(id) + '/ready.json',
    taskFile: '.codaryn/pm-tools/' + id + '.md', taskSHA: sha('historical task') };
  const sorted = value => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  const stamp = { version: 1, id, registrationSHA: sha(JSON.stringify(sorted(job), null, 2) + '\n'),
    worker: name, identity: job.identity, worktree: f.worker, subject, checkout: job.checkout, report: job.report, receipt: job.receipt };
  const reportSHA = sha('historical report');
  const ready = { ...stamp, state: 'READY', reportSHA };
  const records = [[`.codaryn/pm-comms/registry/${id}.json`, job]];
  if (closed) records.push([`.codaryn/pm-comms/inbox/${id}.started.json`, { ...stamp, state: 'STARTED' }],
    [`.codaryn/pm-comms/inbox/${id}.${reportSHA}.ready.json`, ready],
    [`.codaryn/pm-comms/ack/${id}.${reportSHA}.json`, { ...ready, state: 'ACK' }]);
  const snapshots = [];
  for (const [relative, record] of records) {
    await f.write(f.pm, relative, record);
    snapshots.push([relative, await fs.readFile(path.join(f.pm, relative))]);
  }
  return { id, reportSHA, snapshots };
}

for (const [worker, pane, kind] of [['codex-worker', 'w3:pJ', 'codex'], ['claude-worker', 'w3:pH', 'claude'], ['codex-worker-2', 'w3:pK', 'codex']]) {
  test('current worker ' + worker + ' completes file-only STARTED/READY/ACK with its expected agent kind', async t => {
    const f = await fixture(t); assert.equal(f.agents[worker].agent, kind);
    await f.register('job', { worker, pane }); await f.dispatch();
    await f.author.worker('STARTED', f.pm, f.worker, 'job', worker);
    const ready = await f.author.worker('READY', f.pm, f.worker, 'job', worker, '# Current worker\n');
    const row = (await f.api.poll(f.pm))[0];
    assert.equal(row.state, 'READY'); assert.equal(row.acceptanceReady, true);
    assert.equal(row.sessionBound, worker === 'claude-worker');
    assert.equal((await f.read(f.pm, '.codaryn/pm-comms/registry/job.json')).identity.pane, pane);
    assert.equal((await f.api.ack(f.pm, 'job', ready.reportSHA, true)).state, 'ACK');
    assert.equal((await f.api.poll(f.pm))[0].closed, true);
    assert.equal(f.calls.filter(call => call[0] === 'prompt').length, 0);
  });
  for (const field of ['agent', 'pane_id']) test('current worker ' + worker + ' rejects wrong ' + field + ' at registration and dispatch', async t => {
    const f = await fixture(t), wrong = field === 'agent' ? (kind === 'codex' ? 'claude' : 'codex') : 'w3:p9';
    const original = f.agents[worker][field]; f.agents[worker][field] = wrong;
    await assert.rejects(f.register('job', { worker, pane }), failure('IDENTITY_MISMATCH'));
    f.agents[worker][field] = original; await f.register('job', { worker, pane });
    f.agents[worker][field] = wrong;
    await assert.rejects(f.dispatch('job', { send: true }), failure('IDENTITY_MISMATCH'));
    assert.equal((await f.api.poll(f.pm))[0].error, 'IDENTITY_MISMATCH');
    assert.equal(f.calls.filter(call => call[0] === 'prompt').length, 0);
  });
}

test('Claude session identity is pinned and a changed or missing session cannot be accepted', async t => {
  const f = await fixture(t); await f.register('job', { worker: 'claude-worker', pane: 'w3:pH' });
  await f.dispatch(); await f.author.worker('STARTED', f.pm, f.worker, 'job', 'claude-worker');
  const ready = await f.author.worker('READY', f.pm, f.worker, 'job', 'claude-worker', '# Claude\n');
  assert.equal((await f.api.poll(f.pm))[0].sessionBound, true);
  f.agents['claude-worker'].agent_session.value = 'claude-session-two';
  assert.equal((await f.api.poll(f.pm))[0].error, 'IDENTITY_MISMATCH');
  await assert.rejects(f.api.ack(f.pm, 'job', ready.reportSHA, true), failure('IDENTITY_MISMATCH'));
  delete f.agents['claude-worker'].agent_session;
  await assert.rejects(f.dispatch(), failure('IDENTITY_MISMATCH'));
  assert.equal((await f.api.poll(f.pm))[0].error, 'IDENTITY_MISMATCH');
});

test('Claude --send is refused even when its visible screen quotes a normal Codex footer', async t => {
  const f = await fixture(t); await f.register('job', { worker: 'claude-worker', pane: 'w3:pH' });
  for (const visible of ['> Ask Claude', '› Ask Codex to do anything\n? for shortcuts']) {
    f.config.visibleText = visible;
    assert.deepEqual(await f.dispatch('job', { send: true }), { id: 'job', state: 'ASSIGNED', delivery: 'queued', error: 'VISIBLE_UNCONFIRMED' });
  }
  assert.equal(f.calls.filter(call => call[0] === 'prompt' || call[0] === 'visible').length, 0);
  await assert.rejects(fs.stat(path.join(f.pm, pmRel('job', 'dispatch.claim'))), error => error.code === 'ENOENT');
  await f.author.worker('STARTED', f.pm, f.worker, 'job', 'claude-worker');
  await f.author.worker('READY', f.pm, f.worker, 'job', 'claude-worker', '# File-only still works\n');
  assert.equal((await f.api.poll(f.pm))[0].state, 'READY');
});

for (const [worker, pane] of [...Object.entries(historicalWorkers), ['codex-review', 'w3:p3']]) {
  test('historical worker or PM ' + worker + ' cannot register a new job', async t => {
    const f = await fixture(t);
    await assert.rejects(f.register('job', { worker, pane }), failure('WORKER_NOT_ALLOWED'));
    assert.equal(f.calls.length, 0);
    await assert.rejects(fs.stat(path.join(f.pm, '.codaryn/pm-comms/registry/job.json')), error => error.code === 'ENOENT');
  });
}

for (const worker of Object.keys(historicalWorkers)) for (const cwd of [true, false]) {
  test('historical closed ' + worker + ' with cwd=' + cwd + ' stays ACK without live queries or record writes', async t => {
    const f = await fixture(t), old = await historicalRecord(f, worker, { cwd });
    f.config.getError = Object.assign(new Error('old session absent'), { code: 'ENOENT' });
    f.config.checkout.head = 'e'.repeat(40);
    assert.deepEqual(await f.api.poll(f.pm, { notify: true }), [{ id: old.id, state: 'ACK', closed: true, reportSHA: old.reportSHA }]);
    assert.equal((await f.api.ack(f.pm, old.id, old.reportSHA, true)).closed, true);
    for (const [relative, original] of old.snapshots) assert.deepEqual(await fs.readFile(path.join(f.pm, relative)), original);
    assert.equal(f.calls.length, 0); assert.equal(f.config.gitCalls, 0);
  });
}

for (const part of ['registry', 'inbox', 'ack']) test('historical closed records still reject corrupt ' + part, async t => {
  const f = await fixture(t), old = await historicalRecord(f, 'codex-loop');
  const relative = old.snapshots.find(([name]) => name.includes('/' + part + '/') && !name.endsWith('.started.json'))[0];
  const record = await f.read(f.pm, relative);
  if (part === 'registry') record.identity.pane = 'w3:pJ'; else record.subject = { base: null, target: null };
  await f.write(f.pm, relative, record);
  assert.equal((await f.api.poll(f.pm))[0].state, 'REJECTED');
  await assert.rejects(f.api.ack(f.pm, old.id, old.reportSHA, true));
  assert.equal(f.calls.length, 0);
});

test('abandoned historical comm-live-loop-01 preserves CHECKOUT_MISMATCH before legacy rejection', async t => {
  const f = await fixture(t); await historicalRecord(f, 'codex-loop', { id: 'comm-live-loop-01', closed: false });
  f.config.checkout.head = 'e'.repeat(40);
  assert.deepEqual(await f.api.poll(f.pm), [{ id: 'comm-live-loop-01', state: 'REJECTED', error: 'CHECKOUT_MISMATCH' }]);
  assert.equal(f.calls.length, 0);
});

for (const location of ['outside', 'missing', 'linked']) test('L1 regression: historical ' + location + ' worktree is rejected before any Git query', async t => {
  const f = await fixture(t), old = await historicalRecord(f, 'codex-loop', { closed: false });
  const relative = `.codaryn/pm-comms/registry/${old.id}.json`, job = await f.read(f.pm, relative);
  job.worktree = location === 'outside' ? path.dirname(f.pm) : path.join(f.pm, '.worktrees', location);
  if (location === 'linked') await fs.symlink(f.worker, job.worktree, process.platform === 'win32' ? 'junction' : 'dir');
  await f.write(f.pm, relative, job);
  const code = location === 'outside' ? 'WORKTREE_SCOPE' : location === 'missing' ? 'ENOENT' : 'WORKTREE_LINK';
  assert.deepEqual(await f.api.poll(f.pm), [{ id: old.id, state: 'REJECTED', error: code }]);
  await assert.rejects(f.dispatch(old.id, { send: true }), failure(code));
  for (const state of ['STARTED', 'READY']) await assert.rejects(
    f.author.worker(state, f.pm, f.worker, old.id, 'codex-loop', '# Rejected path\n'), failure(code));
  await assert.rejects(f.api.ack(f.pm, old.id, old.reportSHA, true), failure(code));
  assert.equal(f.config.gitCalls, 0); assert.equal(f.calls.length, 0);
});

for (const [worker, pane] of [['claude-worker', 'w3:pJ'], ['codex-worker', 'w3:pH'],
  ['codex-worker-2', 'w3:pJ'], ['codex-worker-2', 'w3:pH'], ['codex-worker', 'w3:pK']]) {
  test('I4 regression: ' + worker + ' cannot register with the other current worker pane ' + pane, async t => {
    const f = await fixture(t);
    await assert.rejects(f.register('job', { worker, pane }), failure('WORKER_NOT_ALLOWED'));
    assert.equal(f.calls.length, 0); assert.equal(f.config.gitCalls, 0);
    await assert.rejects(fs.stat(path.join(f.pm, '.codaryn/pm-comms/registry/job.json')), error => error.code === 'ENOENT');
  });
}

for (const screen of ['› Ask Codex to do anything\n? for shortcuts', '› Ask\n Codex to do anything\n? for shortcuts']) {
  test('codex-worker-2 dispatch and full lifecycle accept the normal Codex footer ' + JSON.stringify(screen), async t => {
    const f = await fixture(t);
    f.agents['codex-worker-2'].agent_session = { agent: 'codex', kind: 'id', source: 'herdr:codex', value: 'new-worker-session-one' };
    f.config.visibleText = screen;
    await f.register('job', { worker: 'codex-worker-2', pane: 'w3:pK' });
    const job = await f.read(f.pm, '.codaryn/pm-comms/registry/job.json');
    assert.deepEqual([job.identity.name, job.identity.pane, job.identity.terminal, job.identity.cwd],
      ['codex-worker-2', 'w3:pK', 'terminal-codex-worker-2', await fs.realpath(f.pm)]);
    assert.match(job.identity.sessionSHA, /^[a-f0-9]{64}$/);
    assert.equal((await f.dispatch('job', { send: true })).delivery, 'accepted');
    assert(f.calls.some(call => call[0] === 'visible' && call[1] === 'codex-worker-2'));
    assert.deepEqual(f.calls.filter(call => call[0] === 'prompt').map(call => call[1]), ['codex-worker-2']);
    await f.author.worker('STARTED', f.pm, f.worker, 'job', 'codex-worker-2');
    const ready = await f.author.worker('READY', f.pm, f.worker, 'job', 'codex-worker-2', '# New Codex worker\n');
    const row = (await f.api.poll(f.pm))[0];
    assert.equal(row.state, 'READY'); assert.equal(row.acceptanceReady, true); assert.equal(row.sessionBound, true);
    assert.equal((await f.api.ack(f.pm, 'job', ready.reportSHA, true)).state, 'ACK');
    assert.equal((await f.api.poll(f.pm))[0].closed, true);
  });
}

for (const mode of ['unknown-dialog', 'approval-ui', 'quota-ui', 'read-failure']) {
  test('codex-worker-2 refuses dispatch on ' + mode + ' without a send claim or prompt', async t => {
    const f = await fixture(t); await f.register('job', { worker: 'codex-worker-2', pane: 'w3:pK' });
    if (mode === 'read-failure') f.config.visibleError = Object.assign(new Error('not logged'), { code: 'EACCES' });
    else f.config.visibleText = mode === 'approval-ui' ? '› Ask Codex to do anything\n  1. Allow once\n  2. No'
      : mode === 'quota-ui' ? '› Ask Codex to do anything\nUsage limit reached' : 'Unrecognized dialog\nContinue?';
    assert.deepEqual(await f.dispatch('job', { send: true }), { id: 'job', state: 'ASSIGNED', delivery: 'queued', error: 'VISIBLE_UNCONFIRMED' });
    assert.equal(f.calls.filter(call => call[0] === 'prompt').length, 0);
    await assert.rejects(fs.stat(path.join(f.pm, pmRel('job', 'dispatch.claim'))), error => error.code === 'ENOENT');
  });
}

for (const field of ['name', 'terminal_id', 'cwd', 'changed-session', 'missing-session']) {
  test('codex-worker-2 pins ' + field + ' through READY and refuses changed identity at ACK', async t => {
    const f = await fixture(t), agent = f.agents['codex-worker-2'];
    agent.agent_session = { agent: 'codex', kind: 'id', source: 'herdr:codex', value: 'new-worker-session-one' };
    await f.register('job', { worker: 'codex-worker-2', pane: 'w3:pK' }); await f.dispatch();
    await f.author.worker('STARTED', f.pm, f.worker, 'job', 'codex-worker-2');
    const ready = await f.author.worker('READY', f.pm, f.worker, 'job', 'codex-worker-2', '# Pinned identity\n');
    assert.equal((await f.api.poll(f.pm))[0].acceptanceReady, true);
    if (field === 'name') agent.name = 'codex-worker';
    else if (field === 'terminal_id') agent.terminal_id = 'different-terminal';
    else if (field === 'cwd') agent.cwd = f.worker;
    else if (field === 'changed-session') agent.agent_session.value = 'new-worker-session-two';
    else delete agent.agent_session;
    const code = field === 'cwd' ? 'IDENTITY_CWD_MISMATCH' : 'IDENTITY_MISMATCH';
    await assert.rejects(f.dispatch('job', { send: true }), failure(code));
    const row = (await f.api.poll(f.pm))[0];
    assert.equal(row.state, 'REJECTED'); assert.equal(row.error, code);
    await assert.rejects(f.api.ack(f.pm, 'job', ready.reportSHA, true), failure(code));
    assert.equal(f.calls.filter(call => call[0] === 'prompt').length, 0);
    await assert.rejects(fs.stat(path.join(f.pm, '.codaryn/pm-comms/ack/job.' + ready.reportSHA + '.json')), error => error.code === 'ENOENT');
  });
}

test('unclosed historical jobs cannot dispatch, STARTED, READY or acquire a new ACK', async t => {
  const f = await fixture(t), old = await historicalRecord(f, 'codex-loop', { closed: false });
  await assert.rejects(f.dispatch(old.id), failure('WORKER_NOT_ALLOWED'));
  for (const state of ['STARTED', 'READY']) await assert.rejects(
    f.author.worker(state, f.pm, f.worker, old.id, 'codex-loop', '# No new work\n'), failure('WORKER_NOT_ALLOWED'));
  await assert.rejects(f.api.ack(f.pm, old.id, old.reportSHA, true), failure('WORKER_NOT_ALLOWED'));
  assert.deepEqual(await f.api.poll(f.pm), [{ id: old.id, state: 'REJECTED', error: 'WORKER_NOT_ALLOWED' }]);
  assert.equal(f.calls.length, 0);
  await assert.rejects(fs.stat(path.join(f.pm, pmRel(old.id, 'assignment'))), error => error.code === 'ENOENT');
  await assert.rejects(fs.stat(path.join(f.worker, local(old.id))), error => error.code === 'ENOENT');
});

test('files-first assignment, STARTED, READY, collection and explicit read ACK are separate', async t => {
  const f = await fixture(t); await f.register();
  assert.deepEqual(await f.api.poll(f.pm), [{ id: 'job', state: 'REGISTERED' }]);
  assert.equal((await f.dispatch()).state, 'ASSIGNED');
  assert.equal((await f.api.poll(f.pm))[0].state, 'ASSIGNED');
  await f.started(); assert.equal((await f.api.poll(f.pm))[0].state, 'STARTED');
  const result = await f.ready(); const row = (await f.api.poll(f.pm))[0];
  assert.equal(row.state, 'READY'); assert.equal(row.reportSHA, result.reportSHA);
  await assert.rejects(f.api.ack(f.pm, 'job', row.reportSHA, false), failure('EXPLICIT_READ_REQUIRED'));
  assert.equal((await f.api.ack(f.pm, 'job', row.reportSHA, true)).state, 'ACK');
  assert.equal((await f.api.poll(f.pm))[0].state, 'ACK');
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
});

test('worker file receipts succeed with Herdr PermissionDenied; PM later recovers them', async t => {
  const f = await fixture(t); await f.register(); await f.dispatch();
  f.config.getError = Object.assign(new Error('not logged'), { code: 'EACCES' });
  await f.started(); const result = await f.ready();
  const collected = (await f.api.poll(f.pm, { notify: true }))[0];
  assert.equal(collected.state, 'READY'); assert.equal(collected.identityVerified, false);
  assert.equal((await f.read(f.pm, '.codaryn/pm-comms/inbox/job.' + result.reportSHA + '.ready.json')).state, 'READY');
  await assert.rejects(f.api.ack(f.pm, 'job', result.reportSHA, true), failure('ACK_NOT_READY'));
  f.config.getError = null; assert.equal((await f.api.ack(f.pm, 'job', result.reportSHA, true)).state, 'ACK');
});

for (const state of ['working', 'blocked', 'unknown', 'quota']) test('PM ' + state + ' keeps READY queued and sends no answer', async t => {
  const f = await fixture(t); await f.completed(); f.agents['codex-review'].agent_status = state;
  const row = (await f.api.poll(f.pm, { notify: true }))[0];
  assert.equal(row.state, 'READY'); assert.equal(row.notification, 'queued');
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
});

for (const state of ['idle', 'done']) test('PM ' + state + ' receives only metadata, deduplicated by job and report SHA', async t => {
  const f = await fixture(t); await f.completed(); f.agents['codex-review'].agent_status = state;
  for (let i = 0; i < 3; i++) assert.equal((await f.api.poll(f.pm, { notify: true }))[0].notification, 'accepted');
  const sent = f.calls.filter(x => x[0] === 'prompt'); assert.equal(sent.length, 1);
  assert.equal(sent[0][1], 'codex-review'); assert(!sent[0][2].includes('# Report')); assert(!sent[0][2].includes('DO-NOT-LOG-CONTENT'));
  assert.equal((await f.api.poll(f.pm))[0].state, 'READY');
});

test('notify PermissionDenied and ambiguous timeout retain collected data, never blindly resend', async t => {
  for (const code of ['EACCES', 'ETIMEDOUT']) {
    const f = await fixture(t); await f.completed(); f.config.promptError = Object.assign(new Error('DO-NOT-LOG-CONTENT'), { code });
    assert.equal((await f.api.poll(f.pm, { notify: true }))[0].notification, 'unknown');
    f.config.promptError = null;
    assert.equal((await f.make(f.pm).poll(f.pm, { notify: true }))[0].notification, 'unknown');
    assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 1);
    const event = await f.read(f.pm, pmRel('job', 'notify.' + sha('# Report\n') + '.error'));
    assert(!JSON.stringify(event).includes('DO-NOT-LOG-CONTENT')); assert.equal(event.error, code);
  }
});

test('dispatch admission is not STARTED; timeout claim survives restart with no resubmission', async t => {
  const f = await fixture(t); await f.register(); f.config.promptError = Object.assign(new Error('not recorded'), { code: 'ETIMEDOUT' });
  assert.equal((await f.dispatch('job', { send: true })).delivery, 'unknown');
  f.config.promptError = null;
  assert.equal((await f.make(f.pm).dispatch(f.pm, 'job', { send: true })).delivery, 'unknown');
  assert.equal((await f.api.poll(f.pm))[0].state, 'ASSIGNED');
  await f.started(); assert.equal((await f.api.poll(f.pm))[0].state, 'STARTED');
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 1);
});

test('successful dispatch means accepted only and a blocked worker is never prompted', async t => {
  const f = await fixture(t); await f.register(); f.agents['codex-worker'].agent_status = 'blocked';
  assert.equal((await f.dispatch('job', { send: true })).delivery, 'queued');
  f.agents['codex-worker'].agent_status = 'idle';
  assert.equal((await f.dispatch('job', { send: true })).delivery, 'accepted');
  assert.equal((await f.api.poll(f.pm))[0].state, 'ASSIGNED');
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 1);
});

test('unacknowledged READY is rediscovered after a fresh controller instance', async t => {
  const f = await fixture(t); const ready = await f.completed();
  await f.api.poll(f.pm); const restarted = f.make(f.pm);
  assert.equal((await restarted.poll(f.pm))[0].reportSHA, ready.reportSHA);
  await restarted.ack(f.pm, 'job', ready.reportSHA, true);
  assert.equal((await f.make(f.pm).poll(f.pm))[0].state, 'ACK');
});

test('concurrent collectors have one claim and no duplicated notifications or overwritten inbox', async t => {
  const f = await fixture(t); await f.completed();
  const results = await Promise.allSettled([f.api.poll(f.pm, { notify: true }), f.make(f.pm).poll(f.pm, { notify: true })]);
  assert(results.some(x => x.status === 'fulfilled'));
  assert(results.every(x => x.status === 'fulfilled'));
  assert(results.every(x => x.value[0].state === 'READY'));
  await f.api.poll(f.pm, { notify: true }); assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 1);
  const inbox = await fs.readdir(path.join(f.pm, '.codaryn/pm-comms/inbox'));
  assert.equal(inbox.filter(name => name.endsWith('.ready.json')).length, 1);
});

test('checkout is optional; non-Git operational job never queries Git', async t => {
  const f = await fixture(t); await f.completed(); await f.api.poll(f.pm); assert.equal(f.config.gitCalls, 0);
});

test('independent verifier detached checkout differs from base/target subject and is preserved in receipts', async t => {
  const f = await fixture(t); f.config.checkout = { head: '4cf605a2' + '0'.repeat(32), branch: null };
  await f.register('job', { checkout: { ...f.config.checkout }, subject: { base: 'a'.repeat(40), target: '2f5c' + '0'.repeat(36) } });
  await f.dispatch(); await f.started(); await f.ready();
  const receipt = await f.read(f.worker, local('job') + '/ready.json');
  assert.notEqual(receipt.checkout.head, receipt.subject.target); assert.equal(receipt.checkout.branch, null);
  assert.equal((await f.api.poll(f.pm))[0].state, 'READY');
});

test('explicit checkout HEAD or branch mismatch is rejected independently of subject', async t => {
  const f = await fixture(t); await f.register('job', { checkout: { ...f.config.checkout } }); await f.dispatch();
  f.config.checkout.branch = 'wrong'; await assert.rejects(f.started(), failure('CHECKOUT_MISMATCH'));
  f.config.checkout.branch = 'ops/test'; f.config.checkout.head = 'd'.repeat(40);
  await assert.rejects(f.started(), failure('CHECKOUT_MISMATCH'));
});

for (const field of ['id', 'subject', 'checkout', 'identity']) test('stale or wrong receipt ' + field + ' is rejected', async t => {
  const f = await fixture(t); await f.completed();
  const rel = local('job') + '/ready.json', receipt = await f.read(f.worker, rel);
  receipt[field] = field === 'id' ? 'wrong' : { wrong: true }; await f.write(f.worker, rel, receipt);
  assert.equal((await f.api.poll(f.pm))[0].error, 'RECEIPT_MISMATCH');
});

test('report tampering or stale task digest cannot be collected or ACKed', async t => {
  const f = await fixture(t); const ready = await f.completed();
  await f.write(f.worker, local('job') + '/report.md', 'changed');
  assert.equal((await f.api.poll(f.pm))[0].error, 'REPORT_HASH_MISMATCH');
  await assert.rejects(f.api.ack(f.pm, 'job', ready.reportSHA, true), failure('REPORT_HASH_MISMATCH'));
  await f.write(f.pm, '.codaryn/pm-tools/job.md', 'changed'); assert.equal((await f.api.poll(f.pm))[0].error, 'STALE_TASK');
});

for (const [field, value] of [['pane_id', 'w3:p9'], ['agent', 'claude'], ['terminal_id', 'replacement'], ['name', 'other']]) {
  test('changed live identity ' + field + ' is rejected without messaging', async t => {
    const f = await fixture(t); await f.completed(); f.agents['codex-worker'][field] = value;
    assert.equal((await f.api.poll(f.pm, { notify: true }))[0].error, 'IDENTITY_MISMATCH');
    assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
  });
}

test('unapproved workers/panes and worktrees outside this project are refused', async t => {
  const f = await fixture(t);
  await assert.rejects(f.register('job', { worker: 'other-project', pane: 'w5:p1' }), failure('WORKER_NOT_ALLOWED'));
  await assert.rejects(f.register('job', { pane: 'w3:p9' }), failure('WORKER_NOT_ALLOWED'));
  await assert.rejects(f.register('job', { worktree: path.dirname(f.pm) }), failure('WORKTREE_SCOPE'));
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
});

test('report/receipt/task path and traversal errors are rejected without reading arbitrary files', async t => {
  const f = await fixture(t);
  for (const report of ['.codaryn/../private.md', '.codaryn/key.md', '.codaryn/session-comms/job/report.md:stream']) {
    await assert.rejects(f.register('job', { report }), failure('REGISTERED_PATH'));
  }
  await assert.rejects(f.register('job', { receipt: '.codaryn/key.json' }), failure('REGISTERED_PATH'));
  // Call register directly so the test does not create an out-of-namespace task.
  await assert.rejects(f.api.register(f.pm, { ...f.spec('job'), taskFile: '.codaryn/private.json' }), failure('TASK_PATH'));
  await assert.rejects(f.api.register(f.pm, { ...f.spec('job'), taskFile: '.codaryn/pm-tools/../private.md' }), failure('PATH_SEGMENT'));
});

test('static directory junction/symlink and hard-link report escape are refused', async t => {
  const f = await fixture(t); await f.register(); await f.dispatch(); await f.started();
  const outside = path.join(f.pm, '.codaryn/outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'report.md'), 'outside');
  const report = path.join(f.worker, local('job'), 'report.md');
  await fs.link(path.join(outside, 'report.md'), report);
  await assert.rejects(f.author.worker('READY', f.pm, f.worker, 'job', 'codex-worker'), failure('FILE_UNSAFE'));
  await fs.unlink(report);
  const directory = path.join(f.worker, '.codaryn/session-comms/linked');
  await fs.symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
  const linked = f.spec('linked'); await f.write(f.pm, linked.taskFile, 'DO-NOT-LOG-CONTENT');
  await assert.rejects(f.api.register(f.pm, linked), failure('PATH_LINK'));
  assert.equal(await fs.readFile(path.join(outside, 'report.md'), 'utf8'), 'outside');
});

test('partial writes and orphan temporary records never count as READY; repair requires complete receipt', async t => {
  const f = await fixture(t); await f.register(); await f.dispatch(); await f.started();
  await f.write(f.worker, local('job') + '/ready.json.tmp-orphan', '{');
  assert.equal((await f.api.poll(f.pm))[0].state, 'STARTED');
  await f.write(f.worker, local('job') + '/ready.json', '{');
  assert.equal((await f.api.poll(f.pm))[0].error, 'PARTIAL_JSON');
});

test('crash after report publication can resume without replacing bytes; READY is immutable', async t => {
  const f = await fixture(t); await f.register(); await f.dispatch(); await f.started();
  await f.write(f.worker, local('job') + '/report.md', '# Report\n');
  await f.ready(); await f.ready();
  await assert.rejects(f.ready('job', 'different'), failure('IMMUTABLE_CONFLICT'));
  assert.equal(await fs.readFile(path.join(f.worker, local('job'), 'report.md'), 'utf8'), '# Report\n');
});

test('a crash claim before notification result remains unknown and is not sent twice', async t => {
  const f = await fixture(t); const ready = await f.completed();
  await f.write(f.pm, pmRel('job', 'notify.' + ready.reportSHA + '.claim'), { id: 'job', reportSHA: ready.reportSHA, state: 'unknown' });
  const row = (await f.api.poll(f.pm, { notify: true }))[0];
  assert.equal(row.notification, 'unknown'); assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
});

test('obsolete dead/live/ownerless lock directories are never stolen and cannot wedge new claim-based collection', async t => {
  const f = await fixture(t); await f.completed();
  const owner = '.codaryn/pm-comms/lock/owner.json';
  await f.write(f.pm, owner, { pid: process.pid, token: 'live' });
  assert.equal((await f.api.poll(f.pm))[0].state, 'READY');
  assert.equal((await f.read(f.pm, owner)).token, 'live');
  await fs.unlink(path.join(f.pm, owner));
  assert.equal((await f.api.poll(f.pm))[0].state, 'READY');
  assert((await fs.lstat(path.join(f.pm, '.codaryn/pm-comms/lock'))).isDirectory());
});

test('legacy unstructured reports cannot fabricate STARTED or be automatically ACKed', async t => {
  const f = await fixture(t); await f.register(); await f.dispatch();
  await f.write(f.worker, local('job') + '/report.md', 'legacy report');
  assert.equal((await f.api.poll(f.pm))[0].state, 'ASSIGNED');
  await assert.rejects(f.ready(), error => error.code === 'ENOENT');
  await assert.rejects(f.api.ack(f.pm, 'job', sha('legacy report'), true), failure('ACK_NOT_READY'));
});

test('worker cannot write a different assignment or act as PM; notification requires exact PM context', async t => {
  const f = await fixture(t, { context: { herdr: '1', pane: 'w5:p1' } }); await f.completed();
  await assert.rejects(f.author.poll(f.pm), failure('PM_CWD'));
  await assert.rejects(f.author.worker('STARTED', f.pm, f.worker, 'job', 'claude-worker'), failure('WORKER_MISMATCH'));
  assert.equal((await f.api.poll(f.pm, { notify: true }))[0].error, 'PM_CONTEXT');
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
});

test('explicit wrong ACK digest, duplicate registration and arbitrary CLI actions are rejected', async t => {
  const f = await fixture(t); await f.completed();
  await assert.rejects(f.api.ack(f.pm, 'job', '0'.repeat(64), true), failure('ACK_NOT_READY'));
  await assert.rejects(f.register(), failure('ID_ALREADY_REGISTERED'));
  for (const args of [['agent', 'start'], ['poll', '--send-keys'], ['dispatch', '--id', 'job', '--send', '--send']]) {
    await assert.rejects(cli(args, { api: f.api, output() {} }), error => ['COMMAND_INVALID', 'ARGUMENT_INVALID'].includes(error.code));
  }
});

test('CLI defaults stay file-only; unknown commands cannot start/close agents or approve a dialog', async t => {
  const f = await fixture(t); await f.register(); const rows = [];
  await cli(['dispatch', '--pm', f.pm, '--id', 'job'], { api: f.api, output: row => rows.push(row) });
  await cli(['started', '--pm', f.pm, '--worktree', f.worker, '--id', 'job', '--worker', 'codex-worker'], { api: f.author, output: row => rows.push(row) });
  await cli(['ready', '--pm', f.pm, '--worktree', f.worker, '--id', 'job', '--worker', 'codex-worker', '--stdin'], { api: f.author, input: async () => Buffer.from('# CLI report\n'), output: row => rows.push(row) });
  await cli(['poll', '--pm', f.pm], { api: f.api, output: row => rows.push(row) });
  assert.equal(rows[3][0].state, 'READY'); assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
});

test('narrow explicit PM override resolves inherited mismatch without editing environment or widening panes', async t => {
  const inheritedBefore = process.env.HERDR_PANE_ID;
  const f = await fixture(t, { context: { herdr: '1', pane: 'w5:p1' }, pmPane: 'w3:p3' });
  const ready = await f.completed();
  assert.deepEqual(await f.api.checkPM(f.pm), { inheritedMismatch: true, explicitOverride: true });
  assert.equal((await f.api.poll(f.pm, { notify: true }))[0].notification, 'accepted');
  const claim = await f.read(f.pm, pmRel('job', 'notify.' + ready.reportSHA + '.claim'));
  assert.equal(claim.inheritedMismatch, true); assert.equal(claim.explicitOverride, true);
  assert.equal(process.env.HERDR_PANE_ID, inheritedBefore);
  await assert.rejects(cli(['poll', '--pm', f.pm, '--pm-pane', 'w5:p1'], { api: f.api }), failure('PM_CONTEXT'));
  f.agents['codex-review'].pane_id = 'w3:p9'; await assert.rejects(f.api.checkPM(f.pm), failure('IDENTITY_MISMATCH'));
});

test('PM override never bypasses HERDR_ENV, actual PM kind or process/agent cwd', async t => {
  const f = await fixture(t, { context: { herdr: '0', pane: 'w5:p1' }, pmPane: 'w3:p3' });
  await assert.rejects(f.api.checkPM(f.pm), failure('PM_CONTEXT'));
  const g = await fixture(t, { context: { herdr: '1', pane: 'w5:p1' }, pmPane: 'w3:p3' });
  g.agents['codex-review'].agent = 'claude'; await assert.rejects(g.api.checkPM(g.pm), failure('IDENTITY_MISMATCH'));
  g.agents['codex-review'].agent = 'codex'; g.agents['codex-review'].cwd = g.worker;
  await assert.rejects(g.api.checkPM(g.pm), failure('PM_AGENT_CWD'));
  await assert.rejects(g.author.checkPM(g.pm), failure('PM_CWD'));
});

test('watch validates the actual fixed PM and preserves a working queue, then notifies once when idle', async t => {
  const f = await fixture(t, { context: { herdr: '1', pane: 'w5:p1' }, pmPane: 'w3:p3' });
  await f.completed(); f.agents['codex-review'].agent_status = 'working';
  const rows = []; let sleeps = 0;
  await cli(['watch', '--pm', f.pm, '--notify', '--pm-pane', 'w3:p3', '--iterations', '3', '--interval-ms', '100'], {
    api: f.api, output: row => rows.push(row), sleep: async () => { sleeps++; f.agents['codex-review'].agent_status = 'idle'; },
  });
  assert.equal(rows[0][0].notification, 'queued'); assert.equal(rows[1][0].notification, 'accepted');
  assert.equal(rows[2][0].notification, 'accepted'); assert.equal(sleeps, 2);
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 1);
});

test('closed ACK remains valid after commit/branch/session/task/report changes; new IDs still enforce checkout', async t => {
  const f = await fixture(t); await f.register('job', { checkout: { ...f.config.checkout } });
  await f.dispatch(); await f.started(); const ready = await f.ready(); await f.api.ack(f.pm, 'job', ready.reportSHA, true);
  f.config.checkout = { branch: 'next-job', head: 'd'.repeat(40) };
  f.agents['codex-worker'].terminal_id = 'next-session';
  await f.write(f.pm, '.codaryn/pm-tools/job.md', 'next task');
  await fs.unlink(path.join(f.worker, local('job'), 'report.md'));
  const row = (await f.api.poll(f.pm, { notify: true }))[0]; assert.equal(row.state, 'ACK'); assert.equal(row.closed, true);
  assert.equal((await f.api.ack(f.pm, 'job', ready.reportSHA, true)).closed, true);
  await f.register('next', { checkout: { ...f.config.checkout } }); await f.dispatch('next');
  f.config.checkout.head = 'e'.repeat(40); await assert.rejects(f.started('next'), failure('CHECKOUT_MISMATCH'));
});

test('closed ACK still rejects altered immutable ACK/inbox metadata', async t => {
  const f = await fixture(t); const ready = await f.completed(); await f.api.ack(f.pm, 'job', ready.reportSHA, true);
  const rel = '.codaryn/pm-comms/ack/job.' + ready.reportSHA + '.json', ack = await f.read(f.pm, rel);
  ack.subject = { base: null, target: null }; await f.write(f.pm, rel, ack);
  assert.equal((await f.api.poll(f.pm))[0].state, 'REJECTED');
});

test('checkout and receipt key order are immaterial; extra schema keys are still forbidden', async t => {
  const f = await fixture(t);
  await f.register('job', { checkout: { branch: f.config.checkout.branch, head: f.config.checkout.head } });
  await f.dispatch(); await f.started(); await f.ready();
  const rel = local('job') + '/ready.json', receipt = await f.read(f.worker, rel);
  const reordered = Object.fromEntries(Object.entries(receipt).reverse());
  reordered.checkout = { head: receipt.checkout.head, branch: receipt.checkout.branch };
  await f.write(f.worker, rel, reordered); assert.equal((await f.api.poll(f.pm))[0].state, 'READY');
  reordered.extra = true; await f.write(f.worker, rel, reordered);
  assert.equal((await f.api.poll(f.pm))[0].error, 'RECEIPT_MISMATCH');
  await assert.rejects(f.register('extra', { checkout: { ...f.config.checkout, extra: true } }), failure('CHECKOUT_INVALID'));
});

for (const state of ['working', 'blocked', 'unknown', 'quota']) test('worker ' + state + ' keeps report READY but is not yet acceptance-ready', async t => {
  const f = await fixture(t); const ready = await f.completed(); f.agents['codex-worker'].agent_status = state;
  const row = (await f.api.poll(f.pm, { notify: true }))[0];
  assert.equal(row.state, 'READY'); assert.equal(row.workerStatus, state); assert.equal(row.acceptanceReady, false);
  assert.equal(await fs.readFile(path.join(f.worker, local('job'), 'report.md'), 'utf8'), '# Report\n');
  await assert.rejects(f.api.ack(f.pm, 'job', ready.reportSHA, true), failure('ACK_NOT_READY'));
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
  f.agents['codex-worker'].agent_status = 'done'; assert.equal((await f.api.poll(f.pm))[0].acceptanceReady, true);
});

test('identity without session metadata exposes its limit; available session identity is pinned', async t => {
  const f = await fixture(t); await f.completed(); assert.equal((await f.api.poll(f.pm))[0].sessionBound, false);
  const g = await fixture(t); g.agents['codex-worker'].agent_session = { agent: 'codex', kind: 'id', source: 'herdr:codex', value: 'session-one' };
  await g.completed(); assert.equal((await g.api.poll(g.pm))[0].sessionBound, true);
  g.agents['codex-worker'].agent_session.value = 'session-two';
  assert.equal((await g.api.poll(g.pm))[0].error, 'IDENTITY_MISMATCH');
  delete g.agents['codex-worker'].agent_session;
  assert.equal((await g.api.poll(g.pm))[0].error, 'IDENTITY_MISMATCH');
});

test('crash before exclusive publication leaves only inert temp bytes and no global lock', async t => {
  const f = await fixture(t); await f.register();
  await f.write(f.pm, '.codaryn/pm-comms/events/job.assignment.json.tmp-12345-00000000-0000-0000-0000-000000000000', '{');
  assert.equal((await f.api.poll(f.pm))[0].state, 'REGISTERED');
  await f.dispatch(); await f.started(); await f.ready(); assert.equal((await f.api.poll(f.pm))[0].state, 'READY');
  await assert.rejects(fs.stat(path.join(f.pm, '.codaryn/pm-comms/lock')), error => error.code === 'ENOENT');
});

test('post-publication orphan temp is recovered only for a positively dead owner; live/unknown links stay intact', async t => {
  for (const liveness of [false, true, null]) {
    const f = await fixture(t, { alive: () => liveness }); await f.completed();
    const rel = local('job') + '/report.md', target = path.join(f.worker, rel);
    const temporary = target + '.tmp-12345-00000000-0000-0000-0000-000000000000';
    await fs.link(target, temporary);
    const row = (await f.api.poll(f.pm))[0];
    if (liveness === false) {
      assert.equal(row.state, 'READY'); assert.equal((await fs.stat(temporary)).nlink, 2);
    } else { assert.equal(row.error, 'FILE_UNSAFE'); assert.equal((await fs.stat(temporary)).nlink, 2); }
    assert.equal(await fs.readFile(target, 'utf8'), '# Report\n');
  }
});

test('concurrent READY writers cannot replace the winning report or create two different results', async t => {
  const f = await fixture(t); await f.register(); await f.dispatch(); await f.started();
  const results = await Promise.allSettled([f.ready('job', '# A\n'), f.ready('job', '# B\n')]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.find(x => x.status === 'rejected').reason.code, 'IMMUTABLE_CONFLICT');
  const row = (await f.api.poll(f.pm))[0]; assert.equal(row.state, 'READY');
  assert.equal(row.reportSHA, results.find(x => x.status === 'fulfilled').value.reportSHA);
});

test('normal input footer accepts narrow line wrapping and ANSI while unknown/approval dialogs fail closed', () => {
  assert(normalCodexPrompt('› Ask\n Codex to do anything\n? for shortcuts'));
  assert(normalCodexPrompt('\u001b[32m› Ask Codex to do anything\u001b[0m'));
  for (const screen of ['', 'Unknown dialog\nChoose an action', '› Ask Codex to do anything\n  1. Allow once\n  2. No',
    '› Ask Codex to do anything\nWould you like to run this command?', '› Ask Codex to do anything\nUsage limit reached']) assert(!normalCodexPrompt(screen));
  assert(!normalCodexPrompt({ stdout: '› Ask Codex to do anything' }));
});

for (const mode of ['unknown-dialog', 'read-failure', 'approval-ui']) test('visible ' + mode + ' prevents dispatch and PM notification while preserving files', async t => {
  const f = await fixture(t); await f.register();
  if (mode === 'read-failure') f.config.visibleError = Object.assign(new Error('not logged'), { code: 'EACCES' });
  else f.config.visibleText = mode === 'approval-ui' ? '› Ask Codex to do anything\n  1. Allow once\n  2. No' : 'Unrecognized dialog\nContinue?';
  const dispatched = await f.dispatch('job', { send: true });
  assert.equal(dispatched.delivery, 'queued'); assert.equal(dispatched.error, 'VISIBLE_UNCONFIRMED');
  await f.started(); const ready = await f.ready();
  const collected = (await f.api.poll(f.pm, { notify: true }))[0];
  assert.equal(collected.state, 'READY'); assert.equal(collected.notification, 'queued'); assert.equal(collected.error, 'VISIBLE_UNCONFIRMED');
  assert.equal((await f.read(f.pm, '.codaryn/pm-comms/inbox/job.' + ready.reportSHA + '.ready.json')).state, 'READY');
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
  f.config.visibleError = null; f.config.visibleText = '› Ask\n Codex to do anything';
  assert.equal((await f.api.poll(f.pm, { notify: true }))[0].notification, 'accepted');
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 1);
});

test('worker help and guide use canonical main script from worker cwd and default to noninteractive ready', async () => {
  const output = []; await cli(['--help'], { output: row => output.push(row) });
  const help = output[0].help;
  for (const command of ['started', 'ready']) assert(help.includes('node D:/project/Codaryn/scripts/pm-session-comms.mjs ' + command + ' --pm'));
  assert(help.includes('without --stdin (noninteractive)')); assert(help.includes('Optional ready --stdin'));
  const guide = await fs.readFile(path.join(workspace, 'docs/workflows/session-communication.md'), 'utf8');
  const workerExamples = guide.split('\n').filter(line => /^node .*pm-session-comms\.mjs (started|ready) /.test(line));
  assert.equal(workerExamples.length, 2);
  assert(workerExamples.every(line => line.startsWith('node D:/project/Codaryn/scripts/pm-session-comms.mjs ') && !line.includes('--stdin')));
  assert(guide.includes('report.md`를 worker cwd 안에 완전히 작성')); assert(guide.includes('명시적으로 EOF'));
});

test('normal completion body words and numbered answers do not block the last real input footer', async t => {
  const screen = '1. 승인화면은 건드리지 않는다.\n2. 한도 질문에는 답하지 않는다.\nWould you like / usage limit are documented states.\n› Ask\n Codex to do anything\n? for shortcuts';
  assert(normalCodexPrompt(screen));
  const f = await fixture(t); await f.register(); f.config.visibleText = screen;
  assert.equal((await f.dispatch('job', { send: true })).delivery, 'accepted');
  await f.started(); await f.ready();
  assert.equal((await f.api.poll(f.pm, { notify: true }))[0].notification, 'accepted');
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 2);
});

test('quoted footer followed by the actual approval menu never permits dispatch or notification', async t => {
  const screen = 'Example of a normal prompt:\n› Ask Codex to do anything\nActual approval dialog:\n  1. Yes, proceed\n  2. No\nPress Enter to choose';
  assert(!normalCodexPrompt(screen));
  const f = await fixture(t); await f.register(); f.config.visibleText = screen;
  assert.equal((await f.dispatch('job', { send: true })).delivery, 'queued');
  await f.started(); await f.ready();
  assert.equal((await f.api.poll(f.pm, { notify: true }))[0].notification, 'queued');
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
});

test('AUDIT regression: registration rejects worker TUI cwd in a different project', async t => {
  const f = await fixture(t); f.agents['codex-worker'].cwd = path.dirname(f.pm);
  await assert.rejects(f.register());
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
});

test('AUDIT regression: active dispatch rejects changed worker TUI cwd before any prompt', async t => {
  const f = await fixture(t); await f.register(); f.agents['codex-worker'].cwd = path.dirname(f.pm);
  await assert.rejects(f.dispatch('job', { send: true }));
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
});

test('AUDIT regression: changed worker TUI cwd prevents active poll acceptance and ACK', async t => {
  const f = await fixture(t); const ready = await f.completed(); f.agents['codex-worker'].cwd = path.dirname(f.pm);
  assert.equal((await f.api.poll(f.pm))[0].state, 'REJECTED');
  await assert.rejects(f.api.ack(f.pm, 'job', ready.reportSHA, true));
});

test('AUDIT regression: explicit checkout drift rejects file and prompt dispatch before assignment or claim', async t => {
  const f = await fixture(t); await f.register('job', { checkout: { ...f.config.checkout } });
  f.config.checkout.head = 'd'.repeat(40);
  await assert.rejects(f.dispatch(), failure('CHECKOUT_MISMATCH'));
  await assert.rejects(f.dispatch('job', { send: true }), failure('CHECKOUT_MISMATCH'));
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
  for (const suffix of ['assignment', 'dispatch.claim']) await assert.rejects(fs.stat(path.join(f.pm, pmRel('job', suffix))), error => error.code === 'ENOENT');
});

for (const tui of ['main', 'assigned-worktree']) test('worker TUI cwd ' + tui + ' is normalized/pinned independently of tool cwd', async t => {
  const f = await fixture(t); const expected = tui === 'main' ? f.pm : f.worker;
  f.agents['codex-worker'].cwd = expected + path.sep + '.';
  await f.register(); const job = await f.read(f.pm, '.codaryn/pm-comms/registry/job.json');
  assert.equal(job.identity.cwd, await fs.realpath(expected));
  await f.dispatch(); await f.started(); const ready = await f.ready();
  assert.equal((await f.api.poll(f.pm))[0].acceptanceReady, true);
  assert.equal((await f.api.ack(f.pm, 'job', ready.reportSHA, true)).state, 'ACK');
  assert.equal(f.config.gitCalls, 0);
});

test('registration refuses missing, relative, nonexistent, other-WT or junction TUI cwd', async t => {
  const f = await fixture(t); const other = path.join(f.pm, '.worktrees/other'); await fs.mkdir(other);
  const linked = path.join(f.pm, '.worktrees/linked'); await fs.symlink(f.pm, linked, process.platform === 'win32' ? 'junction' : 'dir');
  for (const cwd of [undefined, 'relative', path.join(f.pm, '.worktrees/missing'), other, linked]) {
    f.agents['codex-worker'].cwd = cwd; await assert.rejects(f.register());
  }
});

test('active jobs reject switching between allowed TUI directories and missing cwd; closed ACK remains valid', async t => {
  const f = await fixture(t); const ready = await f.completed();
  f.agents['codex-worker'].cwd = f.worker;
  await assert.rejects(f.dispatch()); assert.equal((await f.api.poll(f.pm))[0].state, 'REJECTED');
  delete f.agents['codex-worker'].cwd;
  await assert.rejects(f.api.ack(f.pm, 'job', ready.reportSHA, true));
  f.agents['codex-worker'].cwd = f.pm; await f.api.ack(f.pm, 'job', ready.reportSHA, true);
  f.agents['codex-worker'].cwd = path.dirname(f.pm);
  assert.equal((await f.api.poll(f.pm))[0].closed, true);
});

test('checkout is rechecked after visible readiness before the send claim', async t => {
  const f = await fixture(t); await f.register('job', { checkout: { ...f.config.checkout } });
  const transport = {
    async get(name) { return { result: { type: 'agent_info', agent: { ...f.agents[name] } } }; },
    async visible() { f.config.checkout.head = 'e'.repeat(40); return '› Ask Codex to do anything'; },
    async prompt() { assert.fail('stale checkout must never be prompted'); },
  };
  const api = createComms({ projectRoot: f.pm, cwd: f.pm, context: { herdr: '1', pane: 'w3:p3' }, transport,
    git: async () => ({ ...f.config.checkout }) });
  await assert.rejects(api.dispatch(f.pm, 'job', { send: true }), failure('CHECKOUT_MISMATCH'));
  await assert.rejects(fs.stat(path.join(f.pm, pmRel('job', 'dispatch.claim'))), error => error.code === 'ENOENT');
});

for (const route of ['dispatch-worker', 'notify-worker', 'notify-pm']) test('final visible identity: cwd drift during ' + route + ' prevents the send claim', async t => {
  const f = await fixture(t);
  if (route === 'dispatch-worker') await f.register(); else await f.completed();
  const prompts = [];
  const transport = {
    async get(name) { return { result: { type: 'agent_info', agent: { ...f.agents[name] } } }; },
    async visible() {
      f.agents[route === 'notify-pm' ? 'codex-review' : 'codex-worker'].cwd = path.dirname(f.pm);
      return '› Ask Codex to do anything';
    },
    async prompt(name) { prompts.push(name); return { result: { type: 'agent_prompt' } }; },
  };
  const api = createComms({ projectRoot: f.pm, cwd: f.pm, context: { herdr: '1', pane: 'w3:p3' }, transport });
  if (route === 'dispatch-worker') await assert.rejects(api.dispatch(f.pm, 'job', { send: true }));
  else {
    const row = (await api.poll(f.pm, { notify: true }))[0];
    assert.equal(row.state, 'READY'); assert.equal(row.notification, 'queued');
    assert(['AGENT_CWD_UNCONFIRMED', 'IDENTITY_CWD_MISMATCH'].includes(row.error));
  }
  assert.equal(prompts.length, 0);
  const suffix = route === 'dispatch-worker' ? 'dispatch.claim' : 'notify.' + sha('# Report\n') + '.claim';
  await assert.rejects(fs.stat(path.join(f.pm, pmRel('job', suffix))), error => error.code === 'ENOENT');
});

for (const variant of ['lowercase-drive', 'lowercase-root', 'worktrees-alias']) test('worktree scope case: ' + variant + ' follows platform path identity', async t => {
  const f = await fixture(t);
  const alias = variant === 'worktrees-alias' ? path.join(f.pm, '.WORKTREES', path.basename(f.worker))
    : variant === 'lowercase-drive' ? f.pm[0].toLowerCase() + f.pm.slice(1) : f.pm.toLowerCase();
  if (process.platform !== 'win32') {
    f.agents['codex-worker'].cwd = variant === 'worktrees-alias' ? alias : f.pm.toUpperCase();
    await assert.rejects(f.register()); return;
  }
  assert.equal(await fs.realpath(alias), await fs.realpath(variant === 'worktrees-alias' ? f.worker : f.pm));
  f.agents['codex-worker'].cwd = alias;
  await f.register('job', variant === 'worktrees-alias' ? { worktree: alias } : {});
  const registered = await f.read(f.pm, '.codaryn/pm-comms/registry/job.json');
  assert.equal(registered.identity.cwd, await fs.realpath(alias));
  await f.dispatch(); await f.started(); const ready = await f.ready();
  assert.equal((await f.api.poll(f.pm))[0].acceptanceReady, true);
  assert.equal((await f.api.ack(f.pm, 'job', ready.reportSHA, true)).state, 'ACK');
});

test('worktree scope case: another project remains rejected despite case folding', async t => {
  const f = await fixture(t), external = path.join(path.dirname(f.pm), 'different-project');
  await fs.mkdir(external); f.agents['codex-worker'].cwd = process.platform === 'win32' ? external.toLowerCase() : external;
  await assert.rejects(f.register());
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
});

test('worktree scope case: alias of another WT still violates the registered worker identity', async t => {
  const f = await fixture(t), other = path.join(f.pm, '.worktrees/other'); await fs.mkdir(other);
  f.agents['codex-worker'].cwd = path.join(f.pm, '.WORKTREES', path.basename(other));
  await assert.rejects(f.register());
  assert.equal(f.calls.filter(x => x[0] === 'prompt').length, 0);
});

test('native transport: admission-only prompt uses supported argv and keeps parent timeout', async () => {
  const calls = [];
  const transport = herdrTransport({ inHerdr: () => true, nativeExec: async (executable, args, options) => {
    calls.push({ executable, args, options });
    assert.equal(options.timeout, 10000); assert.equal(options.windowsHide, true);
    // Installed CLI's pre-input validator: --timeout is valid only together with --wait.
    if (args.includes('--timeout') && !args.includes('--wait')) throw Object.assign(new Error('--timeout requires --wait'), { code: 2 });
    assert.deepEqual(args, ['agent', 'prompt', 'codex-worker', 'synthetic metadata only']);
    return { stdout: '{"result":{"type":"agent_prompt","accepted":true}}' };
  } });
  assert.deepEqual(await transport.prompt('codex-worker', 'synthetic metadata only'), { result: { type: 'agent_prompt', accepted: true } });
  assert.equal(calls.length, 1); assert.equal(calls[0].executable, 'herdr');
});

test('native transport: JSON get and plain visible stdout remain separate without Herdr wait', async () => {
  const calls = [], visible = 'Completed.\n› Ask Codex to do anything';
  const transport = herdrTransport({ inHerdr: () => true, nativeExec: async (executable, args, options) => {
    calls.push(args); assert.equal(executable, 'herdr'); assert.equal(options.timeout, 10000);
    if (args[1] === 'get') return { stdout: '{"result":{"type":"agent_info","agent":{"name":"codex-worker"}}}' };
    return { stdout: visible };
  } });
  assert.equal((await transport.get('codex-worker')).result.agent.name, 'codex-worker');
  assert.equal(await transport.visible('codex-worker'), visible);
  assert.deepEqual(calls, [['agent', 'get', 'codex-worker'], ['agent', 'read', 'codex-worker', '--source', 'visible', '--lines', '20']]);
});

test('native transport: parent timeout rejects once without waiting, fallback or retry', async () => {
  let calls = 0;
  const transport = herdrTransport({ inHerdr: () => true, nativeExec: async (_executable, args, options) => {
    calls++; assert.equal(options.timeout, 10000); assert(!args.includes('--wait'));
    throw Object.assign(new Error('synthetic parent timeout'), { code: 'ETIMEDOUT' });
  } });
  await assert.rejects(transport.prompt('codex-worker', 'synthetic metadata only'), failure('ETIMEDOUT'));
  assert.equal(calls, 1);
});
