import type { ContentAtomType } from './types';

// Async SHA-256 helper
export async function sha256(str: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Updated Simhash implementation (async) - 256-bit
export async function simhash(content: string): Promise<string> {
    const tokens = content.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) return "0".repeat(64);

    // Use an array of 256 counters (initially 0)
    const vector = new Array(256).fill(0);

    // Calculate SHA-256 hashes in parallel (32 bytes = 256 bits)
    const hashes = await Promise.all(tokens.map(token =>
        crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
            .then(buf => new Uint8Array(buf))
    ));

    for (const hash of hashes) {
        for (let i = 0; i < 32; i++) { // 32 bytes
            const byte = hash[i];
            for (let bit = 0; bit < 8; bit++) { // 8 bits per byte
                const globalBitIndex = i * 8 + bit;
                // Check if the bit is set
                if ((byte >> bit) & 1) {
                    vector[globalBitIndex]++;
                } else {
                    vector[globalBitIndex]--;
                }
            }
        }
    }

    // Generate 256-bit fingerprint
    // Since JS numbers are 32-bit for bitwise ops, we construct byte by byte
    const fingerprintBytes = new Uint8Array(32); // 256 bits

    for (let i = 0; i < 32; i++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
            const globalBitIndex = i * 8 + bit;
            if (vector[globalBitIndex] > 0) {
                byte |= (1 << bit);
            }
        }
        fingerprintBytes[i] = byte;
    }

    // Convert to hex string (64 chars)
    return Array.from(fingerprintBytes).map(b => b.toString(16).padStart(2, '0')).join('');
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

// Updated generateContentHash (async)
export async function generateContentHash(content: string): Promise<string> {
    // Return SHA-256 hex string
    return await sha256(content);
}
