import registryDocument from '../data/official-sources.json' with { type: 'json' };

export type RegisteredSourceCategory = 'regulator' | 'label' | 'gov';

export interface RegisteredSource {
  id: string;
  name: string;
  category: RegisteredSourceCategory;
  authoritative: boolean;
  independenceGroup: string;
  allowedHosts: string[];
}

export interface CitationIdentity {
  url?: string;
  sourceId?: string;
}

const sources = registryDocument.sources as RegisteredSource[];
const sourcesById = new Map(sources.map((source) => [source.id, source]));

function normalizedHost(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return undefined;
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function hostMatches(host: string, allowed: string): boolean {
  const base = allowed.toLowerCase().replace(/^www\./, '');
  return host === base || host.endsWith(`.${base}`);
}

export function sourceById(id: string | undefined): RegisteredSource | undefined {
  return id ? sourcesById.get(id) : undefined;
}

export function sourceForUrl(url: string | undefined): RegisteredSource | undefined {
  if (!url) return undefined;
  const host = normalizedHost(url);
  if (!host) return undefined;
  return sources.find((source) => source.allowedHosts.some((allowed) => hostMatches(host, allowed)));
}

/** Stable source identity: registry ID for known authorities, otherwise HTTPS host. */
export function sourceIdentityForUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const registered = sourceForUrl(url);
  if (registered) return registered.id;
  const host = normalizedHost(url);
  return host ? `web:${host}` : undefined;
}

/** Every declared sourceId must be the deterministic identity for its URL. */
export function citationSourceIdentityMatches(citation: CitationIdentity): boolean {
  const expected = sourceIdentityForUrl(citation.url);
  return expected !== undefined && citation.sourceId === expected;
}

/** Resolve a registered authority only when its required sourceId agrees with the URL. */
export function resolveRegisteredSource(citation: CitationIdentity): RegisteredSource | undefined {
  const byUrl = sourceForUrl(citation.url);
  if (!byUrl || citation.sourceId !== byUrl.id) return undefined;
  return byUrl;
}

/** Only a registry-approved HTTPS URL can be an authoritative anchor. */
export function isRegisteredAuthoritativeSource(citation: CitationIdentity): boolean {
  return resolveRegisteredSource(citation)?.authoritative === true;
}

/**
 * Identity used to prove evidence diversity. Registered feeds combine their
 * independence group with the canonical document URL; unregistered HTTPS
 * sources use hostname + URL. Duplicate links never count twice, while two
 * distinct official documents may corroborate different fields.
 */
export function citationIndependenceGroup(citation: CitationIdentity): string | undefined {
  if (!citationSourceIdentityMatches(citation)) return undefined;
  const registered = resolveRegisteredSource(citation);
  if (registered && citation.url) {
    const parsed = new URL(citation.url);
    parsed.hash = '';
    return `registered:${registered.independenceGroup}:${parsed.href}`;
  }
  if (!citation.url) return undefined;
  const host = normalizedHost(citation.url);
  if (!host) return undefined;
  const parsed = new URL(citation.url);
  parsed.hash = '';
  return `external:${host}:${parsed.href}`;
}

export function distinctCitationSourceCount(citations: CitationIdentity[]): number {
  return new Set(citations.map(citationIndependenceGroup).filter(Boolean)).size;
}

export function registeredSources(): readonly RegisteredSource[] {
  return sources;
}
