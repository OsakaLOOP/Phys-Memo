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
    runCleanup(_thresholdTimestamp: number): Promise<number>; // Returns number of deleted items
}

const STORAGE_KEYS = {
    CONCEPTS: 'attr_concepts',
    EDITIONS: 'attr_editions',
    ATOMS: 'attr_atoms'
};

export class LocalStorageMock implements IStorage {
    private cache: Record<string, any> = {};

    private load<T>(key: string): Record<string, T> {
        if (this.cache[key]) {
            return this.cache[key];
        }
        const raw = localStorage.getItem(key);
        const data = raw ? JSON.parse(raw) : {};
        this.cache[key] = data;
        return data;
    }

    private save<T>(key: string, data: Record<string, T>) {
        this.cache[key] = data;
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
    async runCleanup(_thresholdTimestamp: number): Promise<number> {
        // Force reload to ensure fresh data for GC
        this.cache = {};

        const concepts = this.load<IConceptRoot>(STORAGE_KEYS.CONCEPTS);
        const editions = this.load<IEdition>(STORAGE_KEYS.EDITIONS);
        const atoms = this.load<IContentAtom>(STORAGE_KEYS.ATOMS);

        let deletedCount = 0;

        // 1. Identify active editions (heads of branches)
        const activeEditionIds = new Set<string>();
        Object.values(concepts).forEach(c => {
            Object.keys(c.currentHeads).forEach(headId => activeEditionIds.add(headId));
        });

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
            if (keptEditionIds.has(e.id)) {
                e.coreAtomIds.forEach(id => referencedAtomIds.add(id));
                e.docAtomIds.forEach(id => referencedAtomIds.add(id));
                e.tagsAtomIds.forEach(id => referencedAtomIds.add(id));
                e.refsAtomIds.forEach(id => referencedAtomIds.add(id));
                e.relsAtomIds.forEach(id => referencedAtomIds.add(id));
            }
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
