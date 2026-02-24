import { test, describe, it, beforeEach, before } from 'node:test';
import assert from 'node:assert';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    // @ts-ignore
    globalThis.crypto = webcrypto;
}

// Mock localStorage
const store: Record<string, string> = {};
global.localStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const key in store) delete store[key]; },
    key: (index: number) => Object.keys(store)[index] || null,
    length: 0
};

// Import after mocking
import { AttrStrandCore, AtomSubmission } from './core';
import { storage } from './storage';
import { splitContent, simhash } from './utils';
import { ContentAtomField } from './types';

describe('AttrStrand Core Logic', () => {
    let core: AttrStrandCore;

    beforeEach(() => {
        global.localStorage.clear();
        core = new AttrStrandCore();
    });

    it('should split content correctly', () => {
        const text = "Para 1.\n\nPara 2.\n\n$$math$$";
        const parts = splitContent(text, 'markdown');
        // Para 1, Para 2, $$math$$
        // My split logic: $$math$$ is a block.
        // "Para 1.\n\nPara 2.\n\n" -> "Para 1.", "Para 2."
        // Then "$$math$$"
        assert.strictEqual(parts.length, 3);
        assert.strictEqual(parts[0], "Para 1.");
        assert.strictEqual(parts[2], "$$math$$");
    });

    it('should calculate simhash similarity', async () => {
        const h1 = await simhash("hello world");
        const h2 = await simhash("hello world");
        assert.strictEqual(h1, h2);
        assert.strictEqual(h1.length, 64, "Simhash should be 256-bit (64 hex chars)");

        const h3 = await simhash("hello universe");
        assert.notStrictEqual(h1, h3);

        // Test similarity logic explicitly
        // Exact match
        const simExact = core.calculateSimilarity(h1, h2);
        assert.strictEqual(simExact, 1);

        // Partial match
        const simPartial = core.calculateSimilarity(h1, h3);
        assert.ok(simPartial > 0 && simPartial < 1, "Should have partial similarity");
    });

    it('should create a concept and initial edition', async () => {
        const data: Record<ContentAtomField, AtomSubmission[]> = {
            doc: [{ content: "Initial Note", field: 'doc', type: 'markdown' }],
            core: [], tags: [], refs: [], rels: []
        };

        const concept = await core.createConcept("Test Concept", "user1", data);

        assert.strictEqual(concept.name, "Test Concept");
        assert.strictEqual(Object.keys(concept.currentHeads).length, 1);

        const editionId = Object.keys(concept.currentHeads)[0];
        const edition = await storage.getEdition(editionId);
        assert.ok(edition);
        assert.strictEqual(edition?.creator, "user1");
        assert.strictEqual(edition?.docAtomIds.length, 1);

        const atom = await storage.getAtom(edition?.docAtomIds[0]!);
        assert.strictEqual(atom?.contentJson, "Initial Note");
        assert.deepStrictEqual(atom?.attr, { user1: 1 });
    });

    it('should handle edition updates and attribution', async () => {
        // 1. Create initial concept
        const data1: Record<ContentAtomField, AtomSubmission[]> = {
            doc: [{ content: "Hello World", field: 'doc', type: 'markdown' }],
            core: [], tags: [], refs: [], rels: []
        };
        const concept = await core.createConcept("Attr Test", "user1", data1);
        const headId1 = Object.keys(concept.currentHeads)[0];
        const edition1 = await storage.getEdition(headId1);
        const atomId1 = edition1!.docAtomIds[0];

        // 2. User2 updates the note (simulated edit)
        // User2 changes "Hello World" to "Hello Universe" (similar)
        const data2: Record<ContentAtomField, AtomSubmission[]> = {
            doc: [{
                content: "Hello Universe",
                derivedFromId: atomId1, // Derived from user1's atom
                field: 'doc',
                type: 'markdown'
            }],
            core: [], tags: [], refs: [], rels: []
        };

        const edition2 = await core.createEdition(concept.id, headId1, data2, "user2", 'save');

        const atomId2 = edition2.docAtomIds[0];
        const atom2 = await storage.getAtom(atomId2);

        assert.notStrictEqual(atomId1, atomId2);
        assert.strictEqual(atom2?.contentJson, "Hello Universe");

        // Check Attribution
        // "Hello World" vs "Hello Universe" -> should be somewhat similar
        const attr = atom2!.attr;
        console.log("Attribution:", attr);

        assert.ok(attr.user1 > 0, "User1 should retain some credit");
        assert.ok(attr.user2 > 0, "User2 should get credit");
        assert.ok(Math.abs((attr.user1 + attr.user2) - 1) < 0.001, "Shares should sum to 1");
    });

    it('should handle branching', async () => {
        const data: Record<ContentAtomField, AtomSubmission[]> = {
            doc: [{ content: "Base", field: 'doc', type: 'markdown' }],
            core: [], tags: [], refs: [], rels: []
        };
        const concept = await core.createConcept("Branch Test", "user1", data);
        const rootId = Object.keys(concept.currentHeads)[0];

        // Branch A (User 2)
        const dataA = { ...data, doc: [{ content: "Base A", derivedFromId: (await storage.getEdition(rootId))!.docAtomIds[0], field: 'doc' as ContentAtomField, type: 'markdown' as const }] };
        const editionA = await core.createEdition(concept.id, rootId, dataA, "user2", 'save');

        // Branch B (User 3)
        const dataB = { ...data, doc: [{ content: "Base B", derivedFromId: (await storage.getEdition(rootId))!.docAtomIds[0], field: 'doc' as ContentAtomField, type: 'markdown' as const }] };
        const editionB = await core.createEdition(concept.id, rootId, dataB, "user3", 'save');

        // Both should be heads now?
        // Wait, createEdition updates concept heads.
        // When A is created, parent (root) is removed from heads, A is added.
        // When B is created, parent (root) is NOT in heads anymore (A removed it).
        // So B is added.
        // Result: Heads = { A, B }.

        const updatedConcept = await storage.getConcept(concept.id);
        const heads = Object.keys(updatedConcept!.currentHeads);
        assert.strictEqual(heads.length, 2);
        assert.ok(heads.includes(editionA.id));
        assert.ok(heads.includes(editionB.id));
    });

    it('should handle cherry picking (mixed sources)', async () => {
         // User1 creates concept with Note 1
         const data1 = {
             doc: [{ content: "Note 1", field: 'doc' as const, type: 'markdown' as const }],
             core: [], tags: [], refs: [], rels: []
         };
         const concept = await core.createConcept("Cherry Test", "user1", data1);
         const head1 = Object.keys(concept.currentHeads)[0];
         const atom1Id = (await storage.getEdition(head1))!.docAtomIds[0];

         // User2 creates a separate branch with Note 2
         const data2 = {
             doc: [{ content: "Note 2", field: 'doc' as const, type: 'markdown' as const }],
             core: [], tags: [], refs: [], rels: []
         };
         // Branching from same root (head1) to create parallel universe
         const edition2 = await core.createEdition(concept.id, head1, data2, "user2", 'save');
         const atom2Id = edition2.docAtomIds[0];

         // User 3 creates a new edition based on head1, but PICKS Note 2 from user 2
         // This is a "Merge" or "Cherry Pick".
         // Base is head1 (Note 1). User wants Note 2 instead.
         const data3 = {
             doc: [{ content: "Note 2", derivedFromId: atom2Id, field: 'doc' as const, type: 'markdown' as const }], // Derived from user2's atom
             core: [], tags: [], refs: [], rels: []
         };

         const edition3 = await core.createEdition(concept.id, head1, data3, "user3", 'save');

         const atom3Id = edition3.docAtomIds[0];
         const atom3 = await storage.getAtom(atom3Id);

         // Content matches Note 2 exactly.
         // Logic says: if content matches AND derivedFrom matches, Reuse.
         // Here derivedFrom is atom2Id. Content is "Note 2". Atom2 content is "Note 2".
         // So it should REUSE atom2Id.

         assert.strictEqual(atom3Id, atom2Id);
         assert.strictEqual(atom3?.creatorId, "user2"); // Original creator retained
    });
});
