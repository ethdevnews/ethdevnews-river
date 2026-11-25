import { SECTIONS } from '../config/sections';
import { escapeHtml as e } from '../lib/html';

export interface PageOpts {
  title: string;
  siteName: string;
  siteUrl: string;
  path: string;
  description?: string;
  feedPath?: string;
}

const CSS = `
:root{--bg:#fbfaf7;--fg:#1d1d1f;--muted:#6b6b70;--line:#e4e2dc;--link:#1d4ed8;--visited:#5b3fa8;--tag:#7c5a10;--chip:#f1eee6;--cfi:#0f766e;--dfi:#b42318;--sfi:#1d4ed8;--pfi:#7c5a10}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#121214;--fg:#e8e6e1;--muted:#9a9aa0;--line:#2a2a2e;--link:#8ab4ff;--visited:#c4a7ff;--tag:#e0b45c;--chip:#1e1e22;--cfi:#5eead4;--dfi:#fca5a5;--sfi:#93c5fd;--pfi:#e0b45c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:860px;margin:0 auto;padding:0 16px}
header{border-bottom:1px solid var(--line);padding:18px 0 10px;margin-bottom:8px}
.brand{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.brand a.name{font-weight:700;font-size:22px;color:var(--fg);letter-spacing:-.01em}
.brand .sub{color:var(--muted);font-size:14px}
nav{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:10px;font-size:14px}
nav a{color:var(--muted)}nav a.on{color:var(--fg);font-weight:600}
.day{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:26px 0 4px;padding-bottom:4px;border-bottom:1px solid var(--line)}
.story{padding:12px 0;border-bottom:1px solid var(--line)}
.meta{font-size:12.5px;color:var(--muted);margin-bottom:2px}.meta a{color:var(--muted)}
.story h2{font-size:17.5px;line-height:1.35;font-weight:600;margin:0}
.story h2 a:visited{color:var(--visited)}
.tag{font-size:12.5px;color:var(--tag);white-space:nowrap;font-weight:500}
a.tag{color:var(--tag)}
ul.sub{list-style:none;margin:6px 0 0;padding:0 0 0 14px;border-left:2px solid var(--line)}
ul.sub li{font-size:14.5px;margin:3px 0}
.more-label{font-size:12.5px;color:var(--muted);margin:6px 0 0}
.stage{display:inline-block;font-size:11px;font-weight:700;padding:0 5px;border-radius:4px;background:var(--chip);margin-right:4px;vertical-align:1px}
.stage-CFI{color:var(--cfi)}.stage-DFI{color:var(--dfi)}.stage-SFI{color:var(--sfi)}.stage-PFI{color:var(--pfi)}
.pager{margin:20px 0;font-size:14px}
footer{margin:40px 0 30px;padding-top:12px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.scroll{overflow-x:auto}
.ok{color:var(--cfi)}.bad{color:var(--dfi)}
h1{font-size:22px;margin:18px 0 6px}h3{margin:22px 0 4px;font-size:16px}
.prose p,.prose li{max-width:68ch}
code{font-size:13px;background:var(--chip);padding:1px 4px;border-radius:4px}
`;

export function layout(opts: PageOpts, body: string): string {
  const navLinks: [string, string][] = [
    ['/', 'River'],
    ...SECTIONS.map((s): [string, string] => [`/s/${s.id}`, s.name]),
    ['/week', 'This week'],
    ['/sources', 'Sources'],
    ['/about', 'About'],
  ];
  const feed = opts.feedPath ?? '/feed.xml';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(opts.title)}</title>
<meta name="description" content="${e(opts.description ?? 'Ethereum developer news from primary sources, collected automatically.')}">
<link rel="alternate" type="application/rss+xml" title="${e(opts.siteName)}" href="${e(opts.siteUrl + feed)}">
<link rel="alternate" type="application/feed+json" title="${e(opts.siteName)}" href="${e(opts.siteUrl + feed.replace(/\.xml$/, '.json'))}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>〰️</text></svg>">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="brand"><a class="name" href="/">${e(opts.siteName)}</a><span class="sub">Ethereum developer news from primary sources, collected automatically</span></div>
  <nav>${navLinks.map(([href, label]) => `<a href="${href}"${href === opts.path ? ' class="on"' : ''}>${e(label)}</a>`).join('')}<a href="${e(feed)}">RSS</a></nav>
</header>
<main>
${body}
</main>
<footer>
  Every item links to its primary source. Titles are the sources' own. Collected and grouped by software, with no human editing.
  <a href="/about">How it works</a> · <a href="https://ethdevnews.com">ethdevnews.com</a> · <a href="https://github.com/ethdevnews/ethdevnews-river">Source code</a>
</footer>
</div>
</body>
</html>`;
}
