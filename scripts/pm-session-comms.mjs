#!/usr/bin/env node
/** Codaryn's current workers and fixed Codex PM transport. Durable files are the contract. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PANES = Object.freeze({ 'codex-review': 'w3:p3', 'codex-worker': 'w3:pJ', 'claude-worker': 'w3:pH', 'codex-worker-2': 'w3:pK', 'codex-worker-3': 'w3:pM', 'codex-worker-4': 'w3:pN' });
const WORKER_AGENTS = Object.freeze({ 'codex-worker': 'codex', 'claude-worker': 'claude', 'codex-worker-2': 'codex', 'codex-worker-3': 'codex', 'codex-worker-4': 'codex' });
// Historical names validate immutable records only; they cannot register or resume work.
const RECORD_PANES = Object.freeze({ 'codex-check': 'w3:pD', 'codex-loop': 'w3:p8',
  'codex-sec': 'w3:pC', 'codex-audit': 'w3:pE', 'codex-probe': 'w3:pF', ...PANES });
const currentWorker = name => Object.hasOwn(WORKER_AGENTS, name);
const digest = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value !== null && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const bytes = value => Buffer.from(JSON.stringify(ordered(value), null, 2) + '\n');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const expect = (condition, code) => { if (!condition) fail(code); };
const same = isDeepStrictEqual;
const keys = (value, names) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...names].sort().join(',');
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const idOf = value => { expect(typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value), 'INVALID_ID'); return value; };
const absent = error => error.code === 'ENOENT';
const errorCode = error => ['EACCES', 'EPERM', 'ETIMEDOUT', 'ENOENT'].includes(error.code) ? error.code : 'TRANSPORT_UNKNOWN';
const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

/** No shell, inherited session only; never start/close/key/control a terminal or retry a prompt. */
export function herdrTransport({ nativeExec = execute, inHerdr = () => process.env.HERDR_ENV === '1' } = {}) {
  async function run(args, plainText = false) {
    expect(inHerdr(), 'NOT_IN_HERDR');
    try {
      const result = await nativeExec('herdr', args, { timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true });
      return plainText ? result.stdout : JSON.parse(result.stdout);
    } catch (error) { fail(errorCode(error)); }
  }
  return {
    get: name => run(['agent', 'get', name]),
    visible: name => run(['agent', 'read', name, '--source', 'visible', '--lines', '20'], true),
    prompt: (name, text) => run(['agent', 'prompt', name, text]),
  };
}

/** Conservative normal input footer, including a narrow-pane line wrap; never a dialog answer. */
export function normalCodexPrompt(visible) {
  if (typeof visible !== 'string') return false;
  const text = visible.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
  const footer = [...text.matchAll(/(?:^|\n)[ \t]*[›❯>][ \t]*Ask\s+Codex\b/gi)].at(-1);
  if (!footer) return false;
  const inputUI = text.slice(footer.index);
  if (/(?:would you like|do you want|allow once|yes, proceed|approval required|requires approval|press enter|usage limit|limit reached|승인|한도)/i.test(inputUI)) return false;
  if (/(?:^|\n)\s*(?:[›❯>]\s*)?(?:[0-9]+[.)]|[●○□■])\s/.test(inputUI)) return false;
  return true;
}

