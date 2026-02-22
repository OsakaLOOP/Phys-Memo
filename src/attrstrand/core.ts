import type {
    IConceptRoot, IEdition, IContentAtom, ContentAtomField, ContentAtomType, ContentAtomAttr
} from './types';
import { storage } from './storage';
import { simhash, generateContentHash } from './utils';

export interface AtomSubmission {
    content: string;
    derivedFromId?: string | null; // ID of the atom this was edited from
    field: ContentAtomField;
    type: ContentAtomType;
}

export class AttrStrandCore {

    // --- Similarity & Attribution ---

    private calculateSimilarity(hash1: string, hash2: string): number {
        // Hamming distance on hex strings
        const h1 = parseInt(hash1, 16);
        const h2 = parseInt(hash2, 16);
        // XOR gives 1s where bits differ
        // We use >>> 0 to treat them as unsigned for logical operations if needed,
        // but bitwise operators in JS convert to 32-bit signed int.
        // h1 ^ h2 works correctly for bit patterns.
        let xor = h1 ^ h2;
        let distance = 0;
        // Count set bits in 32-bit integer
        for(let i=0; i<32; i++) {
            if ((xor >> i) & 1) distance++;
        }

        // Sim = 1 - (Distance / 32)
        const sim = 1 - (distance / 32);
        return Math.max(0, sim);
    }

    private calculateAttribution(
        prevAttr: ContentAtomAttr,
        similarity: number,
        creatorId: string
    ): ContentAtomAttr {
        const newAttr: ContentAtomAttr = {};

        // 1. Inherit from previous authors scaled by similarity
        for (const [author, share] of Object.entries(prevAttr)) {
            newAttr[author] = share * similarity;
        }

        // 2. Add current creator's contribution (1 - similarity)
        const newShare = 1 - similarity;
        newAttr[creatorId] = (newAttr[creatorId] || 0) + newShare;

        // 3. Normalize to sum = 1
        let total = Object.values(newAttr).reduce((a, b) => a + b, 0);
        if (total === 0) {
             newAttr[creatorId] = 1;
             total = 1;
        }

        for (const author of Object.keys(newAttr)) {
            newAttr[author] /= total;
        }

        return newAttr;
    }

    // --- Core Operations ---

    async createConcept(
        name: string,
        creatorId: string,
        initialData: Record<ContentAtomField, AtomSubmission[]>,
        topic: string = 'General',
        disciplines: string[] = []
    ): Promise<IConceptRoot> {
        const conceptId = generateContentHash(name + Date.now());

        // Create initial edition
        const edition = await this.createEdition(
            conceptId,
            null,
            initialData,
            creatorId,
            'save' // Initial is always saved
        );

        const concept: IConceptRoot = {
            id: conceptId,
            name,
            topic,
            disciplines,
            creatorId,
            createdAt: new Date().toISOString(),
            currentHeads: { [edition.id]: 1 },
            frontMeta: {},
            backMeta: {}
        };

        await storage.saveConcept(concept);
        return concept;
    }

    async createEdition(
        conceptId: string,
        parentEditionId: string | null,
        data: Record<ContentAtomField, AtomSubmission[]>,
        creatorId: string,
        saveType: 'autosave' | 'save' | 'publish'
    ): Promise<IEdition> {
        const editionId = generateContentHash(conceptId + creatorId + Date.now());
        const timestamp = new Date().toISOString();

        const atomIds: Record<ContentAtomField, string[]> = {
            doc: [], core: [], tags: [], refs: [], rels: []
        };

        // Process each field
        for (const key of Object.keys(data)) {
            const field = key as ContentAtomField;
            const submissions = data[field];
            if (!submissions) continue;

            for (const sub of submissions) {
                // Ensure the submission uses the correct field
                const actualField = field;

                // 1. Calculate hashes
                const contentHash = generateContentHash(sub.content);
                const contentSimHash = simhash(sub.content);

                let prevAtom: IContentAtom | null = null;
                // Try to reuse existing atom if ID provided and content matches
                if (sub.derivedFromId) {
                    prevAtom = await storage.getAtom(sub.derivedFromId);
                }

                // Check for exact match reuse
                // We reuse ONLY if content matches AND (it's the same atom ID we are deriving from OR we find another atom with same contentHash?)
                // To safely reuse, we must be sure.
                // If prevAtom exists and has same contentHash, we can reuse it?
                // Yes, because Atoms are immutable content blocks. If content is same, it is the same block.
                // However, attribution is bound to the Atom.
                // If I copy a block from you (same content), I should reuse your block (and your attribution).
                // If I change it, I get new block.
                // So yes, reuse if content matches.

                if (prevAtom && prevAtom.contentHash === contentHash) {
                    atomIds[actualField].push(prevAtom.id);
                    continue;
                }

                // 3. New Atom required
                let attr: ContentAtomAttr = { [creatorId]: 1 };
                if (prevAtom) {
                    const similarity = (prevAtom.contentSimHash && contentSimHash)
                        ? this.calculateSimilarity(prevAtom.contentSimHash, contentSimHash)
                        : 0;

                    attr = this.calculateAttribution(prevAtom.attr, similarity, creatorId);
                }

                // Unique ID for the new atom
                const atomId = generateContentHash(sub.content + JSON.stringify(attr) + Date.now());

                const newAtom: IContentAtom = {
                    id: atomId,
                    field: actualField,
                    type: sub.type,
                    contentJson: sub.content,
                    contentHash,
                    contentSimHash,
                    creatorId,
                    createdAt: timestamp,
                    attr,
                    derivedFromId: sub.derivedFromId || null,
                    frontMeta: {},
                    backMeta: {}
                };

                await storage.saveAtom(newAtom);
                atomIds[actualField].push(atomId);
            }
        }

        const edition: IEdition = {
            id: editionId,
            conceptId,
            saveType,
            coreAtomIds: atomIds.core,
            docAtomIds: atomIds.doc,
            tagsAtomIds: atomIds.tags,
            refsAtomIds: atomIds.refs,
            relsAtomIds: atomIds.rels,
            creator: creatorId,
            createdAt: timestamp,
            parentEditionId,
            frontMeta: {},
            backMeta: {}
        };

        await storage.saveEdition(edition);

        // Update Concept Heads if concept exists
        if (saveType !== 'autosave') {
             const concept = await storage.getConcept(conceptId);
             if (concept) {
                 const newHeads = { ...concept.currentHeads };
                 // If this is a direct update, remove parent from heads
                 if (parentEditionId && newHeads[parentEditionId]) {
                     delete newHeads[parentEditionId];
                 }
                 // Add new head
                 newHeads[editionId] = Date.now();
                 concept.currentHeads = newHeads;
                 await storage.saveConcept(concept);
             }
        }

        return edition;
    }
}

export const core = new AttrStrandCore();
