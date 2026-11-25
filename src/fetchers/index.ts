import type { Source } from '../config/sources';
import type { Candidate, FetchContext } from '../types';
import { fetchDiscourse } from './discourse';
import { fetchEipSheet } from './eipsheet';
import { fetchEipStatus } from './eipstatus';
import { fetchForkcastCalls } from './forkcast';
import { fetchReleases } from './releases';
import { fetchRss } from './rss';

export function runFetcher(source: Source, ctx: FetchContext): Promise<Candidate[]> {
  switch (source.type) {
    case 'rss':
      return fetchRss(source, ctx);
    case 'github_releases':
      return fetchReleases(source, ctx);
    case 'discourse':
      return fetchDiscourse(source, ctx);
    case 'forkcast_calls':
      return fetchForkcastCalls(source, ctx);
    case 'eip_sheet':
      return fetchEipSheet(source, ctx);
    case 'eip_status':
      return fetchEipStatus(source, ctx);
  }
}
