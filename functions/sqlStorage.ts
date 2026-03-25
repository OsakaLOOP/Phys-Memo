import type { IConceptRoot, IEdition, IContentAtom, DisciplineData } from '../src/attrstrand/types.ts';

/**
 * SQL Schema Initialization (For Reference)
 *
 * CREATE TABLE IF NOT EXISTS concepts (
 *     id TEXT PRIMARY KEY,
 *     name TEXT NOT NULL,
 *     topic TEXT NOT NULL,
 *     creator_id TEXT NOT NULL,
 *     timestamp_iso TEXT NOT NULL,
 *     front_meta TEXT,
 *     back_meta TEXT
 * );
 *
 * CREATE TABLE IF NOT EXISTS concept_heads (
 *     concept_id TEXT NOT NULL,
 *     edition_id TEXT NOT NULL,
 *     sort_order INTEGER NOT NULL,
 *     PRIMARY KEY (concept_id, edition_id),
 *     FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
 * );
 *
 * CREATE TABLE IF NOT EXISTS concept_disciplines (
 *     concept_id TEXT NOT NULL,
 *     discipline_name TEXT NOT NULL,
 *     PRIMARY KEY (concept_id, discipline_name),
 *     FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
 * );
 *
 * CREATE TABLE IF NOT EXISTS editions (
 *     id TEXT PRIMARY KEY,
 *     concept_id TEXT NOT NULL,
 *     save_type TEXT NOT NULL,
 *     creator TEXT NOT NULL,
 *     timestamp_iso TEXT NOT NULL,
 *     parent_edition_id TEXT,
 *     front_meta TEXT,
 *     back_meta TEXT,
 *     FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
 * );
 *
 * CREATE TABLE IF NOT EXISTS edition_atoms (
 *     edition_id TEXT NOT NULL,
 *     atom_id TEXT NOT NULL,
 *     field TEXT NOT NULL,
 *     sort_order INTEGER NOT NULL,
 *     PRIMARY KEY (edition_id, atom_id, field, sort_order),
 *     FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE CASCADE
 * );
 *
 * CREATE TABLE IF NOT EXISTS atoms (
 *     id TEXT PRIMARY KEY,
 *     field TEXT NOT NULL,
 *     type TEXT NOT NULL,
 *     content TEXT NOT NULL,
 *     content_hash TEXT NOT NULL,
 *     content_sim_hash TEXT,
 *     creator_id TEXT NOT NULL,
 *     timestamp_iso TEXT NOT NULL,
 *     attr TEXT,
 *     derived_from_id TEXT,
 *     front_meta TEXT,
 *     back_meta TEXT
 * );
 *
 * CREATE TABLE IF NOT EXISTS disciplines (
 *     name TEXT PRIMARY KEY,
 *     abbr TEXT NOT NULL,
 *     color TEXT NOT NULL,
 *     hue REAL NOT NULL
 * );
 */

export interface IStorage {
    saveConcept(concept: IConceptRoot): Promise<void>;
    getConcept(id: string): Promise<IConceptRoot | null>;
    getAllConcepts(): Promise<IConceptRoot[]>;

    saveEdition(edition: IEdition): Promise<void>;
    getEdition(id: string): Promise<IEdition | null>;
    getEditionsByConcept(conceptId: string): Promise<IEdition[]>;

    saveAtom(atom: IContentAtom): Promise<void>;
    getAtom(id: string): Promise<IContentAtom | null>;
    getAtoms(ids: string[]): Promise<IContentAtom[]>;
    getAllAtoms(): Promise<IContentAtom[]>;
    findAtomsByContentHash(contentHash: string): Promise<IContentAtom[]>;
    findAtomsByField(field: string): Promise<IContentAtom[]>;
    queryAtoms(filter: {
        field?: string;
        type?: string;
        creatorId?: string;
        contentHash?: string;
        contentSimHash?: string;
        contains?: string;
    }): Promise<IContentAtom[]>;

    saveDiscipline(discipline: DisciplineData): Promise<void>;
    getDiscipline(name: string): Promise<DisciplineData | null>;
    getAllDisciplines(): Promise<DisciplineData[]>;
    deleteDiscipline(name: string): Promise<void>;

    runCleanup(thresholdTimestamp: number): Promise<number>;

