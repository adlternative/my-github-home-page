(async () => {
  const $ = (id) => document.getElementById(id);
  const msg = $('msg');
  const say = (text, cls) => { msg.textContent = text; msg.className = cls || ''; };

  const s = await chrome.storage.local.get(['token', 'days', 'hideFeed', 'hideCopilot', 'lang']);
  let lang = GHI18n.resolve(s.lang);
  const T = (key, params) => GHI18n.t(lang, key, params);

  function applyI18n() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T(el.getAttribute('data-i18n')); });
    document.querySelectorAll('#days option').forEach((o) => { o.textContent = T('ui.days', { n: o.value }); });
  }

  $('lang').value = s.lang === 'zh' || s.lang === 'en' ? s.lang : 'auto';
  $('token').value = s.token || '';
  $('days').value = String(s.days || 7);
  $('hideFeed').checked = s.hideFeed !== false;
  $('hideCopilot').checked = s.hideCopilot !== false;
  applyI18n();

  // 切换语言立即预览
  $('lang').addEventListener('change', () => { lang = GHI18n.resolve($('lang').value); applyI18n(); });

  $('save').addEventListener('click', async () => {
    const token = $('token').value.trim();
    const prevToken = (await chrome.storage.local.get('token')).token || '';
    await chrome.storage.local.set({
      token,
      days: +$('days').value,
      hideFeed: $('hideFeed').checked,
      hideCopilot: $('hideCopilot').checked,
      lang: $('lang').value,
    });
    // token 变了，缓存里的数据来源也变了，清掉让下次重新抓
    if (token !== prevToken) await chrome.runtime.sendMessage({ type: 'clearCache' });
    say(T('opt.saved'), 'ok');
  });

  $('check').addEventListener('click', async () => {
    const token = $('token').value.trim();
    if (!token) return say(T('opt.need_token'), 'err');
    say(T('opt.checking'));
    const r = await chrome.runtime.sendMessage({ type: 'checkToken', token });
    if (r && r.ok) say(T('opt.valid', { login: r.login, rate: r.rateLimit ? `${r.rateLimit.remaining}/${r.rateLimit.limit}` : T('opt.unknown') }), 'ok');
    else say(T('opt.invalid', { error: (r && r.error) || '?' }), 'err');
  });

  $('clear').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'clearCache' });
    say(T('opt.cleared'), 'ok');
  });
})();
