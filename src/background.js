/*
 * background.js — MV3 service worker。
 * 职责：拉取「我关注的人」列表和每个人的公开事件，归一化后缓存到 chrome.storage.local，
 *       按 content script 要求的时间窗口做汇总并回传。
 *
 * 数据源（二选一，按有没有 token 自动决定）：
 *   有 token  → https://api.github.com/users/{u}/events/public  （每人最多 300 条、90 天，带 commit message；ETag 命中不计配额）
 *   无 token  → https://github.com/{u}.atom                       （每人 30 条，无配额限制）
 */
importScripts('i18n.js', 'summarize.js');

const API = 'https://api.github.com';
const EVENTS_TTL_MS = 10 * 60 * 1000; // 事件缓存 10 分钟
const FOLLOWING_TTL_MS = 6 * 60 * 60 * 1000; // 关注列表缓存 6 小时
const KEEP_DAYS = 30; // 缓存里只保留 30 天内的事件
const CONCURRENCY = 6;

const DEFAULTS = { token: '', days: 7, hideFeed: true, hideCopilot: true, lang: 'auto' };

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === 'checkToken') {
    checkToken(msg.token).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg && msg.type === 'getProfiles') {
    getProfiles(msg.logins || []).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg && msg.type === 'clearCache') {
    clearCache().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// content script 用长连接拿进度 + 结果
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'digest') return;
  // 页面跳走 / 进入 bfcache 时 port 会被关掉；之后不能再 postMessage，否则控制台报 runtime.lastError
  let closed = false;
  port.onDisconnect.addListener(() => {
    closed = true;
    void chrome.runtime.lastError; // 读一下就不会有 "Unchecked runtime.lastError" 警告
  });
  port.onMessage.addListener(async (req) => {
    const post = (m) => {
      if (closed) return;
      try { port.postMessage(m); } catch (_) { closed = true; }
    };
    try {
      const result = await buildDigest(req, (progress) => post({ progress }));
      post({ done: true, ...result });
    } catch (e) {
      post({ error: String((e && e.message) || e) });
    }
  });
});

// ---------- 主流程 ----------

async function buildDigest({ login, days, lang, force }, onProgress) {
  const settings = await getSettings();
  const L = lang || GHI18n.resolve(settings.lang);
  const T = (key, params) => GHI18n.t(L, key, params);
  const token = settings.token || '';
  const mode = token ? 'rest' : 'atom';
  const errors = [];

  onProgress({ phase: 'following', done: 0, total: 0 });
  const following = await getFollowing(login, token, force, T);
  const total = following.length;

  const cache = await chrome.storage.local.get(following.map((u) => `events:${u.login}`));
  const now = Date.now();
  const stale = following.filter((u) => {
    const c = cache[`events:${u.login}`];
    return force || !c || c.mode !== mode || now - c.fetchedAt > EVENTS_TTL_MS;
  });

  let done = 0;
  let rateLimit = null;
  const updates = {};
  onProgress({ phase: 'events', done, total, stale: stale.length });

  await runPool(stale, CONCURRENCY, async (u) => {
    const prev = cache[`events:${u.login}`];
    try {
      const r = mode === 'rest' ? await fetchRestEvents(u.login, token, prev, T) : await fetchAtomEvents(u.login, T);
      if (r.rateLimit) rateLimit = r.rateLimit;
      if (r.notModified) {
        updates[`events:${u.login}`] = { ...prev, fetchedAt: now };
      } else {
        updates[`events:${u.login}`] = { mode, fetchedAt: now, etag: r.etag || '', avatar: r.avatar || (prev && prev.avatar), items: mergeItems(prev && prev.mode === mode ? prev.items : [], r.items, now) };
      }
    } catch (e) {
      errors.push(`${u.login}: ${e.message || e}`);
      if (e.fatal) throw e;
    } finally {
      done += 1;
      onProgress({ phase: 'events', done, total, stale: stale.length });
    }
  });

  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  Object.assign(cache, updates);

  const byUser = {};
  for (const u of following) {
    const c = cache[`events:${u.login}`];
    byUser[u.login] = { avatar: u.avatar || (c && c.avatar), items: (c && c.items) || [] };
  }
  const d = Number(days) || settings.days || DEFAULTS.days;
  const summary = GHSummary.summarize(byUser, { nowMs: now, sinceMs: now - d * 864e5, lang: L });
  return { summary, meta: { mode, days: d, following: total, refreshed: stale.length, errors, rateLimit, fetchedAt: now } };
}

// ---------- 关注列表 ----------

async function getFollowing(login, token, force, T) {
  const key = `following:${login}`;
  const cached = (await chrome.storage.local.get(key))[key];
  if (!force && cached && Date.now() - cached.fetchedAt < FOLLOWING_TTL_MS) return cached.users;

  const users = [];
  for (let page = 1; page <= 20; page++) {
    // 始终走公开接口：/user/following 需要 fine-grained token 勾 Followers 权限，而公开接口任何 token 都能访问
    const url = `${API}/users/${encodeURIComponent(login)}/following?per_page=100&page=${page}`;
    const res = await ghFetch(url, token);
    if (!res.ok) throw fatal(T('err.following', { status: res.status, msg: await errorText(res) }));
    const list = await res.json();
    for (const u of list) users.push({ login: u.login, avatar: u.avatar_url });
    if (list.length < 100) break;
  }
  if (!users.length && cached) return cached.users;
  await chrome.storage.local.set({ [key]: { fetchedAt: Date.now(), users } });
  return users;
}