    submitEditionTransaction(payload: { concept?: IConceptRoot, edition: IEdition, atoms: IContentAtom[] }): Promise<void>;
}

// Credentials - to be replaced or injected via environment variables
const D1_API_URL = "";
const D1_API_TOKEN = "";

interface Query {
    sql: string;
    params?: any[];
}

interface D1Response {
    success: boolean;
    errors: any[];
    messages: any[];
    result: {
        meta: {
            changes: number;
        };
        results: any[];
        success: boolean;
    }[];
}

async function executeD1(queries: Query[]): Promise<D1Response["result"]> {
    if (queries.length === 0) return [];

    // Simulate D1 HTTP API request
    const response = await fetch(D1_API_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${D1_API_TOKEN}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(queries)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`D1 API Error: ${response.status} ${errText}`);
    }

    const data: D1Response = await response.json();
    if (!data.success) {
        throw new Error(`D1 Execution Error: ${JSON.stringify(data.errors)}`);
    }

    return data.result;
}

export class SqlStorage implements IStorage {
    async saveConcept(concept: IConceptRoot): Promise<void> {
        const queries: Query[] = [];

        queries.push({
            sql: `INSERT INTO concepts (id, name, topic, creator_id, timestamp_iso, front_meta, back_meta)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                  name=excluded.name, topic=excluded.topic, creator_id=excluded.creator_id,
                  timestamp_iso=excluded.timestamp_iso, front_meta=excluded.front_meta, back_meta=excluded.back_meta`,
            params: [
                concept.id, concept.name, concept.topic, concept.creatorId, concept.timestampISO,
                JSON.stringify(concept.frontMeta || {}), JSON.stringify(concept.backMeta || {})
            ]
        });

        queries.push({
            sql: `DELETE FROM concept_heads WHERE concept_id = ?`,
            params: [concept.id]
        });
        for (const [editionId, sortOrder] of Object.entries(concept.currentHeads)) {
            queries.push({
                sql: `INSERT INTO concept_heads (concept_id, edition_id, sort_order) VALUES (?, ?, ?)`,
                params: [concept.id, editionId, sortOrder]
            });
        }

        queries.push({
            sql: `DELETE FROM concept_disciplines WHERE concept_id = ?`,
            params: [concept.id]
        });
        for (const discipline of concept.disciplines) {
            queries.push({
                sql: `INSERT INTO concept_disciplines (concept_id, discipline_name) VALUES (?, ?)`,
                params: [concept.id, discipline]
            });
        }

        await executeD1(queries);
    }

    async getConcept(id: string): Promise<IConceptRoot | null> {
        const queries: Query[] = [
            { sql: `SELECT * FROM concepts WHERE id = ?`, params: [id] },
            { sql: `SELECT edition_id, sort_order FROM concept_heads WHERE concept_id = ?`, params: [id] },
            { sql: `SELECT discipline_name FROM concept_disciplines WHERE concept_id = ?`, params: [id] }
        ];

        const results = await executeD1(queries);
        if (results[0].results.length === 0) return null;

        const row = results[0].results[0];
        const currentHeads: Record<string, number> = {};
        for (const headRow of results[1].results) {
            currentHeads[headRow.edition_id] = headRow.sort_order;
        }
        const disciplines = results[2].results.map((r: any) => r.discipline_name);

        return {
            id: row.id,
            name: row.name,
            topic: row.topic,
            creatorId: row.creator_id,
            timestampISO: row.timestamp_iso,
            disciplines,
            currentHeads,
            frontMeta: JSON.parse(row.front_meta || "{}"),
            backMeta: JSON.parse(row.back_meta || "{}")
        };
    }

