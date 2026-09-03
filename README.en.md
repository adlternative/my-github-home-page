# Following Digest for GitHub

[中文](README.md) | English

Replaces the recommendation feed on the GitHub home page with this:

```
▸ appleboy            27 repos · 31 pushes · 12 PRs · 2 stars              2h ago
    appleboy/CodeGPT   [Push ×4] [PR merged]                                yesterday
      ⇡ 4 pushes, 6 commits to main
          · feat: add gemini provider
          · fix: handle empty diff
      ⎇ Merged PR #312: Support custom prompt file
    gin-contrib/cors   [Push] [PR merged]                                   2d ago
      ⎇ Merged PR #76: ci(actions): update Go test matrix
    ★ Starred 2 repos   router-for-me/CLIProxyAPI  JuliusBrussee/caveman
▸ felipec             4 repos · 2 pushes · 1 issue                          5h ago
    ...
▸ 87 people had no public activity in the last 7 days
```

Grouped by **person**, then by **repo**. Each repo is compressed into a few lines: how many pushes, which PRs got merged, which issues were opened, what was released. Repos that were only starred or forked collapse into a single "Starred N repos" line.

The home page shows a two-column grid of cards. Cards are collapsed by default (one-line headline plus the top three repos); click one to expand it across the full row. You can search people or repos, filter (everyone / only coding activity / hide star-only), and sort (most recent / most active / most followed / name). "Most followed" uses follower counts and needs a token. The UI is available in English and Chinese and follows the browser language by default.

## Install

Manifest V3 browser extension. Works in Chrome, Edge, Arc and other Chromium browsers.

1. `git clone` this repo
2. Open `chrome://extensions` and enable **Developer mode**
3. **Load unpacked**, pick the repo root
4. Open <https://github.com>. The feed area is replaced by the digest

### Add a token (recommended)

Without a token the extension reads `github.com/{user}.atom`, which only has the last 30 events per person and drops some PR titles.

With a token it uses the REST API: 300 events / 90 days per person, full commit messages, and ETag caching so unchanged users don't cost quota.

1. Go to <https://github.com/settings/personal-access-tokens/new>
2. Any name. Repository access: **Public repositories (read-only)**. **No permissions needed.**
3. Click the extension icon (or the "Settings" button in the digest), paste the token, click "Verify", then "Save"

The token is stored in `chrome.storage.local` on this machine only, never synced, and only sent to `api.github.com`.

## How it works

```
content.js  ──port──▶  background.js  ──▶  api.github.com/users/{me}/following
 (render DOM)          (fetch + cache) ──▶  api.github.com/users/{u}/events/public   (with token)
                           │           ──▶  github.com/{u}.atom                       (no token)
                           ▼
                      summarize.js   normalize events → group by person / repo → build summary lines
```

- `src/i18n.js`: zh/en message table, shared everywhere
- `src/summarize.js`: pure functions, no DOM / chrome dependency, shared by the background worker and unit tests
- `src/background.js`: MV3 service worker. Following list cached 6h, events cached 10min, concurrency 6, ETag in REST mode, follower counts cached 7 days
- `src/content.js`: injects the panel into `#dashboard .news` on `github.com/`, hides the original `feed-container`, re-injects on Turbo navigation
- `src/options.*`: language, token, default time range, hide original feed / Copilot box

## Development

```sh
npm test          # node --test, zero dependencies
```

After editing, click the reload button on the extension card in `chrome://extensions`, then reload github.com.

## Known limitations

- Only **public** events are visible. That is a limit of the GitHub Events API
- The Events API can lag by up to 5 minutes
- Only people you follow are included, not watched or starred repos. Adding another source next to `getFollowing` in `background.js` is straightforward