/** External boundaries (Herdr, Git, liveness) are injectable; all storage uses real filesystem operations. */
export function createComms({ projectRoot = project, cwd = process.cwd(), transport = herdrTransport(),
  context = { herdr: process.env.HERDR_ENV, pane: process.env.HERDR_PANE_ID },
  pmPane,
  git = async worktree => {
    const run = async args => (await execute('git', ['-C', worktree, ...args], { timeout: 10000, windowsHide: true })).stdout.trim();
    return { head: await run(['rev-parse', 'HEAD']), branch: (await run(['branch', '--show-current'])) || null };
  }, alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'ESRCH' ? false : null; } },
} = {}) {
  const root = path.resolve(projectRoot);
  async function worktree(value) {
    expect(typeof value === 'string' && path.isAbsolute(value), 'WORKTREE_PATH');
    const absolute = path.resolve(value), relative = path.relative(root, absolute);
    const scopedRelative = process.platform === 'win32' ? relative.toLowerCase() : relative;
    expect(canonical(absolute) === canonical(root) || /^\.worktrees[/\\][a-zA-Z0-9_-]+$/.test(scopedRelative), 'WORKTREE_SCOPE');
    let current = path.parse(absolute).root;
    for (const segment of absolute.slice(current.length).split(path.sep)) {
      current = path.join(current, segment);
      const stat = await fs.lstat(current);
      expect(stat.isDirectory() && !stat.isSymbolicLink(), 'WORKTREE_LINK');
    }
    expect(canonical(await fs.realpath(absolute)) === canonical(absolute), 'WORKTREE_REALPATH');
    return absolute;
  }
  // No traversal, ADS, device names or links. Only registered files in the dedicated namespaces are read.
  async function confined(wt, relative, parents = false) {
    expect(typeof relative === 'string' && relative.startsWith('.codaryn/'), 'PATH_SCOPE');
    const segments = relative.split('/');
    expect(segments.every(s => /^[a-zA-Z0-9._-]+$/.test(s) && !['.', '..'].includes(s)
      && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s)), 'PATH_SEGMENT');
    const absolute = path.join(wt, ...segments);
    let current = wt;
    for (let i = 0; i < segments.length; i++) {
      current = path.join(current, segments[i]);
      if (parents && i < segments.length - 1) {
        try { await fs.mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      try {
        const stat = await fs.lstat(current);
        expect(!stat.isSymbolicLink(), 'PATH_LINK');
        if (i < segments.length - 1) expect(stat.isDirectory(), 'PATH_DIRECTORY');
        expect(canonical(await fs.realpath(current)) === canonical(current), 'PATH_REALPATH');
      } catch (error) { if (!absent(error)) throw error; }
    }
    return absolute;
  }
  async function read(wt, rel, optional = false) {
    const file = await confined(wt, rel);
    let handle;
    try {
      // A link commit is already complete. Account for every extra link using exact orphan
      // temp names/inodes and positively dead PIDs. Reads never delete another owner's files.
      let accounted = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const stat = await fs.lstat(file);
        if (stat.nlink === 1) { accounted = true; break; }
        const prefix = path.basename(file) + '.tmp-';
        let orphanLinks = 0;
        for (const entry of await fs.readdir(path.dirname(file))) {
          if (!entry.startsWith(prefix)) continue;
          const match = /^(\d+)-[a-f0-9-]{36}$/.exec(entry.slice(prefix.length));
          if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) <= 0 || await alive(Number(match[1])) !== false) continue;
          const temporaryRel = path.posix.join(path.posix.dirname(rel), entry);
          const temporary = await confined(wt, temporaryRel), linked = await fs.lstat(temporary).catch(error => { if (absent(error)) return null; throw error; });
          if (linked && !linked.isSymbolicLink() && linked.ino === stat.ino && linked.dev === stat.dev) orphanLinks++;
        }
        if (stat.nlink === 1 + orphanLinks) { accounted = true; break; }
        if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 2));
      }
      const before = await fs.lstat(file);
      expect(accounted && before.isFile() && before.size <= 2 * 1024 * 1024, 'FILE_UNSAFE');
      handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = await handle.stat();
      expect(opened.ino === before.ino && opened.dev === before.dev, 'FILE_CHANGED');
      const data = await handle.readFile();
      const after = await fs.lstat(await confined(wt, rel));
      expect(after.ino === opened.ino && after.dev === opened.dev && after.size === data.length
        && after.mtimeMs === before.mtimeMs && after.nlink === before.nlink, 'FILE_CHANGED');
      return data;
    } catch (error) { if (optional && absent(error)) return null; throw error; }
    finally { await handle?.close(); }
  }
  async function json(wt, rel, optional = false) {
    const data = await read(wt, rel, optional);
    if (data === null) return null;
    try { return JSON.parse(data); } catch { fail('PARTIAL_JSON'); }
  }
  // fsync + exclusive hard-link publication: existing records are never replaced. Orphan temps are inert.
  async function publish(wt, rel, data, identical = true) {
    const target = await confined(wt, rel, true), temporary = target + '.tmp-' + process.pid + '-' + randomUUID();
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    try {
      await confined(wt, rel);
      await fs.link(temporary, target);
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (identical) expect((await read(wt, rel)).equals(data), 'IMMUTABLE_CONFLICT');
      return false;
    } finally { await fs.unlink(temporary); }
  }
  const put = (wt, rel, value, identical = true) => publish(wt, rel, bytes(value), identical);
  // No global lock or mkdir→owner window: each immutable result and send claim is exclusive.
  async function pmContext(pm) { expect(canonical(cwd) === canonical(pm), 'PM_CWD'); }
  async function sendingContext(pm) {
    expect(context.herdr === '1' && (pmPane === undefined || pmPane === PANES['codex-review'])
      && (context.pane === PANES['codex-review'] || pmPane === PANES['codex-review']), 'PM_CONTEXT');
    const agent = await identity('codex-review');
    expect(typeof agent.cwd === 'string' && canonical(agent.cwd) === canonical(pm), 'PM_AGENT_CWD');
    return { agent, metadata: { inheritedMismatch: context.pane !== PANES['codex-review'], explicitOverride: pmPane !== undefined } };
  }
  async function identity(name, expected) {
    let response;
    try { response = await transport.get(name); } catch { fail('IDENTITY_UNAVAILABLE'); }
    const agent = response?.result?.agent;
    const kind = name === 'codex-review' ? 'codex' : WORKER_AGENTS[name];
    expect(Object.hasOwn(PANES, name) && response?.result?.type === 'agent_info' && agent?.agent === kind && agent.name === name
      && agent.pane_id === PANES[name] && typeof agent.terminal_id === 'string' && agent.terminal_id.length > 0, 'IDENTITY_MISMATCH');
    const sessionSHA = agent.agent_session ? digest(bytes(agent.agent_session)) : null;
    if (expected) expect(agent.terminal_id === expected.terminal && agent.pane_id === expected.pane
      && (expected.sessionSHA === null || sessionSHA === expected.sessionSHA), 'IDENTITY_MISMATCH');
    if (expected) {
      expect(typeof expected.cwd === 'string', 'IDENTITY_CWD_REQUIRED');
      expect(canonical(await verifiedAgentCwd(agent.cwd)) === canonical(expected.cwd), 'IDENTITY_CWD_MISMATCH');
    }
    return { name, pane: agent.pane_id, terminal: agent.terminal_id, sessionSHA, status: agent.agent_status, cwd: agent.cwd };
  }
  async function verifiedAgentCwd(value) {
    try { return await fs.realpath(await worktree(value)); }
    catch { fail('AGENT_CWD_UNCONFIRMED'); }
  }
  async function inputReady(name) {
    // The visible-footer parser is Codex-only, even if a Claude screen quotes that footer.
    if (WORKER_AGENTS[name] === 'claude') return false;
    try { return normalCodexPrompt(await transport.visible(name)); }
    catch { return false; }
  }
  async function checkout(job) {
    if (job.checkout !== null) expect(same(await git(job.worktree), job.checkout), 'CHECKOUT_MISMATCH');
  }
  const registry = id => '.codaryn/pm-comms/registry/' + idOf(id) + '.json';
  const event = (id, suffix) => '.codaryn/pm-comms/events/' + idOf(id) + '.' + suffix + '.json';
  const local = id => '.codaryn/session-comms/' + idOf(id);
  function jobShape(job) {
    expect(keys(job, ['version', 'id', 'pm', 'worker', 'identity', 'worktree', 'subject', 'checkout', 'report', 'receipt', 'taskFile', 'taskSHA'])
      && job.version === 1 && job.id === idOf(job.id) && job.worker !== 'codex-review' && Object.hasOwn(RECORD_PANES, job.worker)
      && (keys(job.identity, ['name', 'pane', 'terminal', 'sessionSHA', 'cwd'])
        || keys(job.identity, ['name', 'pane', 'terminal', 'sessionSHA']))
      && job.identity?.name === job.worker && job.identity.pane === RECORD_PANES[job.worker]
      && typeof job.identity.terminal === 'string' && job.identity.terminal.length > 0
      && (job.identity.sessionSHA === null || hash(job.identity.sessionSHA)), 'REGISTRY_INVALID');
    if ('cwd' in job.identity) expect(typeof job.identity.cwd === 'string' && path.isAbsolute(job.identity.cwd)
      && [job.pm, job.worktree].some(directory => canonical(directory) === canonical(job.identity.cwd)), 'REGISTRY_CWD_INVALID');
    expect(job.report === local(job.id) + '/report.md' && job.receipt === local(job.id) + '/ready.json', 'REGISTERED_PATH');
    expect(job.taskFile.startsWith('.codaryn/pm-tools/') && job.taskFile.endsWith('.md') && hash(job.taskSHA), 'TASK_PATH');
    expect(job.subject && Object.keys(job.subject).sort().join(',') === 'base,target'
      && [job.subject.base, job.subject.target].every(value => value === null || sha(value)), 'SUBJECT_INVALID');
    expect(job.checkout === null || (keys(job.checkout, ['branch', 'head']) && sha(job.checkout?.head) && (job.checkout.branch === null
      || typeof job.checkout.branch === 'string' && /^[a-zA-Z0-9/_-]+$/.test(job.checkout.branch))), 'CHECKOUT_INVALID');
  }
  async function load(pm, id, active = true) {
    const job = await json(pm, registry(id)); jobShape(job);
    expect(job.id === id && canonical(job.pm) === canonical(pm), 'ASSIGNMENT_MISMATCH');
    if (active) {
      if (!currentWorker(job.worker)) {
        // Preserve the abandoned comm-live-loop-01 checkout failure without querying old panes.
        await worktree(job.worktree);
        await checkout(job);
        fail('WORKER_NOT_ALLOWED');
      }
      expect(typeof job.identity.cwd === 'string', 'IDENTITY_CWD_REQUIRED');
      await worktree(job.worktree);
      await confined(job.worktree, job.report); await confined(job.worktree, job.receipt);
      expect(digest(await read(pm, job.taskFile)) === job.taskSHA, 'STALE_TASK');
    }
    return job;
  }
  async function assigned(pm, job) {
    const assignment = await json(pm, event(job.id, 'assignment'));
    expect(assignment?.registrationSHA === digest(bytes(job)), 'NOT_DISPATCHED');
  }
  const stamp = job => ({ version: 1, id: job.id, registrationSHA: digest(bytes(job)), worker: job.worker,
    identity: job.identity, worktree: job.worktree, subject: job.subject, checkout: job.checkout, report: job.report, receipt: job.receipt });
  function receiptValid(job, receipt, state) {
    expect(receipt?.state === state && same(receipt, { ...stamp(job), state, ...(state === 'READY' ? { reportSHA: receipt.reportSHA } : {}) }), 'RECEIPT_MISMATCH');
    if (state === 'READY') expect(hash(receipt.reportSHA), 'HASH_INVALID');
  }
  async function closed(pm, job) {
    const directory = await confined(pm, '.codaryn/pm-comms/ack');
    const names = await fs.readdir(directory).catch(error => { if (absent(error)) return []; throw error; });
    const files = names.filter(name => name.startsWith(job.id + '.') && name.endsWith('.json'));
    expect(files.length <= 1, 'ACK_MISMATCH');
    if (files.length === 0) return null;
    const ack = await json(pm, '.codaryn/pm-comms/ack/' + files[0]);
    receiptValid(job, { ...ack, state: 'READY' }, 'READY');
    expect(ack.state === 'ACK' && files[0] === job.id + '.' + ack.reportSHA + '.json', 'ACK_MISMATCH');
    const inbox = await json(pm, '.codaryn/pm-comms/inbox/' + job.id + '.' + ack.reportSHA + '.ready.json');
    expect(same(ack, { ...inbox, state: 'ACK' }), 'ACK_MISMATCH');
    receiptValid(job, inbox, 'READY');
    receiptValid(job, await json(pm, '.codaryn/pm-comms/inbox/' + job.id + '.started.json'), 'STARTED');
    return { id: job.id, state: 'ACK', closed: true, reportSHA: ack.reportSHA };
  }
  async function collect(pm, job) {
    await checkout(job);
    let verified = true, agent;
    try { agent = await identity(job.worker, job.identity); }
    catch (error) { if (error.code !== 'IDENTITY_UNAVAILABLE') throw error; verified = false; }
    if (await json(pm, event(job.id, 'assignment'), true) === null) return { id: job.id, state: 'REGISTERED' };
    await assigned(pm, job);
    const started = await json(job.worktree, local(job.id) + '/started.json', true);
    const ready = await json(job.worktree, job.receipt, true);
    const assignment = await json(job.worktree, local(job.id) + '/assignment.json', true);
    if (!started && !ready) return { id: job.id, state: 'ASSIGNED' };
    expect(same(assignment, stamp(job)), 'LOCAL_ASSIGNMENT_MISMATCH');
    expect(started !== null, 'STARTED_REQUIRED'); receiptValid(job, started, 'STARTED');
    await put(pm, '.codaryn/pm-comms/inbox/' + job.id + '.started.json', started);
    const lifecycle = { identityVerified: verified, sessionBound: job.identity.sessionSHA !== null,
      workerStatus: agent?.status ?? 'unavailable', acceptanceReady: verified && ['idle', 'done'].includes(agent?.status) };
    if (!ready) return { id: job.id, state: 'STARTED', ...lifecycle };
    receiptValid(job, ready, 'READY');
    expect(digest(await read(job.worktree, job.report)) === ready.reportSHA, 'REPORT_HASH_MISMATCH');
    const key = job.id + '.' + ready.reportSHA;
    await put(pm, '.codaryn/pm-comms/inbox/' + key + '.ready.json', ready);
    const ack = await json(pm, '.codaryn/pm-comms/ack/' + key + '.json', true);
    if (ack) expect(same(ack, { ...ready, state: 'ACK' }), 'ACK_MISMATCH');
    return { id: job.id, state: ack ? 'ACK' : 'READY', reportSHA: ready.reportSHA, ...lifecycle };
  }
  async function notify(pm, job, row) {
    if (row.state !== 'READY' || !row.acceptanceReady) return row;
    const { agent: pmAgent, metadata } = await sendingContext(pm);
    if (!['idle', 'done'].includes(pmAgent.status)) return { ...row, notification: 'queued' };
    // Recheck the pinned worker immediately before sending; a known mismatch never gets notified.
    const worker = await identity(job.worker, job.identity);
    if (!['idle', 'done'].includes(worker.status)) return { ...row, acceptanceReady: false, workerStatus: worker.status, notification: 'queued' };
    const latest = await identity('codex-review', pmAgent);
    if (!['idle', 'done'].includes(latest.status)) return { ...row, notification: 'queued' };
    if (!(await inputReady('codex-review'))) return { ...row, notification: 'queued', error: 'VISIBLE_UNCONFIRMED' };
    const finalWorker = await identity(job.worker, job.identity);
    if (!['idle', 'done'].includes(finalWorker.status)) return { ...row, acceptanceReady: false, workerStatus: finalWorker.status, notification: 'queued' };
    const finalPM = await identity('codex-review', pmAgent);
    if (!['idle', 'done'].includes(finalPM.status)) return { ...row, notification: 'queued' };
    const suffix = 'notify.' + row.reportSHA;
    const claim = await put(pm, event(job.id, suffix + '.claim'), { id: job.id, reportSHA: row.reportSHA, state: 'unknown', ...metadata }, false);
    const delivered = event(job.id, suffix + '.accepted');
    if (!claim) return { ...row, notification: await json(pm, delivered, true) ? 'accepted' : 'unknown' };
    try {
      await transport.prompt('codex-review', `READY id=${job.id} sha256=${row.reportSHA} receipt=${job.receipt}. Collect/read report, then explicitly ACK.`);
      await put(pm, delivered, { id: job.id, reportSHA: row.reportSHA, state: 'accepted' });
      return { ...row, notification: 'accepted' };
    } catch (error) {
      await put(pm, event(job.id, suffix + '.error'), { id: job.id, state: 'unknown', error: errorCode(error) });
      return { ...row, notification: 'unknown' };
    }
  }
  return {
    async checkPM(pmPath) {
      const pm = await worktree(pmPath); await pmContext(pm);
      const { metadata } = await sendingContext(pm);
      await put(pm, '.codaryn/pm-comms/events/context.' + (metadata.inheritedMismatch ? 'mismatch' : 'match')
        + '.' + (metadata.explicitOverride ? 'override' : 'inherited') + '.json', metadata);
      return metadata;
    },
    async register(pmPath, spec) {
      const pm = await worktree(pmPath); await pmContext(pm);
      const id = idOf(spec.id); expect(currentWorker(spec.worker) && PANES[spec.worker] === spec.pane, 'WORKER_NOT_ALLOWED');
      {
        expect(await json(pm, registry(id), true) === null, 'ID_ALREADY_REGISTERED');
        const workerWT = await worktree(spec.worktree);
        const live = await identity(spec.worker);
        const agentCwd = await verifiedAgentCwd(live.cwd);
        expect([pm, workerWT].some(directory => canonical(directory) === canonical(agentCwd)), 'IDENTITY_CWD_MISMATCH');
        const job = { version: 1, id, pm, worker: spec.worker,
          identity: { name: live.name, pane: live.pane, terminal: live.terminal, sessionSHA: live.sessionSHA, cwd: agentCwd }, worktree: workerWT,
          subject: spec.subject ?? { base: null, target: null }, checkout: spec.checkout ?? null,
          report: spec.report, receipt: spec.receipt, taskFile: spec.taskFile, taskSHA: spec.taskSHA };
        jobShape(job); await checkout(job);
        expect(digest(await read(pm, job.taskFile)) === job.taskSHA, 'STALE_TASK');
        await confined(workerWT, job.report); await confined(workerWT, job.receipt);
        await put(pm, registry(id), job); return { id, state: 'REGISTERED', taskSHA: job.taskSHA };
      }
    },
    async dispatch(pmPath, id, { send = false } = {}) {
      const pm = await worktree(pmPath); await pmContext(pm);
      {
        const job = await load(pm, id);
        expect(!(await closed(pm, job)), 'JOB_CLOSED');
        await identity(job.worker, job.identity);
        await checkout(job);
        await put(pm, event(id, 'assignment'), { id, registrationSHA: digest(bytes(job)), taskSHA: job.taskSHA, state: 'ASSIGNED' });
        if (!send) return { id, state: 'ASSIGNED', delivery: 'not-requested' };
        const { metadata } = await sendingContext(pm); const live = await identity(job.worker, job.identity);
        if (!['idle', 'done'].includes(live.status)) return { id, state: 'ASSIGNED', delivery: 'queued' };
        if (!(await inputReady(job.worker))) return { id, state: 'ASSIGNED', delivery: 'queued', error: 'VISIBLE_UNCONFIRMED' };
        await checkout(job);
        const finalWorker = await identity(job.worker, job.identity);
        if (!['idle', 'done'].includes(finalWorker.status)) return { id, state: 'ASSIGNED', delivery: 'queued' };
        if (!(await put(pm, event(id, 'dispatch.claim'), { id, state: 'unknown', ...metadata }, false))) {
          return { id, state: 'ASSIGNED', delivery: await json(pm, event(id, 'dispatch.accepted'), true) ? 'accepted' : 'unknown' };
        }
        try {
          await transport.prompt(job.worker, `Assignment id=${id} task=${path.join(pm, job.taskFile)} sha256=${job.taskSHA}. Read registered assignment; record STARTED and READY via pm-session-comms. Submission is not STARTED.`);
          await put(pm, event(id, 'dispatch.accepted'), { id, state: 'accepted' });
          return { id, state: 'ASSIGNED', delivery: 'accepted' };
        } catch (error) {
          await put(pm, event(id, 'dispatch.error'), { id, state: 'unknown', error: errorCode(error) });
          return { id, state: 'ASSIGNED', delivery: 'unknown' };
        }
      }
    },
    async worker(state, pmPath, workerPath, id, name, reportText) {
      expect(['STARTED', 'READY'].includes(state), 'STATE_INVALID');
      const pm = await worktree(pmPath), wt = await worktree(workerPath);
      expect(canonical(cwd) === canonical(wt), 'WORKER_CWD');
      const job = await load(pm, id); expect(job.worker === name && canonical(job.worktree) === canonical(wt), 'WORKER_MISMATCH');
      await assigned(pm, job); await checkout(job);
      {
        if (state === 'STARTED') {
          await put(wt, local(id) + '/assignment.json', stamp(job));
          const receipt = { ...stamp(job), state };
          await put(wt, local(id) + '/started.json', receipt); return { id, state };
        }
        expect(same(await json(wt, local(id) + '/assignment.json'), stamp(job)), 'LOCAL_ASSIGNMENT_MISMATCH');
        receiptValid(job, await json(wt, local(id) + '/started.json'), 'STARTED');
        const report = reportText === undefined ? await read(wt, job.report) : Buffer.from(reportText);
        expect(report.length > 0 && report.length <= 2 * 1024 * 1024, 'REPORT_SIZE');
        await publish(wt, job.report, report);
        const receipt = { ...stamp(job), state, reportSHA: digest(report) };
        await put(wt, job.receipt, receipt); return { id, state, reportSHA: receipt.reportSHA };
      }
    },
    async poll(pmPath, { notify: send = false } = {}) {
      const pm = await worktree(pmPath); await pmContext(pm);
      {
        const directory = await confined(pm, '.codaryn/pm-comms/registry');
        const names = await fs.readdir(directory).catch(error => { if (absent(error)) return []; throw error; });
        const rows = [];
        for (const file of names.sort()) {
          if (!/^[a-z0-9][a-z0-9-]{0,63}\.json$/.test(file)) continue;
          const id = file.slice(0, -5);
          try {
            const registered = await load(pm, id, false), done = await closed(pm, registered);
            if (done) { rows.push(done); continue; }
            const job = await load(pm, id), row = await collect(pm, job);
            try { rows.push(send ? await notify(pm, job, row) : row); }
            catch (error) { rows.push({ ...row, notification: 'queued', error: error.code ?? 'CONTROL_ERROR' }); }
          } catch (error) { rows.push({ id, state: 'REJECTED', error: error.code ?? 'CONTROL_ERROR' }); }
        }
        return rows;
      }
    },
    async ack(pmPath, id, reportSHA, readConfirmed) {
      expect(hash(reportSHA) && readConfirmed === true, 'EXPLICIT_READ_REQUIRED');
      const pm = await worktree(pmPath); await pmContext(pm);
      {
        const registered = await load(pm, id, false), done = await closed(pm, registered);
        if (done) { expect(done.reportSHA === reportSHA, 'ACK_NOT_READY'); return done; }
        const job = await load(pm, id), row = await collect(pm, job);
        expect(['READY', 'ACK'].includes(row.state) && row.reportSHA === reportSHA && row.acceptanceReady, 'ACK_NOT_READY');
        const ready = await json(pm, '.codaryn/pm-comms/inbox/' + id + '.' + reportSHA + '.ready.json');
        await put(pm, '.codaryn/pm-comms/ack/' + id + '.' + reportSHA + '.json', { ...ready, state: 'ACK' });
        return { id, state: 'ACK', reportSHA };
      }
    },
  };
}