    async getAllConcepts(): Promise<IConceptRoot[]> {
        const queries: Query[] = [
            { sql: `SELECT * FROM concepts` },
            { sql: `SELECT concept_id, edition_id, sort_order FROM concept_heads` },
            { sql: `SELECT concept_id, discipline_name FROM concept_disciplines` }
        ];

        const results = await executeD1(queries);

        const conceptHeadsMap: Record<string, Record<string, number>> = {};
        for (const headRow of results[1].results) {
            if (!conceptHeadsMap[headRow.concept_id]) conceptHeadsMap[headRow.concept_id] = {};
            conceptHeadsMap[headRow.concept_id][headRow.edition_id] = headRow.sort_order;
        }

        const conceptDisciplinesMap: Record<string, string[]> = {};
        for (const discRow of results[2].results) {
            if (!conceptDisciplinesMap[discRow.concept_id]) conceptDisciplinesMap[discRow.concept_id] = [];
            conceptDisciplinesMap[discRow.concept_id].push(discRow.discipline_name);
        }

        return results[0].results.map((row: any) => ({
            id: row.id,
            name: row.name,
            topic: row.topic,
            creatorId: row.creator_id,
            timestampISO: row.timestamp_iso,
            disciplines: conceptDisciplinesMap[row.id] || [],
            currentHeads: conceptHeadsMap[row.id] || {},
            frontMeta: JSON.parse(row.front_meta || "{}"),
            backMeta: JSON.parse(row.back_meta || "{}")
        }));
    }

    async saveEdition(edition: IEdition): Promise<void> {
        const queries: Query[] = [];

        queries.push({
            sql: `INSERT INTO editions (id, concept_id, save_type, creator, timestamp_iso, parent_edition_id, front_meta, back_meta)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                  concept_id=excluded.concept_id, save_type=excluded.save_type, creator=excluded.creator,
                  timestamp_iso=excluded.timestamp_iso, parent_edition_id=excluded.parent_edition_id,
                  front_meta=excluded.front_meta, back_meta=excluded.back_meta`,
            params: [
                edition.id, edition.conceptId, edition.saveType, edition.creator, edition.timestampISO,
                edition.parentEditionId, JSON.stringify(edition.frontMeta || {}), JSON.stringify(edition.backMeta || {})
            ]
        });

        queries.push({
            sql: `DELETE FROM edition_atoms WHERE edition_id = ?`,
            params: [edition.id]
        });

        const pushAtoms = (atomIds: string[], field: string) => {
            atomIds.forEach((atomId, sortOrder) => {
                queries.push({
                    sql: `INSERT INTO edition_atoms (edition_id, atom_id, field, sort_order) VALUES (?, ?, ?, ?)`,
                    params: [edition.id, atomId, field, sortOrder]
                });
            });
        };

        pushAtoms(edition.coreAtomIds, 'core');
        pushAtoms(edition.docAtomIds, 'doc');
        pushAtoms(edition.tagsAtomIds, 'tags');
        pushAtoms(edition.refsAtomIds, 'refs');
        pushAtoms(edition.relsAtomIds, 'rels');

        await executeD1(queries);
    }

    private formatEditionRow(row: any, atomsMap: Record<string, Record<string, string[]>>): IEdition {
        const ea = atomsMap[row.id] || {};
        return {
            id: row.id,
            conceptId: row.concept_id,
            saveType: row.save_type,
            creator: row.creator,
            timestampISO: row.timestamp_iso,
            parentEditionId: row.parent_edition_id,
            coreAtomIds: ea['core'] || [],
            docAtomIds: ea['doc'] || [],
            tagsAtomIds: ea['tags'] || [],
            refsAtomIds: ea['refs'] || [],
            relsAtomIds: ea['rels'] || [],
            frontMeta: JSON.parse(row.front_meta || "{}"),
            backMeta: JSON.parse(row.back_meta || "{}")
        };
    }

    async getEdition(id: string): Promise<IEdition | null> {
        const queries: Query[] = [
            { sql: `SELECT * FROM editions WHERE id = ?`, params: [id] },
            { sql: `SELECT atom_id, field, sort_order FROM edition_atoms WHERE edition_id = ? ORDER BY sort_order ASC`, params: [id] }
        ];

        const results = await executeD1(queries);
        if (results[0].results.length === 0) return null;

        const row = results[0].results[0];
        const ea: Record<string, string[]> = {};
        for (const aRow of results[1].results) {
            if (!ea[aRow.field]) ea[aRow.field] = [];
            ea[aRow.field].push(aRow.atom_id); // Since they are ordered by sort_order
        }

        return this.formatEditionRow(row, { [row.id]: ea });
    }

