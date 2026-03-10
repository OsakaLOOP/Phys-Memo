import type {
    IConceptRoot, IEdition, IContentAtom, ContentAtomField, ContentAtomAttr,
    EditionSubmission, AtomSubmission, hash, IPopulatedEdition
} from './types.ts';
import { storage } from './storage.ts';
import { simhash, generateConceptHash, generateAtomHash, generateEditionHash, generateContentHash } from './utils.ts';

export class AttrStrandCore {
    // --- Similarity & Attribution ---

    private calculateSimilarity(hash1: string, hash2: string): number {
        const h1 = parseInt(hash1, 16);
        const h2 = parseInt(hash2, 16);
        let xor = h1 ^ h2;
        let distance = 0;
        for(let i=0; i<32; i++) {
            if ((xor >> i) & 1) distance++;
        }
        const sim = 1 - (distance / 32);
        return Math.max(0, sim);
    }

    private calculateAttribution(
        prevAttr: ContentAtomAttr,
        similarity: number,
        creatorId: string
    ): ContentAtomAttr {
        const newAttr: ContentAtomAttr = {};
        for (const [author, share] of Object.entries(prevAttr)) {
            newAttr[author] = share * similarity;
        }
        const newShare = 1 - similarity;
        newAttr[creatorId] = (newAttr[creatorId] || 0) + newShare;

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

    // --- Backend API ---

    async getPopulatedEdition(editionId: hash): Promise<IPopulatedEdition | null> {
        const edition = await storage.getEdition(editionId);
        if (!edition) return null;

        const populate = async (ids: string[]) => {
            const atoms = await storage.getAtoms(ids);
            return atoms.map(a => {
                const { backMeta, ...rest } = a;
                return rest;
            });
        };

        return {
            ...edition,
            coreAtoms: await populate(edition.coreAtomIds),
            docAtoms: await populate(edition.docAtomIds),
            tagsAtoms: await populate(edition.tagsAtomIds),
            refsAtoms: await populate(edition.refsAtomIds),
            relsAtoms: await populate(edition.relsAtomIds),
        };
    }

    async submitEdition(submission: EditionSubmission, creatorId: string, timestampISO: string): Promise<IEdition> {
        // Concept Handling
        let conceptId = submission.conceptId;
        let isNewConcept = false;

        // If conceptId is empty or doesn't exist, create it
        if (!conceptId) {
            conceptId = await generateConceptHash(submission.conceptName, creatorId, timestampISO);
            isNewConcept = true;
        } else {
            const existingConcept = await storage.getConcept(conceptId);
            if (!existingConcept) {
                isNewConcept = true;
            }
        }

        if (isNewConcept) {
            const newConcept: IConceptRoot = {
                id: conceptId,
                name: submission.conceptName,
                topic: submission.conceptTopic,
                disciplines: submission.conceptDisciplines,
                creatorId,
                timestampISO,
                currentHeads: {},
                frontMeta: {},
                backMeta: { createdAt: timestampISO }
            };
            await storage.saveConcept(newConcept);
        } else {
            // Update Concept Metadata if changed
            const concept = await storage.getConcept(conceptId);
            if (concept) {
                let updated = false;
                if (concept.name !== submission.conceptName) { concept.name = submission.conceptName; updated = true; }
                if (concept.topic !== submission.conceptTopic) { concept.topic = submission.conceptTopic; updated = true; }
                // Array compare
                if (JSON.stringify(concept.disciplines) !== JSON.stringify(submission.conceptDisciplines)) {
                    concept.disciplines = submission.conceptDisciplines;
                    updated = true;
                }
                if (updated) {
                    await storage.saveConcept(concept);
                }
            }
        }

        const processAtoms = async (field: ContentAtomField, atoms: AtomSubmission[]) => {
            const atomIds: hash[] = [];
            for (const sub of atoms) {
                const contentHash = await generateContentHash(sub.contentPayload);
                const contentSimHash = await simhash(sub.contentPayload);

                let prevAtom: IContentAtom | null = null;
                if (sub.derivedFromId) {
                    prevAtom = await storage.getAtom(sub.derivedFromId);
                }

                // If content is completely identical to previous, reuse ID directly
                if (prevAtom && prevAtom.contentHash === contentHash) {
                    atomIds.push(prevAtom.id);
                    continue;
                }

                let attr: ContentAtomAttr = { [creatorId]: 1 };
                if (prevAtom) {
                    const similarity = (prevAtom.contentSimHash && contentSimHash)
                        ? this.calculateSimilarity(prevAtom.contentSimHash, contentSimHash)
                        : 0;
                    attr = this.calculateAttribution(prevAtom.attr, similarity, creatorId);
                }

                const atomId = await generateAtomHash(
                    field,
                    sub.type,
                    contentHash,
                    creatorId,
                    sub.derivedFromId || null,
                    attr
                );

                // Check if atom already exists globally (e.g. someone else wrote same text)
                const existingAtom = await storage.getAtom(atomId);
                if (existingAtom) {
                    atomIds.push(existingAtom.id);
                } else {
                    const newAtom: IContentAtom = {
                        id: atomId,
                        field,
                        type: sub.type,
                        content: sub.contentPayload,
                        contentHash,
                        contentSimHash,
                        creatorId,
                        timestampISO,
                        attr,
                        derivedFromId: sub.derivedFromId || null,
                        frontMeta: sub.frontMeta || {},
                        backMeta: { createdAt: timestampISO }
                    };
                    await storage.saveAtom(newAtom);
                    atomIds.push(atomId);
                }
            }
            return atomIds;
        };

        const coreAtomIds = await processAtoms('core', submission.coreAtoms);
        const docAtomIds = await processAtoms('doc', submission.docAtoms);
        const tagsAtomIds = await processAtoms('tags', submission.tagsAtoms);
        const refsAtomIds = await processAtoms('refs', submission.refsAtoms);
        const relsAtomIds = await processAtoms('rels', submission.relsAtoms);

        const editionId = await generateEditionHash(
            conceptId,
            submission.baseEditionId,
            coreAtomIds,
            docAtomIds,
            tagsAtomIds,
            refsAtomIds,
            relsAtomIds,
            creatorId,
            timestampISO
        );

        // Check if edition already exists (unchanged from base or previously submitted identical)
        const existingEdition = await storage.getEdition(editionId);
        if (existingEdition) {
            // Ensure head is updated if not autosave
            if (submission.saveType !== 'autosave') {
                const concept = await storage.getConcept(conceptId);
                if (concept && !concept.currentHeads[editionId]) {
                    concept.currentHeads[editionId] = Date.now();
                    // Optional: remove parent from heads if linear branch
                    if (submission.baseEditionId && concept.currentHeads[submission.baseEditionId]) {
                        delete concept.currentHeads[submission.baseEditionId];
                    }
                    await storage.saveConcept(concept);
                }
            }
            return existingEdition;
        }

        const edition: IEdition = {
            id: editionId,
            conceptId,
            saveType: submission.saveType as 'autosave' | 'save' | 'publish',
            coreAtomIds,
            docAtomIds,
            tagsAtomIds,
            refsAtomIds,
            relsAtomIds,
            creator: creatorId,
            timestampISO,
            parentEditionId: submission.baseEditionId,
            frontMeta: {},
            backMeta: { createdAt: timestampISO }
        };

        await storage.saveEdition(edition);

        // Update Concept Heads
        if (submission.saveType !== 'autosave') {
             const concept = await storage.getConcept(conceptId);
             if (concept) {
                 const newHeads = { ...concept.currentHeads };
                 if (submission.baseEditionId && newHeads[submission.baseEditionId]) {
                     delete newHeads[submission.baseEditionId];
                 }
                 newHeads[editionId] = Date.now();
                 concept.currentHeads = newHeads;
                 await storage.saveConcept(concept);
             }
        }

        return edition;
    }
}

export const core = new AttrStrandCore();
