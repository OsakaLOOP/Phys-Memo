import { storage } from './storage.ts';
import { generateConceptHash, generateAtomHash, generateEditionHash, generateContentHash, simhash } from './utils.ts';
import type { IConceptRoot, IEdition, IContentAtom, ContentAtomField } from './types.ts';

// Migration script for old data formats.
export const migrateData = async () => {
    try {
        const res = await fetch('/default_data_v2.json');
        if (!res.ok) return;
        const defaultData = await res.json();

        // Load disciplines
        if (defaultData.disciplines) {
            for (const d of defaultData.disciplines) {
                // Support legacy formatting
                const newD = {
                    name: d.name,
                    abbr: d.abbr || d.name.substring(0, 2),
                    color: d.color,
                    hue: d.hue || 0
                };
                await storage.saveDiscipline(newD);
            }
        }

        // Map of old IDs to new Hash IDs to fix parent pointers and edition lists
        const idMap: Record<string, string> = {};

        // 1. Migrate Concepts
        if (defaultData.attr_concepts) {
            for (const c of Object.values<import('./types.ts').IConceptRoot & { createdAt?: string }>(defaultData.attr_concepts as Record<string, import('./types.ts').IConceptRoot & { createdAt?: string }>)) {
                // Ensure proper hash
                const newId = await generateConceptHash(c.name, c.creatorId || 'system', c.createdAt || new Date().toISOString());
                idMap[c.id] = newId;

                const concept: IConceptRoot = {
                    id: newId,
                    name: c.name,
                    topic: c.topic || '未分类',
                    disciplines: c.disciplines || [],
                    creatorId: c.creatorId || 'system',
                    timestampISO: c.createdAt || new Date().toISOString(),
                    currentHeads: {}, // Rebuild this based on editions
                    frontMeta: c.frontMeta || {},
                    backMeta: c.backMeta || { createdAt: c.createdAt || new Date().toISOString() }
                };

                await storage.saveConcept(concept);
            }
        }

        // 2. Migrate Atoms
        if (defaultData.attr_atoms) {
            for (const a of Object.values<import('./types.ts').IContentAtom & { contentJson?: string, createdAt?: string }>(defaultData.attr_atoms as Record<string, import('./types.ts').IContentAtom & { contentJson?: string, createdAt?: string }>)) {
                const content = a.content || a.contentJson || '';
                const cHash = await generateContentHash(content);
                const sHash = await simhash(content);
                const attr = a.attr || { 'system': 1 };

                const newId = await generateAtomHash(
                    a.field,
                    a.type,
                    cHash,
                    a.creatorId || 'system',
                    a.derivedFromId || null,
                    attr
                );

                idMap[a.id] = newId;

                const atom: IContentAtom = {
                    id: newId,
                    field: a.field as ContentAtomField,
                    type: a.type,
                    content: content,
                    contentHash: cHash,
                    contentSimHash: sHash,
                    creatorId: a.creatorId || 'system',
                    timestampISO: a.createdAt || new Date().toISOString(),
                    attr,
                    derivedFromId: a.derivedFromId && idMap[a.derivedFromId] ? idMap[a.derivedFromId] : null,
                    frontMeta: a.frontMeta || {},
                    backMeta: a.backMeta || { createdAt: a.createdAt || new Date().toISOString() }
                };

                await storage.saveAtom(atom);
            }
        }

        // 3. Migrate Editions
        if (defaultData.attr_editions) {
            const sortedEditions = Object.values<import('./types.ts').IEdition & { createdAt?: string }>(defaultData.attr_editions as Record<string, import('./types.ts').IEdition & { createdAt?: string }>)
                .sort((a, b) => new Date(a.createdAt || a.timestampISO || 0).getTime() - new Date(b.createdAt || b.timestampISO || 0).getTime());

            for (const e of sortedEditions) {
                const conceptId = idMap[e.conceptId] || e.conceptId;
                const parentId = e.parentEditionId ? idMap[e.parentEditionId] || e.parentEditionId : null;

                const mapIds = (ids: string[]) => (ids || []).map(id => idMap[id] || id);

                const coreIds = mapIds(e.coreAtomIds);
                const docIds = mapIds(e.docAtomIds);
                const tagsIds = mapIds(e.tagsAtomIds);
                const refsIds = mapIds(e.refsAtomIds);
                const relsIds = mapIds(e.relsAtomIds);

                const newId = await generateEditionHash(
                    conceptId,
                    parentId,
                    coreIds,
                    docIds,
                    tagsIds,
                    refsIds,
                    relsIds,
                    e.creator || 'system',
                    e.createdAt || new Date().toISOString()
                );

                idMap[e.id] = newId;

                const edition: IEdition = {
                    id: newId,
                    conceptId,
                    parentEditionId: parentId,
                    saveType: e.saveType || 'publish',
                    coreAtomIds: coreIds,
                    docAtomIds: docIds,
                    tagsAtomIds: tagsIds,
                    refsAtomIds: refsIds,
                    relsAtomIds: relsIds,
                    creator: e.creator || 'system',
                    timestampISO: e.createdAt || new Date().toISOString(),
                    frontMeta: e.frontMeta || {},
                    backMeta: e.backMeta || { createdAt: e.createdAt || new Date().toISOString() }
                };

                await storage.saveEdition(edition);

                // Update concept heads manually
                const concept = await storage.getConcept(conceptId);
                if (concept) {
                    if (parentId && concept.currentHeads[parentId]) {
                        delete concept.currentHeads[parentId];
                    }
                    concept.currentHeads[newId] = Date.now();
                    await storage.saveConcept(concept);
                }
            }
        }

    } catch(e) {
        console.error("Migration failed:", e);
    }
}
