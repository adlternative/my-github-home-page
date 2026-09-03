/*
 * summarize.js — 纯函数模块，无 DOM / chrome 依赖。
 * 同时被 background service worker (importScripts) 和 node --test 使用。依赖 i18n.js（GHI18n）。
 *
 * 数据流：GitHub 事件 (REST JSON 或 .atom 条目)  →  normalize*()  →  统一的 item
 *        item[]  →  summarize()  →  { users: [{ login, repos: [{ name, lines }] }] }
 *
 * item 结构：
 *   { kind, actor, avatar, repo, at, url, title, number, branch, tag, commits: [{sha, message, url}] }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./i18n.js'));
  else root.GHSummary = factory(root.GHI18n);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (I18N) {
  'use strict';

  const GH = 'https://github.com';

  // ---------- 归一化：REST /users/{u}/events/public ----------

  function normalizeRest(ev) {
    const p = ev.payload || {};
    const repo = ev.repo && ev.repo.name;
    if (!repo) return null;
    const base = {
      actor: ev.actor && ev.actor.login,
      avatar: ev.actor && ev.actor.avatar_url,
      repo,
      at: ev.created_at,
      url: `${GH}/${repo}`,
    };
    switch (ev.type) {
      case 'PushEvent': {
        const branch = (p.ref || '').replace(/^refs\/heads\//, '');
        const commits = (p.commits || []).map((c) => ({
          sha: c.sha,
          message: firstLine(c.message),
          url: `${GH}/${repo}/commit/${c.sha}`,
        }));
        return { ...base, kind: 'push', branch, size: p.size || commits.length, distinct: p.distinct_size, commits };
      }
      case 'PullRequestEvent': {
        const pr = p.pull_request || {};
        let kind = 'pr_other';
        if (p.action === 'opened' || p.action === 'reopened') kind = 'pr_open';
        else if (p.action === 'closed') kind = pr.merged ? 'pr_merge' : 'pr_close';
        return { ...base, kind, number: pr.number, title: pr.title, url: pr.html_url || base.url };
      }
      case 'PullRequestReviewEvent': {
        const pr = p.pull_request || {};
        return { ...base, kind: 'pr_review', number: pr.number, title: pr.title, url: pr.html_url || base.url, state: p.review && p.review.state };
      }
      case 'PullRequestReviewCommentEvent': {
        const pr = p.pull_request || {};
        return { ...base, kind: 'pr_comment', number: pr.number, title: pr.title, url: (p.comment && p.comment.html_url) || pr.html_url || base.url };
      }
      case 'IssuesEvent': {
        const is = p.issue || {};
        let kind = 'issue_other';
        if (p.action === 'opened' || p.action === 'reopened') kind = 'issue_open';
        else if (p.action === 'closed') kind = 'issue_close';
        return { ...base, kind, number: is.number, title: is.title, url: is.html_url || base.url };
      }
      case 'IssueCommentEvent': {
        const is = p.issue || {};
        const isPr = !!is.pull_request;
        return { ...base, kind: isPr ? 'pr_comment' : 'issue_comment', number: is.number, title: is.title, url: (p.comment && p.comment.html_url) || is.html_url || base.url };
      }
      case 'CreateEvent': {
        if (p.ref_type === 'repository') return { ...base, kind: 'create_repo' };
        if (p.ref_type === 'branch') return { ...base, kind: 'create_branch', branch: p.ref, url: `${GH}/${repo}/tree/${p.ref}` };
        if (p.ref_type === 'tag') return { ...base, kind: 'create_tag', tag: p.ref, url: `${GH}/${repo}/releases/tag/${p.ref}` };
        return { ...base, kind: 'other', title: `create ${p.ref_type}` };
      }
      case 'DeleteEvent': {
        if (p.ref_type === 'branch') return { ...base, kind: 'delete_branch', branch: p.ref };
        if (p.ref_type === 'tag') return { ...base, kind: 'delete_tag', tag: p.ref };
        return { ...base, kind: 'other', title: `delete ${p.ref_type}` };
      }
      case 'ReleaseEvent': {
        const r = p.release || {};
        return { ...base, kind: 'release', tag: r.tag_name, title: r.name || r.tag_name, url: r.html_url || base.url };
      }
      case 'WatchEvent':
        return { ...base, kind: 'star' };
      case 'ForkEvent':
        return { ...base, kind: 'fork', title: p.forkee && p.forkee.full_name };
      case 'PublicEvent':
        return { ...base, kind: 'public' };
      case 'CommitCommentEvent':
        return { ...base, kind: 'commit_comment', url: (p.comment && p.comment.html_url) || base.url };
      case 'GollumEvent':
        return { ...base, kind: 'wiki', url: `${GH}/${repo}/wiki` };
      case 'MemberEvent':
        return { ...base, kind: 'member', title: p.member && p.member.login };
      default:
        return { ...base, kind: 'other', title: ev.type };
    }
  }

  // ---------- 归一化：github.com/{user}.atom（无 token 降级） ----------
  // 服务工作线程里没有 DOMParser，用正则解析。feed 是机器生成的规整 XML，足够可靠。

  function parseAtom(xml, fallbackActor) {
    const entries = [];
    const re = /<entry>([\s\S]*?)<\/entry>/g;
    let m;
    while ((m = re.exec(xml))) {
      const item = normalizeAtomEntry(m[1], fallbackActor);
      if (item) entries.push(item);
    }
    return entries;
  }

  function normalizeAtomEntry(block, fallbackActor) {
    const published = tagText(block, 'published') || tagText(block, 'updated') || '';
    const at = toIso(published);
    const link = (block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || [])[1] || '';
    const actor = tagText(block, 'name') || fallbackActor;
    const avatar = (block.match(/<media:thumbnail[^>]*url="([^"]+)"/) || [])[1];
    const content = decodeEntities(tagText(block, 'content') || '');
    // content 里有 GitHub 自己打的类型注释：<!-- push --> / <!-- pull_request --> / <!-- watch --> …
    const marker = (content.match(/<!--\s*([a-z_]+)\s*-->/) || [])[1] || '';
    // 标题行："actor pushed to main in owner/repo" —— 取 actor 链接之后、时间戳之前的文本；没有就退回 atom 的 <title>
    const headline = headlineText(content, actor) || decodeEntities(stripTags(tagText(block, 'title') || '')).replace(new RegExp('^' + escapeRe(actor) + '\\s+'), '');

    const repo = repoFromUrl(link) || repoFromHeadline(headline);
    if (!repo) return null;
    const base = { actor, avatar: avatar && avatar.replace(/[?&]s=\d+/, ''), repo, at, url: link || `${GH}/${repo}` };
    const number = +((content.match(/aria-label="[^"]*#(\d+)"/) || link.match(/\/(?:pull|issues)\/(\d+)/) || [])[1] || 0);
    const h = headline.toLowerCase();
    const branchOf = () => {
      const m = content.match(/class="[^"]*branch-name[^"]*"[^>]*(?:title="([^"]+)")?[^>]*>([^<]+)</);
      return m ? (m[1] || m[2]).trim().replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, '') : '';
    };

    if (marker === 'push' || /\bpushed\b/.test(h)) {
      const commits = [];
      const seen = new Set();
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
      let li;
      while ((li = liRe.exec(content))) {
        const sha = (li[1].match(/\/commit\/([0-9a-f]{7,40})"/) || [])[1];
        const msg = (li[1].match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/) || [])[1];
        if (!sha || seen.has(sha)) continue;
        seen.add(sha);
        commits.push({ sha, message: firstLine(decodeEntities(stripTags(msg || '')).trim()), url: `${GH}/${repo}/commit/${sha}` });
      }
      const sizeM = content.match(/(\d+)\s+commits?\s+to/);
      return { ...base, kind: 'push', branch: branchOf(), size: sizeM ? +sizeM[1] : commits.length, commits };
    }
    if (marker === 'watch' || /\bstarred\b/.test(h)) return { ...base, kind: 'star', url: `${GH}/${repo}` };
    if (marker === 'fork' || /\bforked\b/.test(h)) return { ...base, kind: 'fork' };
    if (marker === 'release' || /\breleased\b/.test(h)) {
      return { ...base, kind: 'release', title: boldTitle(content) || (headline.match(/released (\S+)/) || [])[1], tag: (headline.match(/released (\S+)/) || [])[1] };
    }
    if (marker === 'create' || /\bcreated (a |an )?(repository|branch|tag)/.test(h)) {
      if (/repository/.test(h)) return { ...base, kind: 'create_repo', url: `${GH}/${repo}` };
      if (/\btag\b/.test(h)) return { ...base, kind: 'create_tag', tag: branchOf() };
      return { ...base, kind: 'create_branch', branch: branchOf() };
    }
    if (marker === 'delete' || /\bdeleted\b/.test(h)) {
      if (/\btag\b/.test(h)) return { ...base, kind: 'delete_tag', tag: branchOf() };
      return { ...base, kind: 'delete_branch', branch: branchOf() };
    }
    if (marker === 'pull_request' || /\/pull\/\d+/.test(link)) {
      let kind = 'pr_other';
      if (/\bmerged\b/.test(h)) kind = 'pr_merge';
      else if (/\b(opened|reopened)\b/.test(h)) kind = 'pr_open';
      else if (/\bclosed\b/.test(h)) kind = 'pr_close';
      else if (/\b(reviewed|approved|requested changes)\b/.test(h)) kind = 'pr_review';
      else if (/\bcommented\b/.test(h)) kind = 'pr_comment';
      return { ...base, kind, number, title: boldTitle(content) };
    }
    if (marker === 'pull_request_review' || marker === 'pull_request_review_comment') {
      return { ...base, kind: marker === 'pull_request_review' ? 'pr_review' : 'pr_comment', number, title: boldTitle(content) };
    }
    if (marker === 'issues_comment' || marker === 'issue_comment' || /\bcommented on\b/.test(h)) {
      const isPr = /\/pull\//.test(link);
      return { ...base, kind: isPr ? 'pr_comment' : 'issue_comment', number, title: boldTitle(content) };
    }
    if (marker === 'issues' || /\/issues\/\d+/.test(link)) {
      let kind = 'issue_other';
      if (/\b(opened|reopened)\b/.test(h)) kind = 'issue_open';
      else if (/\bclosed\b/.test(h)) kind = 'issue_close';
      return { ...base, kind, number, title: boldTitle(content) };
    }
    if (marker === 'public' || /\bmade .* public\b/.test(h)) return { ...base, kind: 'public' };
    if (marker === 'gollum' || /\bwiki\b/.test(h)) return { ...base, kind: 'wiki' };
    if (marker === 'member') return { ...base, kind: 'member' };
    return { ...base, kind: 'other', title: headline || marker };
  }

  // 取 "<a ...>actor</a> pushed to main in <a>owner/repo</a> · <relative-time>" 中间那段纯文本
  function headlineText(content, actor) {
    const idx = content.indexOf('>' + actor + '</a>');
    if (idx < 0) return '';
    const rest = content.slice(idx + actor.length + 5);
    const cut = rest.search(/<relative-time|<div class="Box/);
    return decodeEntities(stripTags(cut >= 0 ? rest.slice(0, cut) : rest.slice(0, 400))).replace(/·\s*$/, '').trim();
  }
  function repoFromHeadline(headline) {
    const m = headline.match(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:#\d+)?\s*$/);
    return m ? m[1] : '';
  }
  // PR / issue / release 标题：aria-label 里的标题最干净，其次是粗体链接文本
  function boldTitle(content) {
    const m = content.match(/<a class="color-fg-default text-bold"[^>]*aria-label="([^"]+)"/);
    if (m) return firstLine(decodeEntities(m[1]));
    const m2 = content.match(/class="[^"]*\btext-bold\b[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    if (!m2) return '';
    const text = decodeEntities(stripTags(m2[1])).trim();
    return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text) ? '' : firstLine(text);
  }

  // ---------- 汇总 ----------

  // 仓库排序权重：真正干活的事件排在 star / fork 前面
  const KIND_WEIGHT = { push: 2, pr_merge: 3, pr_open: 2, release: 3, issue_open: 1.5, star: 0.3, fork: 0.5, delete_branch: 0.2, create_branch: 0.5 };
  // 只有这些事件的仓库会被合并成一条「Star 了 N 个仓库」
  const PASSIVE = new Set(['star', 'fork']);
  const CHIP_ORDER = ['push', 'pr_merge', 'pr_open', 'pr_close', 'pr_review', 'pr_comment', 'issue_open', 'issue_close', 'issue_comment', 'release', 'create_tag', 'create_branch', 'create_repo', 'star', 'fork', 'public', 'wiki'];

  /**
   * @param {object} byUser  { login: { avatar, items: item[] } }  — 每个关注的人的事件
   * @param {object} opts    { sinceMs, nowMs, maxLines, lang: 'zh' | 'en' }
   */
  function summarize(byUser, opts) {
    const now = (opts && opts.nowMs) || Date.now();
    const since = (opts && opts.sinceMs) || now - 7 * 864e5;
    const maxLines = (opts && opts.maxLines) || 6;
    const lang = (opts && opts.lang) || 'en';
    const T = (key, params) => I18N.t(lang, key, params);
    const users = [];
    const quiet = [];

    for (const login of Object.keys(byUser)) {
      const entry = byUser[login] || {};
      const items = (entry.items || []).filter((it) => {
        const t = Date.parse(it.at);
        return t >= since && t <= now + 864e5;
      });
      if (!items.length) {
        quiet.push({ login, avatar: entry.avatar });
        continue;
      }
      const repos = groupRepos(items, maxLines, T);
      const counts = countKinds(items);
      users.push({
        login,
        avatar: entry.avatar || items[0].avatar,
        latest: maxAt(items),
        count: items.length,
        score: items.reduce((w, it) => w + (KIND_WEIGHT[it.kind] ?? 1), 0), // 「活动量」排序用：写代码的事件权重高，star 很低
        counts,
        headline: userHeadline(repos, counts, items, T),
        repos,
      });
    }

    users.sort((a, b) => Date.parse(b.latest) - Date.parse(a.latest));
    quiet.sort((a, b) => a.login.localeCompare(b.login));
    return { users, quiet, since: new Date(since).toISOString(), generatedAt: new Date(now).toISOString(), lang };
  }

  function groupRepos(items, maxLines, T) {
    const map = new Map();
    for (const it of items) {
      if (!map.has(it.repo)) map.set(it.repo, []);
      map.get(it.repo).push(it);
    }
    const repos = [];
    const passive = []; // 只被 star / fork 过的仓库
    for (const [name, list] of map) {
      list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      if (list.every((it) => PASSIVE.has(it.kind))) {
        passive.push({ name, url: `${GH}/${name}`, latest: list[0].at, kinds: uniq(list.map((it) => it.kind)) });
        continue;
      }
      const counts = countKinds(list);
      repos.push({
        type: 'repo',
        name,
        url: `${GH}/${name}`,
        latest: list[0].at,
        count: list.length,
        weight: list.reduce((w, it) => w + (KIND_WEIGHT[it.kind] ?? 1), 0),
        counts,
        chips: chips(counts, T),
        lines: describeRepo(list, counts, maxLines, T),
      });
    }
    repos.sort((a, b) => b.weight - a.weight || Date.parse(b.latest) - Date.parse(a.latest));

    // star / fork 合并成一条，放最后
    const stars = passive.filter((p) => p.kinds.includes('star'));
    const forks = passive.filter((p) => p.kinds.includes('fork'));
    if (stars.length) repos.push(passiveGroup('stars', stars, T('stars.title', { n: stars.length }), 'star', T));
    if (forks.length) repos.push(passiveGroup('forks', forks, T('forks.title', { n: forks.length }), 'fork', T));
    return repos;
  }

  function passiveGroup(type, list, title, kind, T) {
    const sorted = [...list].sort((a, b) => Date.parse(b.latest) - Date.parse(a.latest));
    return {
      type,
      name: title,
      url: '',
      latest: sorted[0].latest,
      count: sorted.length,
      weight: 0,
      counts: { [kind]: sorted.length },
      chips: [{ kind, label: T(`kind.${kind}`), n: sorted.length }],
      lines: [],
      repos: sorted.map((p) => ({ name: p.name, url: p.url })),
    };
  }

  function countKinds(list) {
    const c = {};
    for (const it of list) c[it.kind] = (c[it.kind] || 0) + 1;
    return c;
  }

  function chips(counts, T) {
    return CHIP_ORDER.filter((k) => counts[k]).map((k) => ({ kind: k, label: T(`kind.${k}`), n: counts[k] }));
  }

  function userHeadline(repos, counts, items, T) {
    const parts = [];
    const realRepos = repos.filter((r) => r.type === 'repo').length;
    if (realRepos) parts.push(T('headline.repos', { n: realRepos }));
    if (counts.push) parts.push(T('headline.pushes', { n: counts.push }));
    // 同一个 PR 的 open + merge 只算一个
    const distinct = (kinds) => new Set(items.filter((it) => kinds.includes(it.kind) && it.number).map((it) => `${it.repo}#${it.number}`)).size;
    const prs = distinct(['pr_open', 'pr_merge', 'pr_close']);
    const issues = distinct(['issue_open', 'issue_close']);
    if (prs) parts.push(T('headline.prs', { n: prs }));
    if (counts.pr_review) parts.push(T('headline.reviews', { n: counts.pr_review }));
    if (issues) parts.push(T('headline.issues', { n: issues }));
    if (counts.release) parts.push(T('headline.releases', { n: counts.release }));
    if (counts.star) parts.push(T('headline.stars', { n: counts.star }));
    if (counts.fork) parts.push(T('headline.forks', { n: counts.fork }));
    return parts.join(' · ');
  }

  /** 把一个仓库下的事件压缩成几行人话。每行 { kind, text, url, sub: [{text,url}], more } */
  function describeRepo(list, counts, maxLines, T) {
    const lines = [];
    const repo = list[0].repo;

    // 推送：合并所有 push，列出去重后的提交信息
    const pushes = list.filter((x) => x.kind === 'push');
    if (pushes.length) {
      const branches = uniq(pushes.map((p) => p.branch).filter(Boolean));
      const total = pushes.reduce((n, p) => n + (p.size || (p.commits || []).length), 0);
      const seen = new Set();
      const sub = [];
      for (const p of pushes) {
        for (const c of p.commits || []) {
          const key = c.message.toLowerCase();
          if (!c.message || seen.has(key)) continue;
          if (/^merge (branch|pull request|remote-tracking)/i.test(c.message)) continue;
          seen.add(key);
          sub.push({ text: c.message, url: c.url });
        }
      }
      const shown = sub.slice(0, 4);
      const to = branches.length ? T('line.push_to', { branches: branches.slice(0, 3).join(', ') + (branches.length > 3 ? T('line.etc') : '') }) : '';
      lines.push({
        kind: 'push',
        text: total ? T('line.push', { n: pushes.length, c: total, to }) : T('line.push_nocommits', { n: pushes.length, to }),
        url: pushes[0].branch ? `${GH}/${repo}/commits/${pushes[0].branch}` : pushes[0].url,
        sub: shown,
        more: sub.length - shown.length,
      });
    }

    // PR / issue：按编号去重，取最新状态
    pushNumbered(lines, list, ['pr_open', 'pr_merge', 'pr_close', 'pr_other'], 'pr', maxLines, T);
    pushNumbered(lines, list, ['issue_open', 'issue_close', 'issue_other'], 'issue', maxLines, T);

    // 评审 / 评论：聚合
    pushAggregated(lines, list, 'pr_review', 'line.reviews', T);
    pushAggregated(lines, list, 'pr_comment', 'line.pr_comments', T);
    pushAggregated(lines, list, 'issue_comment', 'line.issue_comments', T);

    for (const r of list.filter((x) => x.kind === 'release')) {
      lines.push({ kind: 'release', text: T('line.release', { name: r.title || r.tag || '' }).trim(), url: r.url });
    }
    const tags = uniq(list.filter((x) => x.kind === 'create_tag').map((x) => x.tag).filter(Boolean));
    if (tags.length) lines.push({ kind: 'create_tag', text: T('line.tags', { tags: tags.slice(0, 5).join(', ') }), url: `${GH}/${repo}/tags` });
    const nb = uniq(list.filter((x) => x.kind === 'create_branch').map((x) => x.branch).filter(Boolean));
    if (nb.length) lines.push({ kind: 'create_branch', text: T('line.new_branches', { b: nb.slice(0, 4).join(', '), more: nb.length > 4 ? T('line.more_n', { n: nb.length - 4 }) : '' }), url: `${GH}/${repo}/branches` });
    const db = uniq(list.filter((x) => x.kind === 'delete_branch').map((x) => x.branch).filter(Boolean));
    if (db.length && !lines.length) lines.push({ kind: 'delete_branch', text: T('line.deleted_branches', { b: db.slice(0, 4).join(', '), more: db.length > 4 ? T('line.more_n', { n: db.length - 4 }) : '' }) });

    if (counts.create_repo) lines.push({ kind: 'create_repo', text: T('line.create_repo'), url: `${GH}/${repo}` });
    if (counts.public) lines.push({ kind: 'public', text: T('line.public'), url: `${GH}/${repo}` });
    if (counts.fork) lines.push({ kind: 'fork', text: T('line.fork'), url: `${GH}/${repo}` });
    if (counts.star) lines.push({ kind: 'star', text: T('line.star'), url: `${GH}/${repo}` });
    if (counts.wiki) lines.push({ kind: 'wiki', text: T('line.wiki'), url: `${GH}/${repo}/wiki` });
    if (counts.commit_comment) lines.push({ kind: 'commit_comment', text: T('line.commit_comments', { n: counts.commit_comment }) });
    if (counts.member) lines.push({ kind: 'member', text: T('line.member') });

    return lines;
  }

  function pushNumbered(lines, list, kinds, noun, maxLines, T) {
    const byNum = new Map();
    for (const it of list) {
      if (!kinds.includes(it.kind) || !it.number) continue;
      // list 已按时间倒序，第一个出现的就是最新状态
      if (!byNum.has(it.number)) byNum.set(it.number, it);
    }
    const all = [...byNum.values()];
    // 合并的排前面
    all.sort((a, b) => rank(a.kind) - rank(b.kind) || Date.parse(b.at) - Date.parse(a.at));
    const shown = all.slice(0, maxLines);
    for (const it of shown) {
      lines.push({
        kind: it.kind,
        text: T('line.numbered', { verb: T(`verb.${it.kind}`), noun: T(`noun.${noun}`), n: it.number, title: it.title ? T('line.title_sep') + it.title : '' }),
        url: it.url,
      });
    }
    if (all.length > shown.length) {
      lines.push({ kind: kinds[0], text: T('line.more_numbered', { n: all.length - shown.length, noun: T(`noun.${noun}`) }), url: `${GH}/${list[0].repo}/${noun === 'pr' ? 'pulls' : 'issues'}` });
    }
  }

  function rank(kind) {
    return { pr_merge: 0, pr_open: 1, pr_close: 2, issue_open: 0, issue_close: 1 }[kind] ?? 3;
  }

  function pushAggregated(lines, list, kind, key, T) {
    const items = list.filter((x) => x.kind === kind);
    if (!items.length) return;
    const nums = uniq(items.map((x) => x.number).filter(Boolean));
    const ex = nums.length ? ` (#${nums.slice(0, 4).join(', #')}${nums.length > 4 ? ' …' : ''})` : '';
    lines.push({ kind, text: T(key, { n: items.length, ex }), url: items[0].url });
  }

  // ---------- 视图：过滤 / 排序（纯函数，content 每次切换都重新算） ----------

  const CODE_KINDS = ['push', 'pr_open', 'pr_merge', 'pr_close', 'pr_review', 'issue_open', 'issue_close', 'release', 'create_tag', 'create_repo', 'public'];

  /**
   * @param {Array}  users     summarize() 输出的 users
   * @param {object} view      { sort: 'latest'|'count'|'followers'|'login', filter: 'all'|'code'|'nostar', query: string, followers: {login: n} }
   */
  function applyView(users, view) {
    const v = view || {};
    const q = String(v.query || '').trim().toLowerCase();
    const followers = v.followers || {};
    let out = users.filter((u) => {
      if (v.filter === 'code' && !CODE_KINDS.some((k) => u.counts[k])) return false;
      if (v.filter === 'nostar' && Object.keys(u.counts).every((k) => PASSIVE.has(k))) return false;
      if (q && !(u.login.toLowerCase().includes(q) || u.repos.some((r) => r.type === 'repo' && r.name.toLowerCase().includes(q)))) return false;
      return true;
    });
    const by = {
      latest: (a, b) => Date.parse(b.latest) - Date.parse(a.latest),
      count: (a, b) => (b.score ?? b.count) - (a.score ?? a.count) || Date.parse(b.latest) - Date.parse(a.latest),
      followers: (a, b) => (followers[b.login] || 0) - (followers[a.login] || 0) || Date.parse(b.latest) - Date.parse(a.latest),
      login: (a, b) => a.login.localeCompare(b.login, undefined, { sensitivity: 'base' }),
    };
    out = out.slice().sort(by[v.sort] || by.latest);
    return out;
  }

  // ---------- 小工具 ----------

  function firstLine(s) {
    return String(s || '').split('\n')[0].trim().slice(0, 140);
  }
  function uniq(arr) {
    return [...new Set(arr)];
  }
  function maxAt(items) {
    return items.reduce((m, it) => (Date.parse(it.at) > Date.parse(m) ? it.at : m), items[0].at);
  }
  function tagText(block, tag) {
    const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : '';
  }
  function stripTags(html) {
    return String(html)
      .replace(/<\/?(?:a|code|span|b|strong|em|i|relative-time)\b[^>]*>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
  }
  function decodeEntities(s) {
    return String(s)
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function repoFromUrl(u) {
    const m = String(u).match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
    if (!m) return '';
    return /^(orgs|users|settings|search|topics|sponsors|marketplace)\//.test(m[1]) ? '' : m[1];
  }
  // "2026-09-02 06:37:14 -0700" / "2026-08-30 00:14:47 UTC" → ISO
  function toIso(s) {
    if (!s) return new Date(0).toISOString();
    const d = new Date(
      s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/, '$1T$2$3:$4').replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/, '$1T$2Z'),
    );
    return isNaN(d) ? new Date(0).toISOString() : d.toISOString();
  }

  return { normalizeRest, parseAtom, summarize, applyView, describeRepo, decodeEntities };
});
