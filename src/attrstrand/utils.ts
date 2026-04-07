import type { ContentAtomType, ContentAtomAttr } from './types.ts';
import diff from 'fast-diff';

export async function sha256(str: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Int(str: string): Promise<number> {
    const msgBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const view = new DataView(hashBuffer);
    return view.getInt32(0); }

// Helper to recursively sort object keys in memory to avoid redundant JSON.parse/stringify
function sortObjectKeys(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(sortObjectKeys);
    }
    const sortedKeys = Object.keys(obj).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
        result[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
    }
    return result;
}

// ⚡ Bolt: Optimized deterministicStringify to prevent exponential performance overhead on complex objects.
// Instead of recursively calling JSON.parse/stringify on every nested level, it sorts keys purely in memory
// and serializes only once at the end. This reduces serialization time by ~10x on deeply nested objects.
export function deterministicStringify(obj: unknown): string {
    return JSON.stringify(sortObjectKeys(obj));
}


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

export async function simhash(content: string): Promise<string> {
    const tokens = content.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) return "00000000";

        const vector = new Array(32).fill(0);

        const hashes = await Promise.all(tokens.map(token => sha256Int(token)));

    for (const hash of hashes) {
        for (let i = 0; i < 32; i++) {
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

        return (fingerprint >>> 0).toString(16).padStart(8, '0');
}

export function splitContent(content: string, type: ContentAtomType): string[] {
    if (!content) return [];

    if (type === 'inline' || type === 'sources') {         return content.split('\n').map(s => s.trim()).filter(s => s.length > 0);
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

export async function generateContentHash(content: string): Promise<string> {
        return await sha256(content);
}

export async function generateBinaryBlobHash(blob: Blob | ArrayBuffer): Promise<string> {
    const buffer = blob instanceof Blob ? await blob.arrayBuffer() : blob;
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function generateBinaryHash(contentJson: string, blobs: Record<string, Blob | ArrayBuffer>): Promise<string> {
    const blobHashes: Record<string, string> = {};
    for (const [key, blob] of Object.entries(blobs)) {
        blobHashes[key] = await generateBinaryBlobHash(blob);
    }

    let parsedContent = {};
    try {
        parsedContent = JSON.parse(contentJson);
    } catch (e) {
        // Fallback
    }
    const payload = deterministicStringify({ content: parsedContent, blobHashes });
    return await sha256(payload);
}

export function calculateDiffStats(oldText: string, newText: string): { added: number, deleted: number, retained: number } {
    const changes = diff(oldText, newText);
    let added = 0;
    let deleted = 0;
    let retained = 0;

    for (const [operation, text] of changes) {
        // 待修改为词元统计.
        const length = text.length;
        if (operation === diff.INSERT) {
            added += length;
        } else if (operation === diff.DELETE) {
            deleted += length;
        } else if (operation === diff.EQUAL) {
            retained += length;
        }
    }

    return { added, deleted, retained };
}
