# Following Digest for GitHub

中文 | [English](README.en.md)

把 GitHub 首页那个推荐 feed 换掉，改成：

```
▸ appleboy            27 个仓库 · 推送 31 次 · 12 个 PR · star 2 个        2 小时前
    appleboy/CodeGPT   [推送 ×4] [合并 PR]                                  昨天
      ⇡ 推送 4 次，6 个提交到 main
          · feat: add gemini provider
          · fix: handle empty diff
      ⎇ 合并 PR #312：Support custom prompt file
    gin-contrib/cors   [推送] [合并 PR]                                     2 天前
      ⎇ 合并 PR #76：ci(actions): update Go test matrix
▸ felipec             4 个仓库 · 推送 2 次 · 1 个 issue                    5 小时前
    ...
▸ 87 人最近 7 天没有公开动态
```

按**人**分组，人下面按**仓库**分组，每个仓库压缩成几行人话：推了几次、合了哪些 PR、开了哪些 issue、发了什么版本。只被 star / fork 过的仓库合并成一行「Star 了 N 个仓库」。

首页上是两列卡片，默认折叠只露一句话概览和前三个仓库，点开铺满整行看细节。可以搜索人或仓库，按「全部 / 只看写代码的 / 隐藏只 star 的」过滤，按「最近活跃 / 活动量 / 知名度 / 名字」排序（知名度用 followers 数，需要 token）。界面中英文可切换（默认跟随浏览器语言）。

## 安装

浏览器扩展（Manifest V3，Chrome / Edge / Arc 等 Chromium 内核都行）：

1. `git clone` 这个仓库
2. 打开 `chrome://extensions`，右上角打开「开发者模式」
3. 「加载已解压的扩展程序」，选这个仓库的根目录
4. 打开 <https://github.com>，首页 feed 位置就换成了汇总

### 建议配一个 token

不配也能用，但只能拿到每人最近 30 条动态（走 `github.com/{user}.atom`），部分 PR 标题会缺失。

配了 token 走 REST API：每人 300 条 / 90 天，带完整 commit message，ETag 命中不计配额。

1. 打开 <https://github.com/settings/personal-access-tokens/new>
2. Token name 随便填；Repository access 选 **Public repositories (read-only)**；**权限一个都不用勾**
3. 生成后，点扩展图标（或在首页汇总区点「设置」），粘贴进去，点「验证」再「保存」

token 只存在本机 `chrome.storage.local`，不走同步，只发给 `api.github.com`。

## 工作原理

```
content.js  ──port──▶  background.js  ──▶  api.github.com/users/{me}/following
 (渲染 DOM)            (抓取 + 缓存)   ──▶  api.github.com/users/{u}/events/public   (有 token)
                           │           ──▶  github.com/{u}.atom                       (无 token)
                           ▼
                      summarize.js   事件归一化 → 按人 / 仓库分组 → 生成中文摘要行
```

- `src/i18n.js`：中英文文案表，所有地方共用
- `src/summarize.js`：纯函数，无 DOM / chrome 依赖，background 和单元测试共用
- `src/background.js`：MV3 service worker。关注列表缓存 6 小时，事件缓存 10 分钟，并发 6，REST 模式带 ETag
- `src/content.js`：只在 `github.com/` 的 `#dashboard .news` 里插入面板，隐藏原 `feed-container`；监听 Turbo 导航事件重新注入
- `src/options.*`：语言、token、默认时间范围、是否隐藏原 feed / Copilot 框

## 开发

```sh
npm test          # node --test，不需要任何依赖
```

改完代码在 `chrome://extensions` 点一下扩展卡片上的刷新按钮，再刷新 github.com。

## 已知限制

- 只看得到**公开**事件，这是 GitHub Events API 的限制
- GitHub 的 Events API 有最多 5 分钟的延迟
- 只汇总「我关注的人」，不含 watch 的仓库和 star 的仓库；要加的话在 `background.js` 的 `getFollowing` 旁边加一个数据源即可