    async getEditionsByConcept(conceptId: string): Promise<IEdition[]> {
        const queries: Query[] = [
            { sql: `SELECT * FROM editions WHERE concept_id = ?`, params: [conceptId] },
            { sql: `SELECT edition_id, atom_id, field, sort_order FROM edition_atoms WHERE edition_id IN (SELECT id FROM editions WHERE concept_id = ?) ORDER BY sort_order ASC`, params: [conceptId] }
        ];

        const results = await executeD1(queries);
        const atomsMap: Record<string, Record<string, string[]>> = {};

        for (const aRow of results[1].results) {
            if (!atomsMap[aRow.edition_id]) atomsMap[aRow.edition_id] = {};
            if (!atomsMap[aRow.edition_id][aRow.field]) atomsMap[aRow.edition_id][aRow.field] = [];
            atomsMap[aRow.edition_id][aRow.field].push(aRow.atom_id);
        }

        return results[0].results.map((row: any) => this.formatEditionRow(row, atomsMap));
    }

    async saveAtom(atom: IContentAtom): Promise<void> {
        const sql = `INSERT INTO atoms (id, field, type, content, content_hash, content_sim_hash, creator_id, timestamp_iso, attr, derived_from_id, front_meta, back_meta)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(id) DO UPDATE SET
                     field=excluded.field, type=excluded.type, content=excluded.content, content_hash=excluded.content_hash,
                     content_sim_hash=excluded.content_sim_hash, creator_id=excluded.creator_id, timestamp_iso=excluded.timestamp_iso,
                     attr=excluded.attr, derived_from_id=excluded.derived_from_id, front_meta=excluded.front_meta, back_meta=excluded.back_meta`;

        await executeD1([{
            sql,
            params: [
                atom.id, atom.field, atom.type, atom.content, atom.contentHash, atom.contentSimHash,
                atom.creatorId, atom.timestampISO, JSON.stringify(atom.attr || {}), atom.derivedFromId,
                JSON.stringify(atom.frontMeta || {}), JSON.stringify(atom.backMeta || {})
            ]
        }]);
    }

    private formatAtomRow(row: any): IContentAtom {
        return {
            id: row.id,
            field: row.field,
            type: row.type,
            content: row.content,
            contentHash: row.content_hash,
            contentSimHash: row.content_sim_hash,
            creatorId: row.creator_id,
            timestampISO: row.timestamp_iso,
            attr: JSON.parse(row.attr || "{}"),
            derivedFromId: row.derived_from_id,
            frontMeta: JSON.parse(row.front_meta || "{}"),
            backMeta: JSON.parse(row.back_meta || "{}")
        };
    }

    async getAtom(id: string): Promise<IContentAtom | null> {
        const results = await executeD1([{ sql: `SELECT * FROM atoms WHERE id = ?`, params: [id] }]);
        if (results[0].results.length === 0) return null;
        return this.formatAtomRow(results[0].results[0]);
    }

    async getAtoms(ids: string[]): Promise<IContentAtom[]> {
        if (ids.length === 0) return [];

        // D1 HTTP API limits standard prepared statements, standard approaches bind each as param:
        const placeholders = ids.map(() => '?').join(',');
        const results = await executeD1([{ sql: `SELECT * FROM atoms WHERE id IN (${placeholders})`, params: ids }]);

        return results[0].results.map((r: any) => this.formatAtomRow(r));
    }

    async getAllAtoms(): Promise<IContentAtom[]> {
        const results = await executeD1([{ sql: `SELECT * FROM atoms` }]);
        return results[0].results.map((r: any) => this.formatAtomRow(r));
    }

    async findAtomsByContentHash(contentHash: string): Promise<IContentAtom[]> {
        const results = await executeD1([{ sql: `SELECT * FROM atoms WHERE content_hash = ?`, params: [contentHash] }]);
        return results[0].results.map((r: any) => this.formatAtomRow(r));
    }

    async findAtomsByField(field: string): Promise<IContentAtom[]> {
        const results = await executeD1([{ sql: `SELECT * FROM atoms WHERE field = ?`, params: [field] }]);
        return results[0].results.map((r: any) => this.formatAtomRow(r));
    }

