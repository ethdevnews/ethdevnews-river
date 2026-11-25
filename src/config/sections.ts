// Sections follow ethdevnews season 1. Order here is display order.
// Change freely: items reference sections by id.

export interface Section {
  id: string;
  name: string;
  description: string;
}

export const SECTIONS: Section[] = [
  { id: 'acd', name: 'All core devs', description: 'Core devs calls, breakouts and inclusion decisions (PFI, CFI, SFI, DFI)' },
  { id: 'l1', name: 'Layer 1', description: 'Upgrades, devnets, testnets and core EIPs' },
  { id: 'staking', name: 'Staking', description: 'Client releases and staking' },
  { id: 'l2', name: 'Layer 2', description: 'Rollups and RIPs' },
  { id: 'research', name: 'Research', description: 'ethresear.ch and research posts from allowlisted authors' },
  { id: 'ecosystem', name: 'Ecosystem', description: 'Ethereum Foundation, ethereum.org and community' },
  { id: 'developers', name: 'Developers', description: 'Languages, frameworks, libraries and ERCs' },
  { id: 'security', name: 'Security', description: 'Disclosures and post-mortems from the affected projects, and SEAL' },
  { id: 'applications', name: 'Applications', description: 'Applications, from their own announcements' },
  { id: 'regulation', name: 'Regulation', description: 'From regulators and governments themselves' },
  { id: 'general', name: 'General', description: 'Everything else' },
];

export const SECTION_IDS = new Set(SECTIONS.map((s) => s.id));

export function sectionName(id: string): string {
  return SECTIONS.find((s) => s.id === id)?.name ?? id;
}
