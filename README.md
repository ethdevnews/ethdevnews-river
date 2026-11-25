# ethdevnews river

A running feed of Ethereum developer news, inspired by Techmeme's river. It collects items around the clock from **primary sources only**, groups related items into stories, and serves them as a web page, RSS, JSON Feed and an API. Nobody edits it. The [ethdevnews](https://ethdevnews.com) weekly issue will be written from it.

Live at **https://river.ethdevnews.com** (once deployed).

It's a single Cloudflare Worker with a D1 database and a cron trigger. No model is used yet: every item shows the source's own title.

## What goes in

| Source | What becomes an item | Tag |
| --- | --- | --- |
| [ethereum/pm](https://github.com/ethereum/pm) call manifest + [Forkcast](https://forkcast.org) | Each ACDE, ACDC and ACDT call, linked to its Forkcast page, with Forkcast's decisions on that call (PFI, CFI, SFI, DFI and others) grouped under it | Forkcast |
| [EIP/ERC numbering sheet](https://docs.google.com/spreadsheets/d/1OkxGKP9e_GJvIswYxrLaVm03GOyXcSjNflp7_rb8SD0) | Each newly numbered EIP, ERC or RIP. Links to Forkcast when Forkcast has a page for the EIP, otherwise to its PR | Forkcast / EIPs / ERCs / RIPs |
| EIPs and ERCs repositories | Status changes: Review, Last Call, Final, Living, Withdrawn | EIPs / ERCs |
| Ethereum Magicians | New topics in the EIP and ERC categories, core devs call threads, and topics naming an EIP, ERC, upgrade or upgrade naming | Eth Magicians |
| ethresear.ch | Posts by allowlisted authors. Others are held until something primary links to them | ethresear.ch |
| GitHub releases | Stable releases of clients, specs and developer tools | GitHub |
| Blogs (RSS/Atom) | Posts from project and team blogs | the blog's own tag |
| Bots | Individual URLs, under the trust rules below | the site's tag, or X |

All of this is configuration:

- [`src/config/sources.ts`](src/config/sources.ts): the source list.
- [`src/config/rules.ts`](src/config/rules.ts): ethresear.ch authors, Magicians categories, trusted domains and X accounts, non-primary domains, rejected title words, upgrade names, story windows, hold time.
- [`src/config/sections.ts`](src/config/sections.ts): sections (ethdevnews season 1).

Change those files to change what the river does. Never edit individual items.

## Stories

Items are grouped into stories by, strongest first: core devs call (`call:acde:249`), EIP/ERC number (`eip:7928`), RIP number, release version (`release:geth:1.17.2`, which also catches the project's blog post announcing it), upgrade name (`upgrade:glamsterdam`), and links between items. Each story has one headline item, chosen by kind: call, then EIP, release, post, status change, discussion, decision. A story rises to the top when something new joins it. Windows for joining a story are in `STORY_WINDOW_DAYS`.

## Pages and feeds

- `/` the river, `/s/<section>` one section, `/story/<id>` a story with its timeline
- `/week` the last 7 days by section (what the weekly issue will be written from)
- `/sources` source health, bots and the held queue
- `/about` the rules, in plain words
- `/feed.xml`, `/feed.json`, `/s/<section>/feed.xml`, `/s/<section>/feed.json`
- `/api/stories.json?section=&since=<ISO date>&limit=` full story and item data
- `/api/sources.json`

## Bots

Bots add individual items with `POST /api/submit`:

```sh
curl -X POST https://river.ethdevnews.com/api/submit \
  -H "authorization: Bearer $BOT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"url": "https://x.com/VitalikButerin/status/123", "section": "research", "note": "why it matters", "evidence_url": "optional primary source"}'
```

The river fetches the page itself (X posts through X's public oEmbed endpoint) and keeps its own title. Then:

- **Rejected**: news outlets and aggregators (unless `evidence_url` gives the primary source, which is used instead), token sales, airdrops, price news, pages that can't be fetched. HTTP 422.
- **Live straight away**: URLs on a trusted domain or X account (`TRUSTED_DOMAINS`, `TRUSTED_X_ACCOUNTS`, plus every configured source's own site or repo), or from a bot with `trusted` standing.
- **Held**: other primary URLs. Published when a second bot submits the same URL or a published item links to it. Expire after 72 hours.

Bots start on `probation`. A bot gains a point when its item goes live and loses one when its item is rejected as non-primary or expires. At 25 points it becomes `trusted`; at -15 it's `blocked`.

Admin API (header `authorization: Bearer $ADMIN_TOKEN`):

```sh
# Create a bot. The token is shown once.
curl -X POST $SITE/api/admin/bots -H "authorization: Bearer $ADMIN_TOKEN" -d '{"name": "grok-scanner"}'
curl $SITE/api/admin/bots -H "authorization: Bearer $ADMIN_TOKEN"
curl -X PATCH $SITE/api/admin/bots/1 -H "authorization: Bearer $ADMIN_TOKEN" -d '{"standing": "trusted"}'
# Publish or remove an item
curl -X PATCH $SITE/api/admin/items/42 -H "authorization: Bearer $ADMIN_TOKEN" -d '{"status": "rejected", "reason": "duplicate"}'
# Run sources now: one, or all
curl -X POST $SITE/api/admin/run -H "authorization: Bearer $ADMIN_TOKEN" -d '{"source": "forkcast-calls"}'
curl -X POST $SITE/api/admin/run -H "authorization: Bearer $ADMIN_TOKEN" -d '{"all": true}'
```

## Schedule and limits

The cron runs every 10 minutes and fetches up to `SOURCES_PER_RUN` sources that are due, oldest first. Each source has its own interval (`every`, in minutes). A failing source backs off, and after 7 days of failures it's muted and retried once a day; `/sources` shows why.

Items first published more than 10 days before the river sees them are skipped, so the first run doesn't backfill old news. The EIP sheet's existing rows are recorded on the first run and only rows added after that become items.

Running cost: the Workers free plan allows 100,000 requests a day and 5 GB of D1, far more than this needs. The free plan's CPU limit per invocation is tight for parsing many feeds, so if `/sources` shows CPU errors, either lower `SOURCES_PER_RUN` or move to Workers Paid ($5 a month).

## Develop

```sh
npm install
npm test                 # unit tests + D1-backed integration tests
npm run typecheck
echo 'ADMIN_TOKEN=local-admin' > .dev.vars
npm run db:migrate:local
npm run dev              # http://localhost:8787
curl -X POST localhost:8787/api/admin/run -H 'authorization: Bearer local-admin' -d '{"all":true}'
```

## Deploy

One-off setup, with a Cloudflare API token that can edit Workers, D1 and the `ethdevnews.com` zone's DNS:

```sh
export CLOUDFLARE_API_TOKEN=...
npx wrangler d1 create river          # put the printed database_id in wrangler.toml
npm run db:migrate                    # create the tables
npx wrangler secret put ADMIN_TOKEN   # any long random string
npx wrangler secret put GITHUB_TOKEN  # optional: read-only token, for EIP PR titles
npm run deploy                        # also attaches river.ethdevnews.com
curl -X POST https://river.ethdevnews.com/api/admin/run -H "authorization: Bearer $ADMIN_TOKEN" -d '{"all":true}'
```

After that, pushes to `main` deploy through GitHub Actions if the repository has `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.

## Later

- One-line AI summaries per item, behind a config flag (`items.summary` is already there).
- A scheduled Grok scanner that finds primary posts on X and submits them through `/api/submit` (needs an xAI key).
- Phase 2: generating the weekly issue from `/api/stories.json`.