    async queryAtoms(filter: {
        field?: string;
        type?: string;
        creatorId?: string;
        contentHash?: string;
        contentSimHash?: string;
        contains?: string;
    }): Promise<IContentAtom[]> {
        const queryFragments: string[] = [];
        const params: any[] = [];

        if (filter.field) {
            queryFragments.push(`field = ?`);
            params.push(filter.field);
        }
        if (filter.type) {
            queryFragments.push(`type = ?`);
            params.push(filter.type);
        }
        if (filter.creatorId) {
            queryFragments.push(`creator_id = ?`);
            params.push(filter.creatorId);
        }
        if (filter.contentHash) {
            queryFragments.push(`content_hash = ?`);
            params.push(filter.contentHash);
        }
        if (filter.contentSimHash) {
            queryFragments.push(`content_sim_hash = ?`);
            params.push(filter.contentSimHash);
        }
        if (filter.contains) {
            queryFragments.push(`content LIKE ?`);
            params.push(`%${filter.contains}%`);
        }

        const whereClause = queryFragments.length ? `WHERE ${queryFragments.join(' AND ')}` : '';
        const results = await executeD1([{ sql: `SELECT * FROM atoms ${whereClause}`, params }]);
        return results[0].results.map((r: any) => this.formatAtomRow(r));
    }

    async saveDiscipline(discipline: DisciplineData): Promise<void> {
        await executeD1([{
            sql: `INSERT INTO disciplines (name, abbr, color, hue) VALUES (?, ?, ?, ?)
                  ON CONFLICT(name) DO UPDATE SET abbr=excluded.abbr, color=excluded.color, hue=excluded.hue`,
            params: [discipline.name, discipline.abbr, discipline.color, discipline.hue]
        }]);
    }

    async getDiscipline(name: string): Promise<DisciplineData | null> {
        const results = await executeD1([{ sql: `SELECT * FROM disciplines WHERE name = ?`, params: [name] }]);
        if (results[0].results.length === 0) return null;

        const row = results[0].results[0];
        return { name: row.name, abbr: row.abbr, color: row.color, hue: row.hue };
    }

    async getAllDisciplines(): Promise<DisciplineData[]> {
        const results = await executeD1([{ sql: `SELECT * FROM disciplines` }]);
        return results[0].results.map((row: any) => ({
            name: row.name, abbr: row.abbr, color: row.color, hue: row.hue
        }));
    }

    async deleteDiscipline(name: string): Promise<void> {
        await executeD1([{ sql: `DELETE FROM disciplines WHERE name = ?`, params: [name] }]);
    }

