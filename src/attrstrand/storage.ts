import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
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
    getEditionCountByConcept(conceptId: string): Promise<number>;
    updateEditionFlags(id: string, flags: import('./types').IEditionFlag[]): Promise<void>;

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

    // Transaction Interface
    submitEditionTransaction(payload: { concept?: IConceptRoot, edition: IEdition, atoms: IContentAtom[] }): Promise<void>;
}

export interface AttrStrandDB extends DBSchema {
    attr_concepts: {
        key: string;
        value: IConceptRoot;
    };
    attr_editions: {
        key: string;
        value: IEdition;
        indexes: { 'conceptId': string };
    };
    attr_atoms: {
        key: string;
        value: IContentAtom;
        indexes: { 'contentHash': string, 'field': string };
    };
    attr_disciplines: {
        key: string;
        value: DisciplineData;
    };
}

export class IndexedDBStorage implements IStorage {
    private dbName = 'AttrStrandDB';
    private dbVersion = 1;
    private dbPromise: Promise<IDBPDatabase<AttrStrandDB>> | null = null;

    private getDB(): Promise<IDBPDatabase<AttrStrandDB>> {
        if (this.dbPromise) return this.dbPromise;

        this.dbPromise = openDB<AttrStrandDB>(this.dbName, this.dbVersion, {
            upgrade(db) {
                if (!db.objectStoreNames.contains('attr_concepts')) {
                    db.createObjectStore('attr_concepts', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('attr_editions')) {
                    const editionsStore = db.createObjectStore('attr_editions', { keyPath: 'id' });
                    editionsStore.createIndex('conceptId', 'conceptId');
                }
                if (!db.objectStoreNames.contains('attr_atoms')) {
                    const atomsStore = db.createObjectStore('attr_atoms', { keyPath: 'id' });
                    atomsStore.createIndex('contentHash', 'contentHash');
                    atomsStore.createIndex('field', 'field');
                }
                if (!db.objectStoreNames.contains('attr_disciplines')) {
                    db.createObjectStore('attr_disciplines', { keyPath: 'name' });
                }
            },
        });

        return this.dbPromise;
    }

    // --- Concept Operations ---
    async saveConcept(concept: IConceptRoot): Promise<void> {
        const db = await this.getDB();
        await db.put('attr_concepts', concept);
    }

    async getConcept(id: string): Promise<IConceptRoot | null> {
        const db = await this.getDB();
        return (await db.get('attr_concepts', id)) || null;
    }

    async getAllConcepts(): Promise<IConceptRoot[]> {
        const db = await this.getDB();
        return db.getAll('attr_concepts');
    }

    // --- Edition Operations ---
    async saveEdition(edition: IEdition): Promise<void> {
        const db = await this.getDB();
        await db.put('attr_editions', edition);
    }

    async getEdition(id: string): Promise<IEdition | null> {
        const db = await this.getDB();
        return (await db.get('attr_editions', id)) || null;
    }

    async getEditionsByConcept(conceptId: string): Promise<IEdition[]> {
        const db = await this.getDB();
        return db.getAllFromIndex('attr_editions', 'conceptId', conceptId);
    }

    async getEditionCountByConcept(conceptId: string): Promise<number> {
        const db = await this.getDB();
        return db.countFromIndex('attr_editions', 'conceptId', conceptId);
    }
    
    async updateEditionFlags(id: string, flags: import('./types').IEditionFlag[]): Promise<void> {
        const db = await this.getDB();
        const tx = db.transaction('attr_editions', 'readwrite');
        const store = tx.objectStore('attr_editions');
        const edition = await store.get(id);
        if (edition) {
            if (!edition.frontMeta) {
                edition.frontMeta = {};
            }
            edition.frontMeta.flags = flags as any;
            await store.put(edition);
        }
        await tx.done;
    }

    // --- Atom Operations ---
    async saveAtom(atom: IContentAtom): Promise<void> {
        const db = await this.getDB();
        await db.put('attr_atoms', atom);
    }

    async getAtom(id: string): Promise<IContentAtom | null> {
        const db = await this.getDB();
        return (await db.get('attr_atoms', id)) || null;
    }

    async getAtoms(ids: string[]): Promise<IContentAtom[]> {
        if (ids.length === 0) return [];
        const db = await this.getDB();
        const tx = db.transaction('attr_atoms', 'readonly');
        const store = tx.objectStore('attr_atoms');

        const promises = ids.map(id => store.get(id));
        const results = await Promise.all(promises);
        return results.filter((atom): atom is IContentAtom => atom !== undefined);
    }

    async getAllAtoms(): Promise<IContentAtom[]> {
        const db = await this.getDB();
        return db.getAll('attr_atoms');
    }

    async findAtomsByContentHash(contentHash: string): Promise<IContentAtom[]> {
        const db = await this.getDB();
        return db.getAllFromIndex('attr_atoms', 'contentHash', contentHash);
    }

    async findAtomsByField(field: ContentAtomField): Promise<IContentAtom[]> {
        const db = await this.getDB();
        return db.getAllFromIndex('attr_atoms', 'field', field);
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
        const db = await this.getDB();
        await db.put('attr_disciplines', discipline);
    }

    async getDiscipline(name: string): Promise<DisciplineData | null> {
        const db = await this.getDB();
        return (await db.get('attr_disciplines', name)) || null;
    }

    async getAllDisciplines(): Promise<DisciplineData[]> {
        const db = await this.getDB();
        return db.getAll('attr_disciplines');
    }

    async deleteDiscipline(name: string): Promise<void> {
        const db = await this.getDB();
        await db.delete('attr_disciplines', name);
    }

    // --- Transaction Operations ---
    async submitEditionTransaction(payload: { concept?: IConceptRoot, edition: IEdition, atoms: IContentAtom[] }): Promise<void> {
        const db = await this.getDB();
        const tx = db.transaction(['attr_concepts', 'attr_editions', 'attr_atoms'], 'readwrite');

        try {
            const promises: Promise<any>[] = [];

            if (payload.concept) {
                promises.push(tx.objectStore('attr_concepts').put(payload.concept));
            }

            promises.push(tx.objectStore('attr_editions').put(payload.edition));

            const atomsStore = tx.objectStore('attr_atoms');
            for (const atom of payload.atoms) {
                promises.push(atomsStore.put(atom));
            }

            await Promise.all([...promises, tx.done]);
        } catch (error) {
            tx.abort();
            throw error;
        }
    }

    // --- Cleanup Operations ---
    async runCleanup(_thresholdTimestamp: number): Promise<number> {
        const db = await this.getDB();
        const concepts = await this.getAllConcepts();
        const editions = await db.getAll('attr_editions');
        const atoms = await db.getAll('attr_atoms');

        let deletedCount = 0;

        const activeEditionIds = new Set<string>();
        concepts.forEach(c => {
            Object.keys(c.currentHeads).forEach(headId => activeEditionIds.add(headId));
        });

        const keptEditionIds = new Set<string>();
        const queue = [...activeEditionIds];

        // Editions map for easy lookup
        const editionsMap: Record<string, IEdition> = {};
        editions.forEach(e => editionsMap[e.id] = e);

        Object.values(editionsMap).forEach(e => {
            if (e.saveType !== 'autosave') {
                queue.push(e.id);
            }
        });

        while(queue.length > 0) {
            const id = queue.shift()!;
            if (keptEditionIds.has(id)) continue;
            keptEditionIds.add(id);

            const edition = editionsMap[id];
            if (edition && edition.parentEditionId) {
                queue.push(edition.parentEditionId);
            }
        }

        const tx = db.transaction(['attr_editions', 'attr_atoms'], 'readwrite');
        const editionsStore = tx.objectStore('attr_editions');
        const atomsStore = tx.objectStore('attr_atoms');

        const editionsPromises: Promise<void>[] = [];
        Object.keys(editionsMap).forEach(id => {
            if (!keptEditionIds.has(id)) {
                editionsPromises.push(editionsStore.delete(id));
                deletedCount++;
            }
        });

        const referencedAtomIds = new Set<string>();
        Object.values(editionsMap).forEach(e => {
            if (keptEditionIds.has(e.id)) {
                e.coreAtomIds.forEach(id => referencedAtomIds.add(id));
                e.docAtomIds.forEach(id => referencedAtomIds.add(id));
                e.tagsAtomIds.forEach(id => referencedAtomIds.add(id));
                e.refsAtomIds.forEach(id => referencedAtomIds.add(id));
                e.relsAtomIds.forEach(id => referencedAtomIds.add(id));
            }
        });

        const atomsPromises: Promise<void>[] = [];
        atoms.forEach(atom => {
            if (!referencedAtomIds.has(atom.id)) {
                atomsPromises.push(atomsStore.delete(atom.id));
                deletedCount++;
            }
        });

        await Promise.all([...editionsPromises, ...atomsPromises, tx.done]);
        return deletedCount;
    }
}

export const storage = new IndexedDBStorage();
