import { UPGRADES } from '../config/rules';

// Group keys decide which story an item joins. Strongest first:
//   call:<series>:<n>   a core devs call (decisions and summary threads join it)
//   eip:<n>             an EIP or ERC (they share one number space)
//   rip:<n>             a rollup improvement proposal
//   release:<project>:<version>
//   upgrade:<name>      devnets, testnet dates and naming threads

const SERIES_LETTER: Record<string, string> = { c: 'acdc', e: 'acde', t: 'acdt' };
const SERIES_WORD: Record<string, string> = { consensus: 'acdc', execution: 'acde', testing: 'acdt' };

export function callKeyFromTitle(title: string): string | null {
  let m = title.match(/\bACD([CET])\b[^#\d]{0,25}#?\s*(\d{1,4})\b/i);
  if (m) return `call:${SERIES_LETTER[m[1].toLowerCase()]}:${parseInt(m[2], 10)}`;
  m = title.match(/All\s*Core\s*Devs?\s*[-–—:]?\s*(Execution|Consensus|Testing)[^#]{0,30}#\s*(\d{1,4})\b/i);
  if (m) return `call:${SERIES_WORD[m[1].toLowerCase()]}:${parseInt(m[2], 10)}`;
  return null;
}

export function eipNumbersFromText(text: string): { kind: 'eip' | 'rip'; n: number }[] {
  const out: { kind: 'eip' | 'rip'; n: number }[] = [];
  const re = /\b(EIP|ERC|RIP)[-\s#]?(\d{1,5})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const kind = m[1].toUpperCase() === 'RIP' ? 'rip' : 'eip';
    const n = parseInt(m[2], 10);
    if (!out.some((o) => o.kind === kind && o.n === n)) out.push({ kind, n });
  }
  return out;
}

export function versionFromText(text: string): string | null {
  const m = text.match(/\bv?(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)\b/);
  return m ? m[1] : null;
}

export function upgradeFromText(text: string): string | null {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  for (const w of words) if (UPGRADES[w]) return UPGRADES[w];
  return null;
}

export interface KeyInput {
  title: string;
  callKey?: string | null;
  eip?: number | null;
  project?: string | null;
  version?: string | null;
}

export function groupKeys(input: KeyInput): string[] {
  const keys: string[] = [];
  const push = (k: string | null | undefined) => {
    if (k && !keys.includes(k)) keys.push(k);
  };
  push(input.callKey ?? callKeyFromTitle(input.title));
  if (input.eip) push(`eip:${input.eip}`);
  for (const e of eipNumbersFromText(input.title).slice(0, 1)) push(`${e.kind}:${e.n}`);
  const version = input.version ?? (input.project ? versionFromText(input.title) : null);
  if (input.project && version) push(`release:${input.project}:${version.replace(/^v/i, '')}`);
  const up = upgradeFromText(input.title);
  if (up) push(`upgrade:${up}`);
  return keys;
}

export function keyType(key: string): string {
  return key.split(':')[0];
}
