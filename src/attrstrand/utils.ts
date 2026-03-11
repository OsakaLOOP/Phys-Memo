import type { ContentAtomType, ContentAtomAttr } from './types.ts';

// Async SHA-256 helper
export async function sha256(str: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Async SHA-256 to 32-bit integer helper (for Simhash)
export async function sha256Int(str: string): Promise<number> {
    const msgBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    // Use first 4 bytes as int
    const view = new DataView(hashBuffer);
    return view.getInt32(0); // big-endian by default in DataView but we just need bits
}

// Deterministic JSON stringify (sorts keys)
export function deterministicStringify(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
        const arr = obj.map(item => JSON.parse(deterministicStringify(item)));
        return JSON.stringify(arr);
    }

    const sortedKeys = Object.keys(obj).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
        result[key] = JSON.parse(deterministicStringify((obj as Record<string, unknown>)[key]));
    }
    return JSON.stringify(result);
}

// Hashing Functions conforming to CAS principles

// conceptId: hashkey=CONCEPT::${name}|${creatorId}|${timestampISO}
export async function generateConceptHash(name: string, creatorId: string, timestampISO: string): Promise<string> {
    const key = `CONCEPT::${name}|${creatorId}|${timestampISO}`;
    return await sha256(key);
}

// atomId: hashkey=ATOM::${field}|${type}|${contentHash}|${creatorId}|${derivedFromId}|${sortedAttr}
export async function generateAtomHash(
    field: string,
    type: string,
    contentHash: string,
    creatorId: string,
    derivedFromId: string | null,
    attr: ContentAtomAttr
): Promise<string> {
    const sortedAttr = deterministicStringify(attr);
    const derivedStr = derivedFromId === null ? 'null' : derivedFromId;
    const key = `ATOM::${field}|${type}|${contentHash}|${creatorId}|${derivedStr}|${sortedAttr}`;
    return await sha256(key);
}

// editionId: hashkey=EDITION::${conceptId}|${parentEditionId}|${serializedAtoms}|${creatorId}|${timestampISO}
export async function generateEditionHash(
    conceptId: string,
    parentEditionId: string | null,
    coreAtomIds: string[],
    docAtomIds: string[],
    tagsAtomIds: string[],
    refsAtomIds: string[],
    relsAtomIds: string[],
    creatorId: string,
    timestampISO: string
): Promise<string> {
    const parentStr = parentEditionId === null ? 'null' : parentEditionId;

    // Sort array elements or keep order? Order matters for lists like docs and refs.
    // So we just deterministic stringify an object containing them in a fixed order.
    const atomsData = {
        core: coreAtomIds,
        doc: docAtomIds,
        refs: refsAtomIds,
        rels: relsAtomIds,
        tags: tagsAtomIds
    };
    const serializedAtoms = deterministicStringify(atomsData);

    const key = `EDITION::${conceptId}|${parentStr}|${serializedAtoms}|${creatorId}|${timestampISO}`;
    return await sha256(key);
}

// Updated Simhash implementation (async)
export async function simhash(content: string): Promise<string> {
    const tokens = content.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) return "00000000";

    // Use an array of 32 counters (initially 0)
    const vector = new Array(32).fill(0);

    // Calculate hashes in parallel for performance
    const hashes = await Promise.all(tokens.map(token => sha256Int(token)));

    for (const hash of hashes) {
        for (let i = 0; i < 32; i++) {
            // Check if the i-th bit is set
            if ((hash >> i) & 1) {
                vector[i]++;
            } else {
                vector[i]--;
            }
        }
    }

    let fingerprint = 0;
    for (let i = 0; i < 32; i++) {
        if (vector[i] > 0) {
            fingerprint |= (1 << i);
        }
    }

    // Convert to unsigned 32-bit hex string
    return (fingerprint >>> 0).toString(16).padStart(8, '0');
}

export function splitContent(content: string, type: ContentAtomType): string[] {
    if (!content) return [];

    if (type === 'inline' || type === 'sources') { // Maps to tags/refs/rels logic
        return content.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    }

    if (type === 'markdown' || type === 'latex') {
        const atoms: string[] = [];
        const mathBlockRegex = /(\$\$[\s\S]*?\$\$)/g;

        const segments = content.split(mathBlockRegex);

        for (const segment of segments) {
            if (!segment.trim()) continue;

            if (segment.startsWith('$$') && segment.endsWith('$$')) {
                atoms.push(segment.trim());
            } else {
                const paragraphs = segment.split(/\n\s*\n+/);
                for (const p of paragraphs) {
                    if (p.trim()) {
                        atoms.push(p.trim());
                    }
                }
            }
        }

        return atoms;
    }

    return [content];
}

// Updated generateContentHash (async)
export async function generateContentHash(content: string): Promise<string> {
    // Return SHA-256 hex string
    return await sha256(content);
}
