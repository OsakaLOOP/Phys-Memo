import type { IConceptRoot, IEdition, IContentAtom } from './types';

export interface IStorage {
    // Concept Operations
    saveConcept(concept: IConceptRoot): Promise<void>;
    getConcept(id: string): Promise<IConceptRoot | null>;
    getAllConcepts(): Promise<IConceptRoot[]>;

    // Edition Operations
    saveEdition(edition: IEdition): Promise<void>;
    getEdition(id: string): Promise<IEdition | null>;
    getEditionsByConcept(conceptId: string): Promise<IEdition[]>;

    // Atom Operations
    saveAtom(atom: IContentAtom): Promise<void>;
    getAtom(id: string): Promise<IContentAtom | null>;
    getAtoms(ids: string[]): Promise<IContentAtom[]>;

    // Worker Interface
    runCleanup(thresholdTimestamp: number): Promise<number>; // Returns number of deleted items
}

const STORAGE_KEYS = {
    CONCEPTS: 'attr_concepts',
    EDITIONS: 'attr_editions',
    ATOMS: 'attr_atoms'
};

export class LocalStorageMock implements IStorage {
    private load<T>(key: string): Record<string, T> {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : {};
    }

    private save<T>(key: string, data: Record<string, T>) {
        localStorage.setItem(key, JSON.stringify(data));
    }

    async saveConcept(concept: IConceptRoot): Promise<void> {
        const data = this.load<IConceptRoot>(STORAGE_KEYS.CONCEPTS);
        data[concept.id] = concept;
        this.save(STORAGE_KEYS.CONCEPTS, data);
    }

    async getConcept(id: string): Promise<IConceptRoot | null> {
        const data = this.load<IConceptRoot>(STORAGE_KEYS.CONCEPTS);
        return data[id] || null;
    }

    async getAllConcepts(): Promise<IConceptRoot[]> {
        const data = this.load<IConceptRoot>(STORAGE_KEYS.CONCEPTS);
        return Object.values(data);
    }

    async saveEdition(edition: IEdition): Promise<void> {
        const data = this.load<IEdition>(STORAGE_KEYS.EDITIONS);
        data[edition.id] = edition;
        this.save(STORAGE_KEYS.EDITIONS, data);
    }

    async getEdition(id: string): Promise<IEdition | null> {
        const data = this.load<IEdition>(STORAGE_KEYS.EDITIONS);
        return data[id] || null;
    }

    async getEditionsByConcept(conceptId: string): Promise<IEdition[]> {
        const data = this.load<IEdition>(STORAGE_KEYS.EDITIONS);
        return Object.values(data).filter(e => e.conceptId === conceptId);
    }

    async saveAtom(atom: IContentAtom): Promise<void> {
        const data = this.load<IContentAtom>(STORAGE_KEYS.ATOMS);
        data[atom.id] = atom;
        this.save(STORAGE_KEYS.ATOMS, data);
    }

    async getAtom(id: string): Promise<IContentAtom | null> {
        const data = this.load<IContentAtom>(STORAGE_KEYS.ATOMS);
        return data[id] || null;
    }

    async getAtoms(ids: string[]): Promise<IContentAtom[]> {
        const data = this.load<IContentAtom>(STORAGE_KEYS.ATOMS);
        return ids.map(id => data[id]).filter(a => a !== undefined);
    }

    // Worker Functionality: Cleanup unreferenced atoms and old editions
    // Rules:
    // 1. Delete atoms not referenced by any Edition (unless very recent) -> Actually atoms are immutable content blocks. If no edition points to them, they are garbage.
    // 2. Delete Editions that are:
    //    - Not the latest head of any branch (in ConceptRoot.currentHeads)
    //    - Not referenced as a parent by another edition (unless we want to keep full history? Prompt says: "Clean and merge... only delete specified records... note not to delete if referenced by other branch or is latest")
    //    - Older than threshold?

    // For this mock, we'll implement a simple ref-count based GC logic.
    async runCleanup(_thresholdTimestamp: number): Promise<number> {
        const concepts = this.load<IConceptRoot>(STORAGE_KEYS.CONCEPTS);
        const editions = this.load<IEdition>(STORAGE_KEYS.EDITIONS);
        const atoms = this.load<IContentAtom>(STORAGE_KEYS.ATOMS);

        let deletedCount = 0;

        // 1. Identify active editions (heads of branches)
        const activeEditionIds = new Set<string>();
        Object.values(concepts).forEach(c => {
            Object.keys(c.currentHeads).forEach(headId => activeEditionIds.add(headId));
        });

        // 2. Mark reachable editions (traverse parents)
        // Actually, prompt says: "Clean and collapse... delete non-referenced non-latest... merge subsequent parent pointers".
        // This implies we might delete intermediate history nodes?
        // "Non-referenced and non-latest automatically deleted... and migrate subsequent node parents."
        // Meaning: A -> B -> C. If B is not useful (not a head, not explicitly saved?), delete B and make C.parent = A.
        // But for now, let's just delete unreferenced *atoms* and maybe editions that are strictly "autosave" and old?
        // Let's stick to safe GC: Delete if not reachable from any Head.

        // Wait, "Cherry-pick... history must be linear...".
        // If I delete B, history is broken? "Migrate subsequent node parent". So A -> C.

        // Let's implement a simpler version:
        // Collect all atoms referenced by *any* edition that is still in storage.
        // Delete atoms that are not in that set.

        // Filter editions to keep:
        // Keep if:
        // - Is a Head (in concepts.currentHeads)
        // - Is referenced by another kept edition (parent pointer) -- this requires traversing from heads down.
        // - Is 'save' or 'publish' type (user explicitly saved). 'autosave' can be GC'd if not a head.

        const keptEditionIds = new Set<string>();
        const queue = [...activeEditionIds];

        // Add explicitly saved/published editions to roots
        Object.values(editions).forEach(e => {
            if (e.saveType !== 'autosave') {
                queue.push(e.id);
            }
        });

        // BFS to find all ancestors
        while(queue.length > 0) {
            const id = queue.shift()!;
            if (keptEditionIds.has(id)) continue;
            keptEditionIds.add(id);

            const edition = editions[id];
            if (edition && edition.parentEditionId) {
                queue.push(edition.parentEditionId);
            }
        }

        // Now delete editions not in keptEditionIds
        Object.keys(editions).forEach(id => {
            if (!keptEditionIds.has(id)) {
                delete editions[id];
                deletedCount++;
            }
        });

        // Now Collect referenced atoms from KEPT editions
        const referencedAtomIds = new Set<string>();
        Object.values(editions).forEach(e => {
            e.coreAtomIds.forEach(id => referencedAtomIds.add(id));
            e.docAtomIds.forEach(id => referencedAtomIds.add(id));
            e.tagsAtomIds.forEach(id => referencedAtomIds.add(id));
            e.refsAtomIds.forEach(id => referencedAtomIds.add(id));
            e.relsAtomIds.forEach(id => referencedAtomIds.add(id));
        });

        // Delete unreferenced atoms
        Object.keys(atoms).forEach(id => {
            if (!referencedAtomIds.has(id)) {
                delete atoms[id];
                deletedCount++;
            }
        });

        this.save(STORAGE_KEYS.EDITIONS, editions);
        this.save(STORAGE_KEYS.ATOMS, atoms);

        return deletedCount;
    }
}

export const storage = new LocalStorageMock();
