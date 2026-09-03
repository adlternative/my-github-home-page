/*
 * i18n.js — 中英文文案表。无依赖，background (importScripts)、content script、options 页和 node 测试共用。
 * 用法：GHI18n.t('zh', 'headline.repos', { n: 3 })  →  "3 个仓库"
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GHI18n = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const zh = {
    // 事件类型标签（chip）
    'kind.push': '推送', 'kind.pr_open': '开 PR', 'kind.pr_merge': '合并 PR', 'kind.pr_close': '关闭 PR', 'kind.pr_other': 'PR',
    'kind.pr_review': '评审', 'kind.pr_comment': '评论 PR', 'kind.issue_open': '开 issue', 'kind.issue_close': '关 issue',
    'kind.issue_other': 'issue', 'kind.issue_comment': '评论 issue', 'kind.create_repo': '新建仓库', 'kind.create_branch': '新建分支',
    'kind.create_tag': '打 tag', 'kind.delete_branch': '删分支', 'kind.delete_tag': '删 tag', 'kind.release': '发布', 'kind.star': 'Star',
    'kind.fork': 'Fork', 'kind.public': '开源', 'kind.commit_comment': '评论提交', 'kind.wiki': 'Wiki', 'kind.member': '协作者', 'kind.other': '其他',

    // 用户一句话概览
    'headline.repos': '{n} 个仓库', 'headline.pushes': '推送 {n} 次', 'headline.prs': '{n} 个 PR', 'headline.reviews': '评审 {n} 次',
    'headline.issues': '{n} 个 issue', 'headline.releases': '发布 {n} 个版本', 'headline.stars': 'star {n} 个', 'headline.forks': 'fork {n} 个',

    // 仓库摘要行
    'line.push': '推送 {n} 次，{c} 个提交{to}', 'line.push_nocommits': '推送 {n} 次{to}', 'line.push_to': '到 {branches}', 'line.etc': ' 等',
    'verb.pr_merge': '合并', 'verb.pr_open': '打开', 'verb.pr_close': '关闭', 'verb.pr_other': '更新',
    'verb.issue_open': '打开', 'verb.issue_close': '关闭', 'verb.issue_other': '更新',
    'noun.pr': 'PR', 'noun.issue': 'issue', 'line.numbered': '{verb} {noun} #{n}{title}', 'line.title_sep': '：',
    'line.more_numbered': '…还有 {n} 个 {noun}',
    'line.reviews': '评审了 {n} 个 PR{ex}', 'line.pr_comments': '在 PR 下评论 {n} 次{ex}', 'line.issue_comments': '在 issue 下评论 {n} 次{ex}',
    'line.release': '发布 {name}', 'line.tags': '打 tag {tags}', 'line.new_branches': '新建分支 {b}{more}', 'line.deleted_branches': '删除分支 {b}{more}',
    'line.more_n': ' 等 {n} 个', 'line.create_repo': '新建了这个仓库', 'line.public': '把仓库设为公开', 'line.fork': 'Fork 了这个仓库',
    'line.star': 'Star 了这个仓库', 'line.wiki': '更新了 wiki', 'line.commit_comments': '评论了 {n} 处提交', 'line.member': '添加了协作者',
    'stars.title': 'Star 了 {n} 个仓库', 'forks.title': 'Fork 了 {n} 个仓库',

    // 首页面板
    'ui.title': '关注的人在做什么', 'ui.days': '最近 {n} 天', 'ui.days_title': '时间范围',
    'ui.expand_all': '全部展开', 'ui.collapse_all': '全部折叠', 'ui.expand_title': '展开 / 折叠所有人的详情',
    'ui.refresh': '刷新', 'ui.refresh_title': '重新抓取所有人的动态', 'ui.show_feed': '显示原 feed', 'ui.hide_feed': '隐藏原 feed',
    'ui.feed_title': '显示 / 隐藏 GitHub 原来的 feed', 'ui.settings': '设置',
    'ui.loading': '正在加载…', 'ui.loading_following': '正在获取关注列表…', 'ui.using_cache': '使用缓存…', 'ui.fetching': '正在抓取动态 {done}/{total}',
    'ui.status': '{active} 人有动态 · {quiet} 人无动态 · 共关注 {total} 人', 'ui.no_token_mode': '无 token 模式', 'ui.rate': 'API 余额 {r}/{l}',
    'ui.notice_no_token_1': '当前没有 token，只能看到每人最近 30 条动态、部分 PR 标题会缺失。', 'ui.notice_no_token_link': '在设置里填一个 token',
    'ui.notice_no_token_2': '（只读、无需任何权限）可以拿到每人 300 条、90 天的完整数据。',
    'ui.fetch_errors': '有 {n} 个用户抓取失败：{list}', 'ui.empty': '最近 {n} 天你关注的人都没有公开动态。试试把时间范围调大。',
    'ui.quiet': '{n} 人最近 {d} 天没有公开动态', 'ui.more_repos': '…还有 {n} 个仓库', 'ui.more_commits': '…还有 {n} 个提交',
    'time.now': '刚刚', 'time.minutes': '{n} 分钟前', 'time.hours': '{n} 小时前', 'time.days': '{n} 天前',

    // background 错误
    'err.following': '获取关注列表失败：{status} {msg}', 'err.rate_limit': 'API 配额用完，{time} 后恢复', 'err.forbidden': '被拒绝：{status} {msg}',
    'err.bad_token': 'token 无效或已过期（401）', 'err.throttled': 'github.com 限流了，稍后再试',

    // 设置页
    'opt.title': 'Following Digest 设置', 'opt.token_label': 'GitHub token（可选，但强烈建议）', 'opt.verify': '验证',
    'opt.token_hint_1': '去 ', 'opt.token_hint_2': ' 创建一个 fine-grained token，Repository access 选 「Public repositories (read-only)」，不需要勾任何权限。它只用来把 API 配额从 60 次/小时提到 5000 次/小时，并拿到完整的 commit message 和 PR 标题。token 只存在本机，不会同步、不会发到 github 以外的地方。',
    'opt.days_label': '默认时间范围', 'opt.lang_label': '界面语言', 'opt.lang_auto': '跟随浏览器', 'opt.lang_zh': '中文', 'opt.lang_en': 'English',
    'opt.layout': '首页布局', 'opt.hide_feed': '隐藏 GitHub 原来的推荐 feed', 'opt.hide_copilot': '隐藏首页顶部的 Copilot 输入框',
    'opt.save': '保存', 'opt.clear': '清空缓存', 'opt.saved': '已保存。回到 github.com 首页刷新即可生效。', 'opt.cleared': '缓存已清空。',
    'opt.need_token': '先填 token', 'opt.checking': '验证中…', 'opt.valid': '有效：登录用户 {login}，API 配额 {rate}', 'opt.invalid': '无效：{error}', 'opt.unknown': '未知',
  };

  const en = {
    'kind.push': 'Push', 'kind.pr_open': 'PR opened', 'kind.pr_merge': 'PR merged', 'kind.pr_close': 'PR closed', 'kind.pr_other': 'PR',
    'kind.pr_review': 'Review', 'kind.pr_comment': 'PR comment', 'kind.issue_open': 'Issue opened', 'kind.issue_close': 'Issue closed',
    'kind.issue_other': 'Issue', 'kind.issue_comment': 'Issue comment', 'kind.create_repo': 'New repo', 'kind.create_branch': 'New branch',
    'kind.create_tag': 'Tag', 'kind.delete_branch': 'Branch deleted', 'kind.delete_tag': 'Tag deleted', 'kind.release': 'Release', 'kind.star': 'Star',
    'kind.fork': 'Fork', 'kind.public': 'Made public', 'kind.commit_comment': 'Commit comment', 'kind.wiki': 'Wiki', 'kind.member': 'Collaborator', 'kind.other': 'Other',

    'headline.repos': '{n} repos', 'headline.pushes': '{n} pushes', 'headline.prs': '{n} PRs', 'headline.reviews': '{n} reviews',
    'headline.issues': '{n} issues', 'headline.releases': '{n} releases', 'headline.stars': '{n} stars', 'headline.forks': '{n} forks',

    'line.push': '{n} pushes, {c} commits{to}', 'line.push_nocommits': '{n} pushes{to}', 'line.push_to': ' to {branches}', 'line.etc': ' …',
    'verb.pr_merge': 'Merged', 'verb.pr_open': 'Opened', 'verb.pr_close': 'Closed', 'verb.pr_other': 'Updated',
    'verb.issue_open': 'Opened', 'verb.issue_close': 'Closed', 'verb.issue_other': 'Updated',
    'noun.pr': 'PR', 'noun.issue': 'issue', 'line.numbered': '{verb} {noun} #{n}{title}', 'line.title_sep': ': ',
    'line.more_numbered': '…{n} more {noun}s',
    'line.reviews': 'Reviewed {n} PRs{ex}', 'line.pr_comments': '{n} comments on PRs{ex}', 'line.issue_comments': '{n} comments on issues{ex}',
    'line.release': 'Released {name}', 'line.tags': 'Tagged {tags}', 'line.new_branches': 'New branches {b}{more}', 'line.deleted_branches': 'Deleted branches {b}{more}',
    'line.more_n': ' +{n} more', 'line.create_repo': 'Created this repo', 'line.public': 'Made this repo public', 'line.fork': 'Forked this repo',
    'line.star': 'Starred this repo', 'line.wiki': 'Updated the wiki', 'line.commit_comments': '{n} commit comments', 'line.member': 'Added a collaborator',
    'stars.title': 'Starred {n} repos', 'forks.title': 'Forked {n} repos',

    'ui.title': 'What people you follow are doing', 'ui.days': 'Last {n} days', 'ui.days_title': 'Time range',
    'ui.expand_all': 'Expand all', 'ui.collapse_all': 'Collapse all', 'ui.expand_title': 'Expand / collapse everyone',
    'ui.refresh': 'Refresh', 'ui.refresh_title': 'Re-fetch everyone\'s activity', 'ui.show_feed': 'Show original feed', 'ui.hide_feed': 'Hide original feed',
    'ui.feed_title': 'Show / hide GitHub\'s own feed', 'ui.settings': 'Settings',
    'ui.loading': 'Loading…', 'ui.loading_following': 'Fetching who you follow…', 'ui.using_cache': 'Using cache…', 'ui.fetching': 'Fetching activity {done}/{total}',
    'ui.status': '{active} active · {quiet} quiet · {total} followed', 'ui.no_token_mode': 'no token', 'ui.rate': 'API quota {r}/{l}',
    'ui.notice_no_token_1': 'No token configured: only the last 30 events per person are visible and some PR titles are missing. ', 'ui.notice_no_token_link': 'Add a token in settings',
    'ui.notice_no_token_2': ' (read-only, no permissions needed) to get 300 events / 90 days per person.',
    'ui.fetch_errors': '{n} users failed to load: {list}', 'ui.empty': 'Nobody you follow had public activity in the last {n} days. Try a wider time range.',
    'ui.quiet': '{n} people had no public activity in the last {d} days', 'ui.more_repos': '…{n} more repos', 'ui.more_commits': '…{n} more commits',
    'time.now': 'just now', 'time.minutes': '{n}m ago', 'time.hours': '{n}h ago', 'time.days': '{n}d ago',

    'err.following': 'Failed to load who you follow: {status} {msg}', 'err.rate_limit': 'API quota exhausted, resets at {time}', 'err.forbidden': 'Forbidden: {status} {msg}',
    'err.bad_token': 'Token invalid or expired (401)', 'err.throttled': 'github.com is throttling, try again later',

    'opt.title': 'Following Digest settings', 'opt.token_label': 'GitHub token (optional, strongly recommended)', 'opt.verify': 'Verify',
    'opt.token_hint_1': 'Create a fine-grained token at ', 'opt.token_hint_2': ' with Repository access = "Public repositories (read-only)" and no permissions at all. It only raises the API quota from 60/h to 5000/h and unlocks full commit messages and PR titles. The token stays on this machine, is never synced, and is only sent to api.github.com.',
    'opt.days_label': 'Default time range', 'opt.lang_label': 'Language', 'opt.lang_auto': 'Follow browser', 'opt.lang_zh': '中文', 'opt.lang_en': 'English',
    'opt.layout': 'Home page layout', 'opt.hide_feed': 'Hide GitHub\'s own recommendation feed', 'opt.hide_copilot': 'Hide the Copilot box at the top',
    'opt.save': 'Save', 'opt.clear': 'Clear cache', 'opt.saved': 'Saved. Reload the github.com home page to apply.', 'opt.cleared': 'Cache cleared.',
    'opt.need_token': 'Enter a token first', 'opt.checking': 'Checking…', 'opt.valid': 'Valid: signed in as {login}, API quota {rate}', 'opt.invalid': 'Invalid: {error}', 'opt.unknown': 'unknown',
  };

  const messages = { zh, en };

  function t(lang, key, params) {
    const table = messages[lang] || en;
    let s = table[key] != null ? table[key] : en[key] != null ? en[key] : key;
    if (params) for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(String(params[k]));
    return s;
  }

  /** 设置值 'auto' | 'zh' | 'en' → 实际语言 */
  function resolve(setting, navLang) {
    if (setting === 'zh' || setting === 'en') return setting;
    const nav = String(navLang || (typeof navigator !== 'undefined' && navigator.language) || 'en').toLowerCase();
    return nav.startsWith('zh') ? 'zh' : 'en';
  }

  return { t, resolve, messages };
});
