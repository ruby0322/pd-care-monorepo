# Public MDX blog for PD Care

## Goal

Add a public Traditional Chinese blog at `/blog` so new patients can onboard, returning patients can read care/platform updates, and search engines can index non-PHI pages.

## Non-goals

- Payload (or any) CMS runtime / new container
- Storing posts in Postgres or SeaweedFS
- In-app `/patient/blog` reader
- Tags, RSS, search, comments, pagination, bilingual copies

## Authoring

Git-backed MDX in `apps/frontend/content/blog/<slug>.mdx`.

Frontmatter:

- `title`, `description`, `publishedAt` (`YYYY-MM-DD`), `author`, `draft`

`draft: true` is omitted from production lists and sitemap; visible in development.

Media lives in `apps/frontend/public/blog/` (git). Compiler: `gray-matter` + `next-mdx-remote/rsc` + `remark-gfm`.

## Launch posts

| Title | Slug | Date | Job |
| --- | --- | --- | --- |
| 三分鐘學會拍照上傳 | `三分鐘學會拍照上傳` | 2026-08-20 | Product onboarding with phone screenshots |
| 每天拍一張，讓感染風險離你遠一點 | `每天拍一張` | 2026-08-21 | Platform value explainer |

Byline: `臺大醫院 PD Care 團隊`.

OG image: generated title card (`opengraph-image`), not a screenshot.

## Visibility and chrome

- Public: `/blog`, `/blog/[slug]`. No login. Logged-in users are **not** redirected away.
- Header: site name → `/`, `最新消息` → `/blog`, `開始使用` → `/role-select`. `返回 App` → `/patient` if patient session, else `/apps` if staff/admin session.
- Landing `/`: fourth feature card + footer `最新消息`. Logged-in bounce off `/` is unchanged.
- Locale: `zh-TW` only; Chinese slugs.

## Patient-home discovery

- **Unbound:** text link `為什麼每天拍一張有幫助？` → value post. No banner.
- **Pending:** always-on banner `審核通過後就能拍照，先看三步驟教學` → onboarding post. No dismiss.
- **Matched:** dismissible banner `還沒拍過？三步驟學會上傳出口照` + `最新消息` strip (title, date, `閱讀`, `更多` → `/blog`). Hide 最新消息 only when its slug equals the still-visible banner slug.
- Dismiss stored as `liff_identities.onboarding_guide_dismissed_at`. Written only when matched user taps X. `GET /v1/patient/profile` includes `onboarding_guide_dismissed`. `PATCH /v1/patient/ui-preferences` `{ "onboarding_guide_dismissed": true }` is idempotent.

## SEO and legal

- `robots.ts`: allow `/`, `/blog`, legal; disallow `/patient`, `/admin`, `/login`, `/onboarding`, `/apps`, `/dev`, `/api`, `/role-select`.
- `sitemap.ts`: `/`, `/blog`, posts, privacy/terms (+ `/en`).
- `noindex` on patient and admin layouts.
- Article footer: 本系統為輔助照護工具，AI 結果不構成診斷；不適或緊急請聯絡透析室 / 原就醫團隊.
- `metadataBase` via `NEXT_PUBLIC_SITE_URL`.

## Screenshots

- Capture named screenshots of the real stub UI with Playwright (`npm run blog:screenshots`, catalog in [`apps/frontend/scripts/blog-screenshots/README.md`](../../../apps/frontend/scripts/blog-screenshots/README.md)): LIFF bypass, seeded `/dev/personas`, 390×844, `deviceScaleFactor: 2`, no device bezel. Hide the Next.js dev overlay. Reuse catalog files in new posts; add a shot to the catalog only when a post needs a new screen.
- Exit-site demo photo: free-to-reuse clinical photograph (CC BY 4.0), never NTUH / training-set patients. License recorded in `public/blog/LICENSES.md`.
- Commit generated PNGs; regeneration script is optional.

## Deploy

Frontend + backend. Schema change requires the prod `backend-migrate` Job before backend rollout. Do not wipe volumes.
