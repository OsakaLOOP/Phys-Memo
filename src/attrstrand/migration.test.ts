import { test, describe, it, beforeEach } from 'node:test';
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

import { migrateAtoms } from './migration';
import { IContentAtom } from './types';

describe('Migration Logic', () => {
    beforeEach(() => {
        global.localStorage.clear();
    });

    it('should migrate old hashes to SHA-256', async () => {
        // Setup old data
        const oldAtom: IContentAtom = {
            id: 'atom1',
            contentJson: 'test content',
            contentHash: '12345678', // Short hash (8 chars)
            contentSimHash: 'abcdef12',
            field: 'doc',
            type: 'markdown',
            creatorId: 'user1',
            createdAt: new Date().toISOString(),
            attr: {},
            derivedFromId: null,
            frontMeta: {},
            backMeta: {}
        };

        const atoms = { [oldAtom.id]: oldAtom };
        localStorage.setItem('attr_atoms', JSON.stringify(atoms));

        // Run migration
        await migrateAtoms();

        // Check result
        const raw = localStorage.getItem('attr_atoms');
        const updatedAtoms = JSON.parse(raw!);
        const updatedAtom = updatedAtoms['atom1'];

        // Should have new hash length 64
        assert.strictEqual(updatedAtom.contentHash.length, 64, "Hash should be 64 chars (SHA-256 hex)");
        assert.notStrictEqual(updatedAtom.contentHash, '12345678');

        // Simhash should now be 64 chars (256-bit)
        assert.strictEqual(updatedAtom.contentSimHash.length, 64, "Simhash should be 64 chars (256-bit hex)");
    });

    it('should not migrate already migrated data', async () => {
        // Setup new data (mocked SHA-256)
        const newHash = 'a'.repeat(64);
        const atom: IContentAtom = {
            id: 'atom2',
            contentJson: 'already migrated',
            contentHash: newHash,
            contentSimHash: '12345678',
            field: 'doc',
            type: 'markdown',
            creatorId: 'user1',
            createdAt: new Date().toISOString(),
            attr: {},
            derivedFromId: null,
            frontMeta: {},
            backMeta: {}
        };

        const atoms = { [atom.id]: atom };
        localStorage.setItem('attr_atoms', JSON.stringify(atoms));

        // Spy on setItem to ensure it's NOT called
        let setItemCalled = false;
        const originalSetItem = localStorage.setItem;
        localStorage.setItem = (k, v) => {
            setItemCalled = true;
            originalSetItem(k, v);
        };

        await migrateAtoms();

        assert.strictEqual(setItemCalled, false, "Should not save if no migration needed");
    });
});
