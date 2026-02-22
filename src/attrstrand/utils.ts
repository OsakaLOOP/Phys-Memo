import type { ContentAtomType } from './types';

// Simple hash function for string to 32-bit integer
function stringHash(str: string): number {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash | 0; // Convert to 32bit integer
    }
    return hash;
}

// Basic Simhash implementation
export function simhash(content: string): string {
    const tokens = content.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) return "00000000";

    // Use an array of 32 counters (initially 0)
    const vector = new Array(32).fill(0);

    for (const token of tokens) {
        const hash = stringHash(token);
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
        // Regex to find $$...$$ blocks.
        // We capture the block so we can include it in the result.
        // We also match double newlines to split paragraphs.

        // Strategy:
        // 1. Find all display math blocks. Replace them with a unique placeholder that includes a newline,
        //    to ensure they are treated as separate "paragraphs" if they aren't already.
        //    Actually, if we want them as separate atoms, we should treat them as splitting delimiters.

        const mathBlockRegex = /(\$\$[\s\S]*?\$\$)/g;

        // Split content by math blocks first
        const segments = content.split(mathBlockRegex);

        for (const segment of segments) {
            if (!segment.trim()) continue;

            if (segment.startsWith('$$') && segment.endsWith('$$')) {
                // This is a math block, add as a single atom
                atoms.push(segment.trim());
            } else {
                // This is text (markdown), split by double newlines (paragraphs)
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

export function generateContentHash(content: string): string {
    let hash = 0;
    const str = content + "";
    if (str.length === 0) return "0";
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash | 0;
    }
    return (hash >>> 0).toString(16);
}