// ---------- 事件抓取 ----------

async function fetchRestEvents(user, token, prev, T) {
  const headers = {};
  if (prev && prev.etag) headers['If-None-Match'] = prev.etag;
  const res = await ghFetch(`${API}/users/${encodeURIComponent(user)}/events/public?per_page=100`, token, headers);
  const rateLimit = readRateLimit(res);
  if (res.status === 304) return { notModified: true, rateLimit };
  if (res.status === 403 || res.status === 429) {
    const msg = rateLimit && rateLimit.remaining === 0 ? T('err.rate_limit', { time: rateLimit.resetText }) : T('err.forbidden', { status: res.status, msg: await errorText(res) });
    throw fatal(msg);
  }
  if (res.status === 401) throw fatal(T('err.bad_token'));
  if (res.status === 404) return { items: [], rateLimit }; // 用户已注销
  if (!res.ok) throw new Error(`${res.status} ${await errorText(res)}`);
  const events = await res.json();
  const items = events.map(GHSummary.normalizeRest).filter(Boolean);
  const avatar = events[0] && events[0].actor && events[0].actor.avatar_url;
  return { items, etag: res.headers.get('etag') || '', avatar, rateLimit };
}

async function fetchAtomEvents(user, T) {
  const res = await fetchWithRetry(`https://github.com/${encodeURIComponent(user)}.atom`, { credentials: 'omit' });
  if (res.status === 404) return { items: [] };
  if (res.status === 429) throw fatal(T('err.throttled'));
  if (!res.ok) throw new Error(`atom ${res.status}`);
  const xml = await res.text();
  const items = GHSummary.parseAtom(xml, user);
  return { items, avatar: items[0] && items[0].avatar };
}

/** 新旧 item 合并去重（按 kind+repo+at+url），并丢掉 KEEP_DAYS 之前的 */
function mergeItems(oldItems, newItems, now) {
  const cutoff = now - KEEP_DAYS * 864e5;
  const seen = new Set();
  const out = [];
  for (const it of [...newItems, ...(oldItems || [])]) {
    if (Date.parse(it.at) < cutoff) continue;
    const key = `${it.kind}|${it.repo}|${it.at}|${it.url}|${it.number || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return out.slice(0, 400);
}

// ---------- HTTP ----------

function ghFetch(url, token, extraHeaders) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(extraHeaders || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetchWithRetry(url, { headers, credentials: 'omit' });
}

/** GitHub 偶尔返回 502/503，网络抖动也常见：5xx 和网络错误最多重试 2 次 */
async function fetchWithRetry(url, init, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    try {
      const res = await fetch(url, init);
      if (res.status < 500 || i === tries - 1) return res;
      lastErr = new Error(`${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function readRateLimit(res) {
  const limit = +res.headers.get('x-ratelimit-limit');
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = +res.headers.get('x-ratelimit-reset');
  if (remaining == null) return null;
  return { limit, remaining: +remaining, reset, resetText: reset ? new Date(reset * 1000).toLocaleTimeString() : '' };
}

async function errorText(res) {
  try {
    const j = await res.json();
    return j.message || '';
  } catch (_) {
    return '';
  }
}

function fatal(msg) {
  const e = new Error(msg);
  e.fatal = true;
  return e;
}

async function runPool(items, size, worker) {
  let i = 0;
  let failed = null;
  const next = async () => {
    while (i < items.length && !failed) {
      const item = items[i++];
      try {
        await worker(item);
      } catch (e) {
        failed = e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, next));
  if (failed) throw failed;
}

// ---------- 设置 / 缓存 ----------

async function getSettings() {
  const s = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...s };
}

async function checkToken(token) {
  const res = await ghFetch(`${API}/user`, token);
  const rateLimit = readRateLimit(res);
  if (!res.ok) return { ok: false, error: `${res.status} ${await errorText(res)}`, rateLimit };
  const u = await res.json();
  return { ok: true, login: u.login, rateLimit };
}

// ---------- followers 数（「知名度」排序用），需要 token，缓存 7 天 ----------

const PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function getProfiles(logins) {
  const { token } = await getSettings();
  const keys = logins.map((l) => `profile:${l}`);
  const cached = await chrome.storage.local.get(keys);
  const now = Date.now();
  const followers = {};
  const missing = [];
  for (const l of logins) {
    const c = cached[`profile:${l}`];
    if (c && now - c.fetchedAt < PROFILE_TTL_MS) followers[l] = c.followers;
    else missing.push(l);
  }
  if (!token) return { ok: !missing.length, needToken: !!missing.length, followers };
  const updates = {};
  await runPool(missing, CONCURRENCY, async (l) => {
    try {
      const res = await ghFetch(`${API}/users/${encodeURIComponent(l)}`, token);
      if (!res.ok) return;
      const u = await res.json();
      followers[l] = u.followers || 0;
      updates[`profile:${l}`] = { followers: u.followers || 0, fetchedAt: now };
    } catch (_) { /* 单个失败不影响整体 */ }
  });
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  return { ok: true, followers };
}

async function clearCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('events:') || k.startsWith('following:') || k.startsWith('profile:'));
  if (keys.length) await chrome.storage.local.remove(keys);
}
