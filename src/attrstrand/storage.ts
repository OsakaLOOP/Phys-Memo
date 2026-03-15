import type { IConceptRoot, IEdition, IContentAtom, DisciplineData, ContentAtomField, ContentAtomType } from './types.ts';

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
    getAllAtoms(): Promise<IContentAtom[]>;
    findAtomsByContentHash(contentHash: string): Promise<IContentAtom[]>;
    findAtomsByField(field: ContentAtomField): Promise<IContentAtom[]>;
    queryAtoms(filter: {
        field?: ContentAtomField;
        type?: ContentAtomType;
        creatorId?: string;
        contentHash?: string;
        contentSimHash?: string;
        contains?: string;
    }): Promise<IContentAtom[]>;

    // Discipline Operations (Flat structure)
    saveDiscipline(discipline: DisciplineData): Promise<void>;
    getDiscipline(name: string): Promise<DisciplineData | null>;
    getAllDisciplines(): Promise<DisciplineData[]>;
    deleteDiscipline(name: string): Promise<void>;

    // Worker Interface
    runCleanup(thresholdTimestamp: number): Promise<number>; // Returns number of deleted items
}

const STORAGE_KEYS = {
    CONCEPTS: 'attr_concepts',
    EDITIONS: 'attr_editions',
    ATOMS: 'attr_atoms',
    DISCIPLINES: 'attr_disciplines'
};

export class LocalStorageMock implements IStorage {
    private load<T>(key: string): Record<string, T> {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : {};
    }

    private save<T>(key: string, data: Record<string, T>) {
        localStorage.setItem(key, JSON.stringify(data));
    }

    // --- Concept Operations ---
    async saveConcept(concept: IConceptRoot): Promise<void> {
        console.log(`[API Call] storage.saveConcept: ${concept.id}`, concept);
        const data = this.load<IConceptRoot>(STORAGE_KEYS.CONCEPTS);
        data[concept.id] = concept;
        this.save(STORAGE_KEYS.CONCEPTS, data);
    }

    async getConcept(id: string): Promise<IConceptRoot | null> {
        console.log(`[API Call] storage.getConcept: ${id}`);
        const data = this.load<IConceptRoot>(STORAGE_KEYS.CONCEPTS);
        return data[id] || null;
    }

    async getAllConcepts(): Promise<IConceptRoot[]> {
        console.log(`[API Call] storage.getAllConcepts`);
        const data = this.load<IConceptRoot>(STORAGE_KEYS.CONCEPTS);
        return Object.values(data);
    }

    // --- Edition Operations ---
    async saveEdition(edition: IEdition): Promise<void> {
        console.log(`[API Call] storage.saveEdition: ${edition.id}`, edition);
        const data = this.load<IEdition>(STORAGE_KEYS.EDITIONS);
        data[edition.id] = edition;
        this.save(STORAGE_KEYS.EDITIONS, data);
    }

    async getEdition(id: string): Promise<IEdition | null> {
        console.log(`[API Call] storage.getEdition: ${id}`);
        const data = this.load<IEdition>(STORAGE_KEYS.EDITIONS);
        return data[id] || null;
    }

    async getEditionsByConcept(conceptId: string): Promise<IEdition[]> {
        console.log(`[API Call] storage.getEditionsByConcept: ${conceptId}`);
        const data = this.load<IEdition>(STORAGE_KEYS.EDITIONS);
        return Object.values(data).filter(e => e.conceptId === conceptId);
    }

    // --- Atom Operations ---
    async saveAtom(atom: IContentAtom): Promise<void> {
        console.log(`[API Call] storage.saveAtom: ${atom.id}`, atom);
        const data = this.load<IContentAtom>(STORAGE_KEYS.ATOMS);
        data[atom.id] = atom;
        this.save(STORAGE_KEYS.ATOMS, data);
    }

    async getAtom(id: string): Promise<IContentAtom | null> {
        console.log(`[API Call] storage.getAtom: ${id}`);
        const data = this.load<IContentAtom>(STORAGE_KEYS.ATOMS);
        return data[id] || null;
    }

