/*
 * content.js — 注入 github.com 首页（dashboard），在原 feed 位置渲染「关注的人 → 仓库 → 做了什么」。
 * 所有数据通过 background 拿，本文件只负责 DOM。所有文本都用 textContent 写入，不拼 HTML。
 * 依赖 i18n.js（GHI18n），manifest 里先于本文件加载。
 */
(() => {
  'use strict';

  const DAY_OPTIONS = [1, 3, 7, 14, 30];
  const STATE = { days: 7, hideFeed: true, hideCopilot: true, expandAll: false, lang: 'en', port: null };
  const T = (key, params) => GHI18n.t(STATE.lang, key, params);

  // ---------- 入口 / Turbo 导航 ----------

  function isDashboard() {
    return location.hostname === 'github.com' && (location.pathname === '/' || location.pathname === '/dashboard');
  }

  async function ensure() {
    if (!isDashboard()) return;
    const news = document.querySelector('#dashboard .news');
    const feed = news && news.querySelector('feed-container');
    if (!news || !feed) return;
    if (document.getElementById('fd-root')) return;

    const login = (document.querySelector('meta[name="user-login"]') || {}).content;
    if (!login) return;

    const s = await chrome.storage.local.get(['days', 'hideFeed', 'hideCopilot', 'expandAll', 'lang']);
    STATE.days = DAY_OPTIONS.includes(+s.days) ? +s.days : 7;
    STATE.expandAll = s.expandAll === true;
    STATE.hideFeed = s.hideFeed !== false;
    STATE.hideCopilot = s.hideCopilot !== false;
    STATE.lang = GHI18n.resolve(s.lang);
    applyBodyFlags();

    const root = h('div', { id: 'fd-root' });
    news.insertBefore(root, feed);
    renderShell(root, login);
    load(login, false);
  }

  function applyBodyFlags() {
    document.body.classList.toggle('fd-hide-feed', STATE.hideFeed);
    document.body.classList.toggle('fd-hide-copilot', STATE.hideCopilot);
  }

  document.addEventListener('turbo:load', ensure);
  document.addEventListener('soft-nav:end', ensure);
  ensure();
  // GitHub 有时用局部替换而不触发上面两个事件，兜底观察 main 的子树变化
  let mo;
  const observe = () => {
    const main = document.querySelector('main');
    if (!main || mo) return;
    mo = new MutationObserver(debounce(ensure, 300));
    mo.observe(main, { childList: true, subtree: true });
  };
  observe();
  document.addEventListener('turbo:load', () => { mo = null; observe(); });

  // ---------- 外壳 ----------

  function renderShell(root, login) {
    const select = h('select', { title: T('ui.days_title') }, DAY_OPTIONS.map((d) => h('option', { value: String(d), selected: d === STATE.days ? '' : null }, T('ui.days', { n: d }))));
    select.addEventListener('change', async () => {
      STATE.days = +select.value;
      await chrome.storage.local.set({ days: STATE.days });
      load(login, false);
    });
    const expand = h('button', { type: 'button', title: T('ui.expand_title') }, STATE.expandAll ? T('ui.collapse_all') : T('ui.expand_all'));
    expand.addEventListener('click', async () => {
      STATE.expandAll = !STATE.expandAll;
      expand.textContent = STATE.expandAll ? T('ui.collapse_all') : T('ui.expand_all');
      document.querySelectorAll('#fd-root details.fd-user').forEach((d) => { d.open = STATE.expandAll; });
      await chrome.storage.local.set({ expandAll: STATE.expandAll });
    });
    const refresh = h('button', { type: 'button', title: T('ui.refresh_title') }, T('ui.refresh'));
    refresh.addEventListener('click', () => load(login, true));
    const toggleFeed = h('button', { type: 'button', title: T('ui.feed_title') }, STATE.hideFeed ? T('ui.show_feed') : T('ui.hide_feed'));
    toggleFeed.addEventListener('click', async () => {
      STATE.hideFeed = !STATE.hideFeed;
      toggleFeed.textContent = STATE.hideFeed ? T('ui.show_feed') : T('ui.hide_feed');
      await chrome.storage.local.set({ hideFeed: STATE.hideFeed });
      applyBodyFlags();
    });
    const settings = h('button', { type: 'button' }, T('ui.settings'));
    settings.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'openOptions' }));

    root.append(
      h('div', { class: 'fd-toolbar' }, [h('h2', {}, T('ui.title')), h('span', { class: 'fd-status', id: 'fd-status' }, ''), select, expand, refresh, toggleFeed, settings]),
      h('div', { class: 'fd-progress', id: 'fd-progress', hidden: '' }, [h('div')]),
      h('div', { id: 'fd-notice' }),
      h('div', { id: 'fd-body' }),
    );
  }

  // ---------- 加载 ----------

  function load(login, force) {
    if (STATE.port) {
      try { STATE.port.disconnect(); } catch (_) { /* noop */ }
    }
    const status = document.getElementById('fd-status');
    const progress = document.getElementById('fd-progress');
    const notice = document.getElementById('fd-notice');
    if (!status) return;
    status.textContent = T('ui.loading');
    progress.hidden = false;
    progress.firstChild.style.width = '0%';
    notice.replaceChildren();

    const port = chrome.runtime.connect({ name: 'digest' });
    STATE.port = port;
    port.onMessage.addListener((m) => {
      if (m.progress) {
        const p = m.progress;
        if (p.phase === 'following') status.textContent = T('ui.loading_following');
        else if (p.stale === 0) status.textContent = T('ui.using_cache');
        else {
          status.textContent = T('ui.fetching', { done: p.done, total: p.stale });
          progress.firstChild.style.width = `${Math.round((p.done / Math.max(1, p.stale)) * 100)}%`;
        }
        return;
      }
      progress.hidden = true;
      if (m.error) {
        status.textContent = '';
        showNotice(notice, m.error, true);
        return;
      }
      if (m.done) renderSummary(m.summary, m.meta, notice, status);
    });
    port.onDisconnect.addListener(() => {
      if (STATE.port === port) STATE.port = null;
    });
    port.postMessage({ login, days: STATE.days, lang: STATE.lang, force });
  }

  function showNotice(container, text, isError) {
    container.replaceChildren(h('div', { class: 'fd-notice' + (isError ? ' fd-error' : '') }, text));
  }

  // ---------- 渲染 ----------

  function renderSummary(summary, meta, notice, status) {
    const body = document.getElementById('fd-body');
    if (!body) return;

    const bits = [T('ui.status', { active: summary.users.length, quiet: summary.quiet.length, total: meta.following })];
    if (meta.mode === 'atom') bits.push(T('ui.no_token_mode'));
    if (meta.rateLimit) bits.push(T('ui.rate', { r: meta.rateLimit.remaining, l: meta.rateLimit.limit }));
    status.textContent = bits.join(' · ');

    notice.replaceChildren();
    if (meta.mode === 'atom') {
      const a = h('a', { href: '#' }, T('ui.notice_no_token_link'));
      a.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.sendMessage({ type: 'openOptions' }); });
      notice.append(h('div', { class: 'fd-notice' }, [T('ui.notice_no_token_1'), a, T('ui.notice_no_token_2')]));
    }
    if (meta.errors && meta.errors.length) {
      notice.append(h('div', { class: 'fd-notice fd-error' }, T('ui.fetch_errors', { n: meta.errors.length, list: meta.errors.slice(0, 3).join('; ') + (meta.errors.length > 3 ? ' …' : '') })));
    }

    body.replaceChildren();
    if (!summary.users.length) {
      body.append(h('div', { class: 'fd-empty' }, T('ui.empty', { n: meta.days })));
    }
    const grid = h('div', { class: 'fd-grid' });
    for (const u of summary.users) grid.append(renderUser(u, meta));
    body.append(grid);
    if (summary.quiet.length) {
      body.append(
        h('details', { class: 'fd-quiet' }, [
          h('summary', {}, T('ui.quiet', { n: summary.quiet.length, d: meta.days })),
          h('div', {}, summary.quiet.map((q) => h('a', { href: `https://github.com/${q.login}` }, q.login))),
        ]),
      );
    }
  }

  function renderUser(u, meta) {
    const details = h('details', { class: 'fd-user', open: STATE.expandAll ? '' : null });

    // 折叠态预览：前 3 个仓库 + 各自的动作 chip
    const preview = h('ul', { class: 'fd-preview' });
    for (const r of u.repos.slice(0, 3)) {
      preview.append(
        h('li', {}, [
          h('span', { class: 'fd-preview-repo', title: r.name }, r.type === 'repo' ? shortRepo(r.name, u.login) : r.name),
          h('span', { class: 'fd-preview-chips' }, r.chips.slice(0, 3).map((c) => chip(c))),
        ]),
      );
    }
    if (u.repos.length > 3) preview.append(h('li', { class: 'fd-more' }, T('ui.more_repos', { n: u.repos.length - 3 })));

    const login = h('a', { class: 'fd-login', href: `https://github.com/${u.login}` }, u.login);
    // 点用户名是跳转，不要触发折叠；点其它地方才折叠
    login.addEventListener('click', (e) => e.stopPropagation());

    details.append(
      h('summary', {}, [
        h('div', { class: 'fd-user-head' }, [
          h('img', { class: 'fd-avatar', src: sizedAvatar(u.avatar), alt: '', loading: 'lazy' }),
          h('div', { class: 'fd-user-text' }, [login, h('div', { class: 'fd-headline' }, u.headline)]),
          h('span', { class: 'fd-time', title: new Date(u.latest).toLocaleString() }, relTime(u.latest, meta.fetchedAt)),
        ]),
        preview,
      ]),
    );
    const list = h('div', { class: 'fd-repos' });
    for (const r of u.repos) list.append(r.type === 'repo' ? renderRepo(r, meta) : renderPassive(r, meta));
    details.append(list);
    return details;
  }

  // 自己名下的仓库只显示仓库名，别人的显示 owner/repo
  function shortRepo(name, login) {
    const [owner, repo] = name.split('/');
    return owner === login ? repo : name;
  }

  function chip(c) {
    return h('span', { class: 'fd-chip', 'data-kind': c.kind }, c.n > 1 ? `${c.label} ×${c.n}` : c.label);
  }

  function renderRepo(r, meta) {
    const head = h('div', { class: 'fd-repo-head' }, [
      h('a', { class: 'fd-repo-name', href: r.url }, r.name),
      ...r.chips.map(chip),
      h('span', { class: 'fd-time' }, relTime(r.latest, meta.fetchedAt)),
    ]);
    const ul = h('ul', { class: 'fd-lines' });
    for (const line of r.lines) {
      const li = h('li', { 'data-kind': line.kind });
      li.append(h('span', { class: 'fd-kind', 'aria-hidden': 'true' }, ICON[line.kind] || '·'));
      li.append(line.url ? h('a', { href: line.url }, line.text) : h('span', {}, line.text));
      if (line.sub && line.sub.length) {
        const sub = h('ul', { class: 'fd-sub' });
        for (const s of line.sub) sub.append(h('li', { title: s.text }, [h('a', { href: s.url }, s.text)]));
        if (line.more > 0) sub.append(h('li', { class: 'fd-more' }, T('ui.more_commits', { n: line.more })));
        li.append(sub);
      }
      ul.append(li);
    }
    return h('div', { class: 'fd-repo' }, [head, ul]);
  }

  // 「Star 了 N 个仓库」/「Fork 了 N 个仓库」：一行标题 + 仓库链接流
  function renderPassive(r, meta) {
    const head = h('div', { class: 'fd-repo-head' }, [
      h('span', { class: 'fd-repo-name fd-repo-name--passive' }, [h('span', { class: 'fd-kind', 'aria-hidden': 'true' }, ICON[r.chips[0].kind]), r.name]),
      h('span', { class: 'fd-time' }, relTime(r.latest, meta.fetchedAt)),
    ]);
    const flow = h('div', { class: 'fd-passive' }, r.repos.map((p) => h('a', { class: 'fd-passive-repo', href: p.url }, p.name)));
    return h('div', { class: 'fd-repo fd-repo--passive' }, [head, flow]);
  }

  const ICON = {
    push: '⇡', pr_open: '⎇', pr_merge: '⎇', pr_close: '⎇', pr_other: '⎇', pr_review: '✎', pr_comment: '✎',
    issue_open: '○', issue_close: '●', issue_other: '○', issue_comment: '✎', release: '⬡', create_tag: '⬡',
    create_branch: '⑂', delete_branch: '⑂', create_repo: '＋', star: '★', fork: '⑂', public: '◎', wiki: '≡',
  };

  // ---------- 小工具 ----------

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined) continue;
      el.setAttribute(k, v);
    }
    if (children == null) return el;
    for (const c of Array.isArray(children) ? children : [children]) {
      if (c == null) continue;
      el.append(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function sizedAvatar(url) {
    if (!url) return '';
    return url.includes('?') ? `${url}&s=64` : `${url}?s=64`;
  }

  function relTime(iso, nowMs) {
    const diff = Math.max(0, (nowMs || Date.now()) - Date.parse(iso));
    const m = Math.round(diff / 60000);
    if (m < 1) return T('time.now');
    if (m < 60) return T('time.minutes', { n: m });
    const hh = Math.round(m / 60);
    if (hh < 24) return T('time.hours', { n: hh });
    const d = Math.round(hh / 24);
    if (d < 30) return T('time.days', { n: d });
    return new Date(iso).toLocaleDateString();
  }

  function debounce(fn, ms) {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  }
})();
