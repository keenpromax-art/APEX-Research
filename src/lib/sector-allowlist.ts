// Self-healing sector concept allow-list.
// Records (sectorId, concept) pairs approved as legitimate for a sector,
// so false-positive QA blocks never recur for any company.
const KEY = "apex-sector-allowlist-v1";

type Entry = { sectorId: string; concept: string };

function load(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Entry[]) : [];
  } catch {
    return [];
  }
}

function save(list: Entry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore quota errors */
  }
}

export function getAllowlistedConcepts(sectorId: string): string[] {
  return load().filter((e) => e.sectorId === sectorId).map((e) => e.concept);
}

export function allowConcept(sectorId: string, concept: string): void {
  const list = load();
  if (!list.some((e) => e.sectorId === sectorId && e.concept === concept)) {
    list.push({ sectorId, concept });
    save(list);
  }
}