    async getAtoms(ids: string[]): Promise<IContentAtom[]> {
        console.log(`[API Call] storage.getAtoms: ${ids.length} ids`);
        const data = this.load<IContentAtom>(STORAGE_KEYS.ATOMS);
        return ids.map(id => data[id]).filter(a => a !== undefined);
    }

    async getAllAtoms(): Promise<IContentAtom[]> {
        console.log('[API Call] storage.getAllAtoms');
        const atoms = this.load<IContentAtom>(STORAGE_KEYS.ATOMS);
        return Object.values(atoms);
    }

    async findAtomsByContentHash(contentHash: string): Promise<IContentAtom[]> {
        const allAtoms = await this.getAllAtoms();
        return allAtoms.filter(atom => atom.contentHash === contentHash);
    }

    async findAtomsByField(field: ContentAtomField): Promise<IContentAtom[]> {
        const allAtoms = await this.getAllAtoms();
        return allAtoms.filter(atom => atom.field === field);
    }

    async queryAtoms(filter: {
        field?: ContentAtomField;
        type?: ContentAtomType;
        creatorId?: string;
        contentHash?: string;
        contentSimHash?: string;
        contains?: string;
    }): Promise<IContentAtom[]> {
        const allAtoms = await this.getAllAtoms();
        return allAtoms.filter(atom => {
            if (filter.field && atom.field !== filter.field) return false;
            if (filter.type && atom.type !== filter.type) return false;
            if (filter.creatorId && atom.creatorId !== filter.creatorId) return false;
            if (filter.contentHash && atom.contentHash !== filter.contentHash) return false;
            if (filter.contentSimHash && atom.contentSimHash !== filter.contentSimHash) return false;
            if (filter.contains && !atom.content.includes(filter.contains)) return false;
            return true;
        });
    }

    // --- Discipline Operations ---
    async saveDiscipline(discipline: DisciplineData): Promise<void> {
        console.log(`[API Call] storage.saveDiscipline: ${discipline.name}`, discipline);
        const data = this.load<DisciplineData>(STORAGE_KEYS.DISCIPLINES);
        data[discipline.name] = discipline;
        this.save(STORAGE_KEYS.DISCIPLINES, data);
    }

    async getDiscipline(name: string): Promise<DisciplineData | null> {
        console.log(`[API Call] storage.getDiscipline: ${name}`);
        const data = this.load<DisciplineData>(STORAGE_KEYS.DISCIPLINES);
        return data[name] || null;
    }

    async getAllDisciplines(): Promise<DisciplineData[]> {
        console.log(`[API Call] storage.getAllDisciplines`);
        const data = this.load<DisciplineData>(STORAGE_KEYS.DISCIPLINES);
        return Object.values(data);
    }

    async deleteDiscipline(name: string): Promise<void> {
        console.log(`[API Call] storage.deleteDiscipline: ${name}`);
        const data = this.load<DisciplineData>(STORAGE_KEYS.DISCIPLINES);
        if (data[name]) {
            delete data[name];
            this.save(STORAGE_KEYS.DISCIPLINES, data);
        }
    }

    // --- Cleanup Operations ---
    async runCleanup(_thresholdTimestamp: number): Promise<number> {
        console.log(`[API Call] storage.runCleanup: threshold=${_thresholdTimestamp}`);
        const concepts = this.load<IConceptRoot>(STORAGE_KEYS.CONCEPTS);
        const editions = this.load<IEdition>(STORAGE_KEYS.EDITIONS);
        const atoms = this.load<IContentAtom>(STORAGE_KEYS.ATOMS);

        let deletedCount = 0;

        // 1. Identify active editions (heads of branches)
        const activeEditionIds = new Set<string>();
        Object.values(concepts).forEach(c => {
            Object.keys(c.currentHeads).forEach(headId => activeEditionIds.add(headId));
        });

        // 2. Mark reachable editions
        const keptEditionIds = new Set<string>();
        const queue = [...activeEditionIds];

        // Keep explicitly saved/published editions
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

        // Delete editions not in keptEditionIds
        Object.keys(editions).forEach(id => {
            if (!keptEditionIds.has(id)) {
                delete editions[id];
                deletedCount++;
            }
        });

        // Collect referenced atoms from kept editions
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