    async submitEditionTransaction(payload: { concept?: IConceptRoot, edition: IEdition, atoms: IContentAtom[] }): Promise<void> {
        const queries: Query[] = [];

        // 1. Concept (if any)
        if (payload.concept) {
            queries.push({
                sql: `INSERT INTO concepts (id, name, topic, creator_id, timestamp_iso, front_meta, back_meta)
                      VALUES (?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET
                      name=excluded.name, topic=excluded.topic, creator_id=excluded.creator_id,
                      timestamp_iso=excluded.timestamp_iso, front_meta=excluded.front_meta, back_meta=excluded.back_meta`,
                params: [
                    payload.concept.id, payload.concept.name, payload.concept.topic, payload.concept.creatorId, payload.concept.timestampISO,
                    JSON.stringify(payload.concept.frontMeta || {}), JSON.stringify(payload.concept.backMeta || {})
                ]
            });

            queries.push({
                sql: `DELETE FROM concept_heads WHERE concept_id = ?`,
                params: [payload.concept.id]
            });
            for (const [editionId, sortOrder] of Object.entries(payload.concept.currentHeads)) {
                queries.push({
                    sql: `INSERT INTO concept_heads (concept_id, edition_id, sort_order) VALUES (?, ?, ?)`,
                    params: [payload.concept.id, editionId, sortOrder]
                });
            }

            queries.push({
                sql: `DELETE FROM concept_disciplines WHERE concept_id = ?`,
                params: [payload.concept.id]
            });
            for (const discipline of payload.concept.disciplines) {
                queries.push({
                    sql: `INSERT INTO concept_disciplines (concept_id, discipline_name) VALUES (?, ?)`,
                    params: [payload.concept.id, discipline]
                });
            }
        }

        // 2. Edition
        queries.push({
            sql: `INSERT INTO editions (id, concept_id, save_type, creator, timestamp_iso, parent_edition_id, front_meta, back_meta)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                  concept_id=excluded.concept_id, save_type=excluded.save_type, creator=excluded.creator,
                  timestamp_iso=excluded.timestamp_iso, parent_edition_id=excluded.parent_edition_id,
                  front_meta=excluded.front_meta, back_meta=excluded.back_meta`,
            params: [
                payload.edition.id, payload.edition.conceptId, payload.edition.saveType, payload.edition.creator, payload.edition.timestampISO,
                payload.edition.parentEditionId, JSON.stringify(payload.edition.frontMeta || {}), JSON.stringify(payload.edition.backMeta || {})
            ]
        });

        queries.push({
            sql: `DELETE FROM edition_atoms WHERE edition_id = ?`,
            params: [payload.edition.id]
        });

        const pushAtoms = (atomIds: string[], field: string) => {
            atomIds.forEach((atomId, sortOrder) => {
                queries.push({
                    sql: `INSERT INTO edition_atoms (edition_id, atom_id, field, sort_order) VALUES (?, ?, ?, ?)`,
                    params: [payload.edition.id, atomId, field, sortOrder]
                });
            });
        };

        pushAtoms(payload.edition.coreAtomIds, 'core');
        pushAtoms(payload.edition.docAtomIds, 'doc');
        pushAtoms(payload.edition.tagsAtomIds, 'tags');
        pushAtoms(payload.edition.refsAtomIds, 'refs');
        pushAtoms(payload.edition.relsAtomIds, 'rels');

        // 3. Atoms
        for (const atom of payload.atoms) {
            queries.push({
                sql: `INSERT INTO atoms (id, field, type, content, content_hash, content_sim_hash, creator_id, timestamp_iso, attr, derived_from_id, front_meta, back_meta)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET
                      field=excluded.field, type=excluded.type, content=excluded.content, content_hash=excluded.content_hash,
                      content_sim_hash=excluded.content_sim_hash, creator_id=excluded.creator_id, timestamp_iso=excluded.timestamp_iso,
                      attr=excluded.attr, derived_from_id=excluded.derived_from_id, front_meta=excluded.front_meta, back_meta=excluded.back_meta`,
                params: [
                    atom.id, atom.field, atom.type, atom.content, atom.contentHash, atom.contentSimHash,
                    atom.creatorId, atom.timestampISO, JSON.stringify(atom.attr || {}), atom.derivedFromId,
                    JSON.stringify(atom.frontMeta || {}), JSON.stringify(atom.backMeta || {})
                ]
            });
        }

        // Execute all queries in a single D1 API call to ensure transaction-like atomicity
        await executeD1(queries);
    }

    async runCleanup(thresholdTimestamp: number): Promise<number> {
        // 1. Delete unreachable editions using recursive CTE
        // 2. Delete unreferenced atoms

        // Use thresholdTimestamp to protect recent autosaves from being cleaned up
        const thresholdDateISO = new Date(thresholdTimestamp).toISOString();

        // This query combines two parts to be run in batch
        const queries: Query[] = [
            {
                sql: `
                    WITH RECURSIVE
                    KeptEditions(id) AS (
                        SELECT id FROM editions WHERE save_type != 'autosave' OR timestamp_iso >= ?
                        UNION
                        SELECT edition_id FROM concept_heads
                        UNION
                        SELECT e.parent_edition_id
                        FROM editions e
                        JOIN KeptEditions ke ON e.id = ke.id
                        WHERE e.parent_edition_id IS NOT NULL
                    )
                    DELETE FROM editions WHERE id NOT IN (SELECT id FROM KeptEditions);
                `,
                params: [thresholdDateISO]
            },
            {
                sql: `
                    WITH KeptAtoms AS (
                        SELECT DISTINCT atom_id FROM edition_atoms
                    )
                    DELETE FROM atoms WHERE id NOT IN (SELECT atom_id FROM KeptAtoms);
                `
            }
        ];

        const results = await executeD1(queries);

        let deletedCount = 0;
        if (results[0]?.meta?.changes) deletedCount += results[0].meta.changes;
        if (results[1]?.meta?.changes) deletedCount += results[1].meta.changes;

        return deletedCount;
    }
}

export const sqlStorage = new SqlStorage();
