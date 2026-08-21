# Public /about page and AEO for PD Care

## Goal

Give Google and answer engines one crawlable page that states what PD Care is, who built it, who it is for, and that AI output is not a diagnosis. Target long-tail queries such as 臺大醫院 腹膜透析、腹膜透析 出口 影像、智慧醫療 腹膜透析 — not generic 台大醫院.

## Non-goals

- Turning `/` into a brochure (it stays the LIFF / app entry; logged-in bounce unchanged)
- Keyword-stuffing existing 衛教 posts
- Phone number, usage counts, papers, or App Store claims
- CMS, bilingual about, RSS, or paid search
- Claiming PD Care *is* 臺大醫院 (it is a joint project used at the PD center)

## Canonical URL

`/about`. Indexable. Canonical `https://pd.lu.im.ntu.edu.tw/about` (via `NEXT_PUBLIC_SITE_URL`).

## Allowed facts

Only these, plus the patent already published on the privacy policy:

- 臺大醫院腹膜透析中心與國立臺灣大學資訊管理學系合作研發
- 給本院腹膜透析病友使用；出口照片進入透析室照護流程
- 可稱為智慧醫療／AI 輔助出口感染偵測；輔助、不構成診斷
- 病患可從 LINE 每日拍攝出口照片
- 中華民國專利 M678111「腹膜透析智慧辨識系統」（already on `/privacy-policy`）

Do not add the dialysis-unit phone on this page.

## Page content

Institutional tone (written for outsiders and models, not 衛教口吻). zh-TW. Reuse blog article type sizes so it stays readable.

1. **H1:** `PD Care｜臺大醫院腹膜透析智慧照護`
2. **Lead (one paragraph):** name the collaboration, that it is for NTUH PD patients, daily exit-site photos over LINE, AI assists staff and is not a diagnosis.
3. **What it does:** daily exit-site images, staff review, AI risk flag as triage — not a replacement for clinic visits.
4. **Who built it:** NTUH PD center × NTU IM; photos are reviewed in the dialysis unit workflow.
5. **FAQ** (visible `<h2>` + `<h3>`/`<p>`, same text as JSON-LD):

| Question | Answer gist |
| --- | --- |
| PD Care 是什麼？ | NTUH PD patients photograph the catheter exit site daily so the care team can see changes between clinic visits. AI may flag images for earlier review. |
| 和臺大醫院、臺大資管系有什麼關係？ | Joint project of the NTUH peritoneal dialysis center and NTU Department of Information Management. Not a third-party consumer app. |
| 病患要怎麼使用？ | Open via LINE, bind identity, photograph the exit site daily after approval. How-to lives on `/blog`. |
| AI 結果是診斷嗎？ | No. Assistive only. Redness, pain, discharge, or feeling unwell → call the dialysis unit, do not wait on the app. |

6. **Links:** 最新消息 (`/blog`), 開始使用 (`/role-select`). No phone.

Exact wording lives in `app/about/page.tsx` (or a small `lib/seo/about-copy.ts` if JSON-LD must reuse the FAQ strings — prefer one source).

## Machine-readable layer (AEO)

### Metadata

- Title: `PD Care｜臺大醫院腹膜透析智慧照護`
- Description: one sentence with 腹膜透析、臺大醫院、智慧醫療、出口影像, plus 非診斷.
- `openGraph.locale`: `zh_TW`. `alternates.canonical` on `/about`.
- Root layout description may mention 臺大醫院腹膜透析智慧照護; do not turn it into a keyword list.

### JSON-LD (one or more `<script type="application/ld+json">` on `/about`)

- `WebSite`: name PD Care, url site origin, `inLanguage` zh-TW
- `Organization`: name `PD Care`; `parentOrganization` / affiliation text for 臺大醫院腹膜透析中心 and 國立臺灣大學資訊管理學系; url `/about`
- `WebPage`: `about` the service, `isPartOf` WebSite. Do **not** use `MedicalOrganization` or `MedicalWebPage` (those read as if PD Care were the hospital).
- `FAQPage` with the four Q&As verbatim from the page
- Optional `SoftwareApplication`: name PD Care, applicationCategory HealthApplication, offers none

Reuse the same Organization `name` as article byline (`臺大醫院 PD Care 團隊`) only if it does not collide with claiming the whole hospital. Prefer `PD Care` as Organization name and put the two institutions in `memberOf` / description.

Blog posts keep existing `BlogPosting` JSON-LD. Do not change post JSON-LD in this work.

### `llms.txt`

`GET /llms.txt` (`text/plain; charset=utf-8`) via a Route Handler. Contents:

- One-line summary (collaboration, LINE daily photos, assistive AI, not diagnosis)
- Links: `/about`, `/blog`, `/privacy-policy`, `/terms-of-use`
- Explicit: do not cite patient data, `/patient`, `/admin`

No `llms-full.txt`.

## Discovery

- Public header (shared with blog): add `關於` → `/about` next to `最新消息`
- Landing `/` footer: add the same link
- `SITEMAP_STATIC_PATHS` includes `/about` (no `lastModified`, same as other static routes)
- `robots.ts` already allows `/`; no change unless we add a new private prefix

## Implementation sketch

| Piece | Where |
| --- | --- |
| Page | `apps/frontend/app/about/page.tsx` |
| Layout | `apps/frontend/app/about/layout.tsx` reusing `BlogHeader` (do not rename) |
| Copy + FAQ | one module imported by the page and JSON-LD builder |
| JSON-LD helpers | `apps/frontend/lib/seo/jsonld.ts` |
| llms.txt | `apps/frontend/app/llms.txt/route.ts` |
| Sitemap | `lib/blog/sitemap.ts` |
| Header / home footer | `blog-header.tsx`, `app/page.tsx` |

Frontend-only. No backend, no migration, no secrets.

## Tests

- Sitemap static URLs include `{site}/about`
- `llms.txt` body includes `/about`, collaboration wording, and does not list `/patient`
- About page renders H1 and all four FAQ questions
- JSON-LD builder unit test: FAQ answers match copy module; `@type` includes `FAQPage` and `Organization`

## Success bar (honest)

Crawlers can find a single factual page; models that fetch `/about` or `/llms.txt` get affiliation + non-diagnosis. Ranking for 台大醫院 alone is out of scope.