const HELP = `pm-session-comms (files first; no automatic prompts)
PM: run from canonical management main cwd; node scripts/pm-session-comms.mjs <command> is allowed there.
Worker: keep registered worktree cwd and use the absolute canonical main script below, never its worker copy.
projectRoot comes from script location; no Git-root inference or environment change.
register --pm WT --id ID --worker NAME --pane ID --worktree WT --task-file .codaryn/pm-tools/ID.md --task-sha SHA256 --report .codaryn/session-comms/ID/report.md --receipt .codaryn/session-comms/ID/ready.json [--subject-base SHA1] [--subject-target SHA1] [--checkout-head SHA1 --checkout-branch BRANCH|DETACHED]
dispatch --pm WT --id ID [--send] [--pm-pane w3:p3]
node D:/project/Codaryn/scripts/pm-session-comms.mjs started --pm WT --worktree WT --id ID --worker NAME
node D:/project/Codaryn/scripts/pm-session-comms.mjs ready --pm WT --worktree WT --id ID --worker NAME
Default ready: finish writing the registered report.md first, then run ready without --stdin (noninteractive).
Optional ready --stdin: pipe report bytes and explicitly close stdin/EOF; otherwise it waits for input.
poll --pm WT [--notify] [--pm-pane w3:p3]
ack --pm WT --id ID --sha SHA256 --read
watch --pm WT [--notify] [--pm-pane w3:p3] [--interval-ms 2000] [--iterations N]
Only explicit --send/--notify invokes agent prompt. Worker READY is the final action; stop after it.
`;
export async function cli(argv, { api, output = value => console.log(JSON.stringify(value)),
  input = async () => { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); return Buffer.concat(chunks); },
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), } = {}) {
  if (argv.length === 0 || argv[0] === '--help') { output({ help: HELP }); return; }
  const [command, ...args] = argv, flags = {};
  const boolean = new Set(['send', 'notify', 'stdin', 'read']);
  const allowed = {
    register: ['pm', 'id', 'worker', 'pane', 'worktree', 'task-file', 'task-sha', 'report', 'receipt', 'subject-base', 'subject-target', 'checkout-head', 'checkout-branch'],
    dispatch: ['pm', 'id', 'send', 'pm-pane'], started: ['pm', 'worktree', 'id', 'worker'], ready: ['pm', 'worktree', 'id', 'worker', 'stdin'],
    poll: ['pm', 'notify', 'pm-pane'], ack: ['pm', 'id', 'sha', 'read'], watch: ['pm', 'notify', 'pm-pane', 'interval-ms', 'iterations'],
  }[command];
  expect(allowed, 'COMMAND_INVALID');
  for (let i = 0; i < args.length; i++) {
    const key = args[i].slice(2);
    expect(args[i].startsWith('--') && allowed.includes(key) && !(key in flags), 'ARGUMENT_INVALID');
    flags[key] = boolean.has(key) ? true : args[++i];
    expect(flags[key] !== undefined, 'ARGUMENT_VALUE');
  }
  const f = flags;
  expect(f['pm-pane'] === undefined || f['pm-pane'] === PANES['codex-review'], 'PM_CONTEXT');
  api ??= createComms({ pmPane: f['pm-pane'] });
  if (command === 'register') {
    expect(Boolean(f['checkout-head']) === Boolean(f['checkout-branch']), 'CHECKOUT_PAIR');
    output(await api.register(f.pm, { id: f.id, worker: f.worker, pane: f.pane, worktree: f.worktree,
      taskFile: f['task-file'], taskSHA: f['task-sha'], report: f.report, receipt: f.receipt,
      subject: { base: f['subject-base'] ?? null, target: f['subject-target'] ?? null },
      checkout: f['checkout-head'] ? { head: f['checkout-head'], branch: f['checkout-branch'] === 'DETACHED' ? null : f['checkout-branch'] } : null }));
  } else if (command === 'dispatch') output(await api.dispatch(f.pm, f.id, { send: !!f.send }));
  else if (command === 'started' || command === 'ready') output(await api.worker(command === 'started' ? 'STARTED' : 'READY', f.pm, f.worktree, f.id, f.worker, f.stdin ? await input() : undefined));
  else if (command === 'ack') output(await api.ack(f.pm, f.id, f.sha, !!f.read));
  else if (command === 'poll') output(await api.poll(f.pm, { notify: !!f.notify }));
  else {
    await api.checkPM(f.pm);
    const interval = Number(f['interval-ms'] ?? 2000), iterations = Number(f.iterations ?? Infinity);
    expect(Number.isInteger(interval) && interval >= 100 && interval <= 60000 && (iterations === Infinity || Number.isSafeInteger(iterations) && iterations > 0), 'WATCH_LIMIT');
    for (let i = 0; i < iterations; i++) {
      try { output(await api.poll(f.pm, { notify: !!f.notify })); }
      catch (error) { output({ state: 'queued', error: error.code ?? 'CONTROL_ERROR' }); }
      if (i + 1 < iterations) await sleep(interval);
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch(error => { console.error(JSON.stringify({ error: error.code ?? 'CONTROL_ERROR' })); process.exitCode = 1; });
}
