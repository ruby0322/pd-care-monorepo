# Blog screenshot catalog

Capture **named** patient-UI screenshots from the real stub app (LIFF bypass + seeded `/dev/personas`) into `apps/frontend/public/blog/`. Future posts should **reuse these files** in MDX. Add a new shot only when a post needs a screen that is not already listed.

## Prerequisites

From the monorepo root:

```bash
npm run dev:infra
npm run seed:dev-personas
# apps/frontend/.env.local: leave NEXT_PUBLIC_LIFF_ID unset
npm run dev
```

`ffmpeg` is optional. When present, the capture viewfinder uses `public/blog/stock-exit-site.jpg` as a fake camera still.

## Commands

From `apps/frontend`, or via the root script:

```bash
npm run blog:screenshots                 # all catalog shots
npm run blog:screenshots -- --list
npm run blog:screenshots -- --only home,result
npm run blog:screenshots -- --only capture --out /tmp/blog-shots
```

`--only` ids run in **catalog order**, not argument order. `capture` and `result` share one login/upload session.

## Use in a new article

In `apps/frontend/content/blog/<slug>.mdx`:

```mdx
![核可後的病患首頁](/blog/shot-home.png)
```

| id | file | When to reuse |
| --- | --- | --- |
| `role-select` | `shot-role-select.png` | 選身份 |
| `bind` | `shot-bind.png` | 填病歷號 |
| `pending` | `shot-pending.png` | 等待審核 |
| `home` | `shot-home.png` | 已綁定首頁 / 日曆 |
| `capture` | `shot-capture.png` | 拍攝觀景窗 |
| `result` | `shot-result.png` | 輔助判讀結果 |

Demo exit-site photo: `stock-exit-site.jpg` (license in `public/blog/LICENSES.md`). Never use NTUH / training-set patients.

## Add a shot

1. Add an entry to `catalog.ts` (`id`, `file`, `description`; set `flow` only if it must share a session with another shot).
2. Implement a runner in `shots.ts` (or extend an existing flow).
3. Wire it in `index.ts` if it is independent.
4. Run `npm run blog:screenshots -- --only <id>` and commit the PNG plus catalog change.

Viewport is 390×844 at `deviceScaleFactor: 2`, no device bezel. The Next.js dev overlay is hidden.
