const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../src/summarize.js');

const NOW = Date.parse('2026-09-03T12:00:00Z');
const day = 864e5;
const at = (hoursAgo) => new Date(NOW - hoursAgo * 3600e3).toISOString();

function push(repo, branch, msgs, hoursAgo = 1) {
  return {
    type: 'PushEvent',
    actor: { login: 'alice', avatar_url: 'https://avatars/alice' },
    repo: { name: repo },
    created_at: at(hoursAgo),
    payload: { ref: `refs/heads/${branch}`, size: msgs.length, commits: msgs.map((m, i) => ({ sha: `${i}abcdef0`.padEnd(40, '0'), message: m })) },
  };
}
function pr(repo, number, action, merged, title, hoursAgo = 1) {
  return {
    type: 'PullRequestEvent',
    actor: { login: 'alice', avatar_url: 'https://avatars/alice' },
    repo: { name: repo },
    created_at: at(hoursAgo),
    payload: { action, pull_request: { number, title, merged, html_url: `https://github.com/${repo}/pull/${number}` } },
  };
}

test('normalizeRest: push keeps first line of commit message and branch', () => {
  const it = S.normalizeRest(push('o/r', 'main', ['feat: x\n\nlong body', 'fix: y']));
  assert.equal(it.kind, 'push');
  assert.equal(it.branch, 'main');
  assert.deepEqual(it.commits.map((c) => c.message), ['feat: x', 'fix: y']);
  assert.match(it.commits[0].url, /\/o\/r\/commit\/0abcdef0/);
});

test('normalizeRest: PR closed+merged → pr_merge, closed unmerged → pr_close', () => {
  assert.equal(S.normalizeRest(pr('o/r', 1, 'closed', true, 't')).kind, 'pr_merge');
  assert.equal(S.normalizeRest(pr('o/r', 1, 'closed', false, 't')).kind, 'pr_close');
  assert.equal(S.normalizeRest(pr('o/r', 1, 'opened', false, 't')).kind, 'pr_open');
});

test('normalizeRest: IssueCommentEvent on a PR is pr_comment', () => {
  const it = S.normalizeRest({
    type: 'IssueCommentEvent', actor: { login: 'a' }, repo: { name: 'o/r' }, created_at: at(1),
    payload: { issue: { number: 9, title: 'T', pull_request: {} }, comment: { html_url: 'https://github.com/o/r/pull/9#c' } },
  });
  assert.equal(it.kind, 'pr_comment');
  assert.equal(it.url, 'https://github.com/o/r/pull/9#c');
});

test('summarize: groups by user then repo, dedupes commits, merges PR states', () => {
  const items = [
    push('o/r', 'main', ['feat: a', 'feat: a', 'Merge branch x'], 1),
    push('o/r', 'dev', ['fix: b'], 2),
    pr('o/r', 5, 'opened', false, 'Add thing', 3),
    pr('o/r', 5, 'closed', true, 'Add thing', 1),
    pr('o/other', 7, 'opened', false, 'Other', 5),
    { type: 'WatchEvent', actor: { login: 'alice' }, repo: { name: 'x/y' }, created_at: at(4), payload: { action: 'started' } },
    // 超出时间窗口的应被过滤
    push('o/old', 'main', ['ancient'], 24 * 30),
  ].map(S.normalizeRest);

  const out = S.summarize({ alice: { avatar: 'https://avatars/alice', items }, bob: { items: [] } }, { nowMs: NOW, sinceMs: NOW - 7 * day, lang: 'zh' });

  assert.equal(out.users.length, 1);
  assert.deepEqual(out.quiet.map((q) => q.login), ['bob']);
  const alice = out.users[0];
  assert.equal(alice.login, 'alice');
  assert.deepEqual(alice.repos.map((r) => r.name), ['o/r', 'o/other', 'Star 了 1 个仓库']);
  assert.match(alice.headline, /2 个仓库/);
  assert.match(alice.headline, /star 1 个/);
  assert.match(alice.headline, /推送 2 次/);
  assert.match(alice.headline, /2 个 PR/);

  const r = alice.repos[0];
  const pushLine = r.lines.find((l) => l.kind === 'push');
  assert.equal(pushLine.text, '推送 2 次，4 个提交到 main, dev');
  assert.deepEqual(pushLine.sub.map((s) => s.text), ['feat: a', 'fix: b']);

  const prLines = r.lines.filter((l) => l.kind.startsWith('pr_'));
  assert.equal(prLines.length, 1, 'PR #5 应只出现一次，取最新状态');
  assert.equal(prLines[0].kind, 'pr_merge');
  assert.equal(prLines[0].text, '合并 PR #5：Add thing');

  const star = alice.repos[2];
  assert.equal(star.type, 'stars');
  assert.deepEqual(star.repos, [{ name: 'x/y', url: 'https://github.com/x/y' }]);
  assert.deepEqual(star.chips, [{ kind: 'star', label: 'Star', n: 1 }]);
});

test('summarize: users sorted by latest activity, repos by event count', () => {
  const byUser = {
    early: { items: [S.normalizeRest(push('a/b', 'main', ['x'], 10))] },
    late: { items: [S.normalizeRest(push('c/d', 'main', ['y'], 1)), S.normalizeRest(push('c/e', 'main', ['z', 'w'], 2)), S.normalizeRest(push('c/e', 'main', ['q'], 3))] },
  };
  const out = S.summarize(byUser, { nowMs: NOW, sinceMs: NOW - day, lang: 'zh' });
  assert.deepEqual(out.users.map((u) => u.login), ['late', 'early']);
  assert.deepEqual(out.users[0].repos.map((r) => r.name), ['c/e', 'c/d']);
});

