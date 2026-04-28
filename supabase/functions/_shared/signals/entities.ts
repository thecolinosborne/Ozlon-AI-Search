// Signal Envelope — entity matcher
// Trie-cached per user. Matches account/workspace/integration names in O(text length).

interface Entity {
  kind: string;          // e.g. "ghl", "clickup", "gmail"
  id: string;
  name: string;
  payload?: Record<string, unknown>;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  matches: Entity[];
}

interface CachedTrie {
  builtAt: number;
  signature: string;     // invalidation key (e.g. integrations updated_at)
  trie: TrieNode;
}

const cache = new Map<string, CachedTrie>();
const MAX_CACHE_AGE_MS = 5 * 60 * 1000;

function buildTrie(entities: Entity[]): TrieNode {
  const root: TrieNode = { children: new Map(), matches: [] };
  for (const e of entities) {
    const tokens = e.name.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    let node = root;
    for (const t of tokens) {
      let next = node.children.get(t);
      if (!next) {
        next = { children: new Map(), matches: [] };
        node.children.set(t, next);
      }
      node = next;
    }
    node.matches.push(e);
  }
  return root;
}

export function getEntityTrie(
  userId: string,
  signature: string,
  entities: Entity[],
): TrieNode {
  const existing = cache.get(userId);
  if (
    existing &&
    existing.signature === signature &&
    Date.now() - existing.builtAt < MAX_CACHE_AGE_MS
  ) {
    return existing.trie;
  }
  const trie = buildTrie(entities);
  cache.set(userId, { builtAt: Date.now(), signature, trie });
  return trie;
}

export interface EntityMatch {
  entity: Entity;
  position: number;
}

export function matchEntities(text: string, trie: TrieNode): EntityMatch[] {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const found: EntityMatch[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let node = trie;
    for (let j = i; j < tokens.length; j++) {
      const next = node.children.get(tokens[j]);
      if (!next) break;
      node = next;
      if (node.matches.length > 0) {
        for (const e of node.matches) found.push({ entity: e, position: i });
      }
    }
  }
  // Dedupe by entity id, keep latest mention
  const seen = new Map<string, EntityMatch>();
  for (const m of found) {
    seen.set(`${m.entity.kind}:${m.entity.id}`, m);
  }
  return Array.from(seen.values());
}

export type { Entity };