test('summarize: caps PR list and adds "还有 N 个" tail', () => {
  const items = [];
  for (let i = 1; i <= 9; i++) items.push(S.normalizeRest(pr('o/r', i, 'opened', false, `PR ${i}`, i)));
  const out = S.summarize({ a: { items } }, { nowMs: NOW, sinceMs: NOW - day, maxLines: 3, lang: 'zh' });
  const lines = out.users[0].repos[0].lines;
  assert.equal(lines.filter((l) => l.kind === 'pr_open' && !l.text.startsWith('…')).length, 3);
  assert.equal(lines[lines.length - 1].text, '…还有 6 个 PR');
});

test('parseAtom: real feed fixture yields typed items with repos', () => {
  const fixture = path.join(__dirname, 'fixtures', 'appleboy.atom');
  if (!fs.existsSync(fixture)) return; // fixture 不入库时跳过
  const xml = fs.readFileSync(fixture, 'utf8');
  const items = S.parseAtom(xml, 'appleboy');
  assert.ok(items.length >= 20, `got ${items.length}`);
  for (const it of items) {
    assert.match(it.repo, /^[^/]+\/[^/]+$/);
    assert.ok(it.kind);
    assert.ok(!isNaN(Date.parse(it.at)));
  }
  const star = items.find((i) => i.kind === 'star');
  assert.equal(star.repo, 'JuliusBrussee/caveman');
  const pushes = items.filter((i) => i.kind === 'push');
  assert.ok(pushes.length > 0);
  assert.ok(pushes.some((p) => p.commits.length > 0), 'push entries should carry commit messages');
  assert.ok(pushes.every((p) => p.branch), 'push entries should carry a branch');
});

test('parseAtom: synthetic entry', () => {
  const xml = `<feed><entry>
    <id>tag:github.com,2008:PullRequestEvent/123</id>
    <published>2026-09-02 06:37:14 -0700</published>
    <link type="text/html" rel="alternate" href="https://github.com/o/r/pull/42"/>
    <title type="html">alice merged a pull request in o/r</title>
    <author><name>alice</name></author>
    <content type="html">&lt;a class="Link--primary text-bold" href="/o/r/pull/42"&gt;Fix &amp;amp; polish&lt;/a&gt;</content>
  </entry></feed>`;
  const [it] = S.parseAtom(xml, 'alice');
  assert.equal(it.kind, 'pr_merge');
  assert.equal(it.repo, 'o/r');
  assert.equal(it.number, 42);
  assert.equal(it.title, 'Fix & polish');
  assert.equal(it.at, '2026-09-02T13:37:14.000Z');
});

test('summarize: English output and star merge', () => {
  const items = [
    push('o/r', 'main', ['feat: a'], 1),
    { type: 'WatchEvent', actor: { login: 'alice' }, repo: { name: 'x/y' }, created_at: at(2), payload: {} },
    { type: 'WatchEvent', actor: { login: 'alice' }, repo: { name: 'x/z' }, created_at: at(3), payload: {} },
    { type: 'ForkEvent', actor: { login: 'alice' }, repo: { name: 'x/z' }, created_at: at(3), payload: { forkee: { full_name: 'alice/z' } } },
  ].map(S.normalizeRest);
  const out = S.summarize({ alice: { items } }, { nowMs: NOW, sinceMs: NOW - day, lang: 'en' });
  const u = out.users[0];
  assert.equal(u.headline, '1 repo · 1 push · 2 stars · 1 fork');
  assert.deepEqual(u.repos.map((r) => [r.type, r.name]), [['repo', 'o/r'], ['stars', 'Starred 2 repos'], ['forks', 'Forked 1 repo']]);
  assert.equal(u.repos[0].lines[0].text, '1 push, 1 commit to main');
  assert.deepEqual(u.repos[1].repos.map((r) => r.name), ['x/y', 'x/z']);
});

test('summarize: push with zero commits does not say "0 commits"', () => {
  const ev = push('o/r', 'main', [], 1);
  ev.payload.size = 0;
  const out = S.summarize({ a: { items: [S.normalizeRest(ev)] } }, { nowMs: NOW, sinceMs: NOW - day, lang: 'zh' });
  assert.equal(out.users[0].repos[0].lines[0].text, '推送 1 次到 main');
});

test('i18n: plural tokens', () => {
  const I = require('../src/i18n.js');
  assert.equal(I.t('en', 'headline.repos', { n: 1 }), '1 repo');
  assert.equal(I.t('en', 'headline.repos', { n: 3 }), '3 repos');
  assert.equal(I.t('en', 'line.push', { n: 1, c: 2, to: ' to main' }), '1 push, 2 commits to main');
  assert.equal(I.t('zh', 'headline.repos', { n: 1 }), '1 个仓库');
  assert.equal(I.resolve('auto', 'zh-CN'), 'zh');
  assert.equal(I.resolve('auto', 'en-US'), 'en');
  assert.equal(I.resolve('zh', 'en-US'), 'zh');
});
