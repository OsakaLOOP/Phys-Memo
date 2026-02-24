import { IContentAtom } from './types';
import { generateContentHash, simhash } from './utils';

const STORAGE_KEYS = {
    ATOMS: 'attr_atoms'
};

export async function migrateAtoms() {
    console.log("Checking for data migration...");
    if (typeof localStorage === 'undefined') return;

    const raw = localStorage.getItem(STORAGE_KEYS.ATOMS);
    if (!raw) return;

    let atoms: Record<string, IContentAtom> = {};
    try {
        atoms = JSON.parse(raw);
    } catch (e) {
        console.error("Failed to parse atoms for migration", e);
        return;
    }

    let migratedCount = 0;
    let needsSave = false;

    for (const key of Object.keys(atoms)) {
        const atom = atoms[key];

        // Check if migration is needed
        // New SHA-256 hash is 64 hex characters.
        // Old simple hash was 8 hex characters (32-bit).
        // If contentHash length < 64, we need to migrate.

        const isOldHash = !atom.contentHash || atom.contentHash.length < 64;

        if (isOldHash) {
            // Re-calculate hashes using new async SHA-256 implementation
            try {
                const newHash = await generateContentHash(atom.contentJson);
                const newSimHash = await simhash(atom.contentJson);

                // Update in place
                atom.contentHash = newHash;
                atom.contentSimHash = newSimHash;

                migratedCount++;
                needsSave = true;
            } catch (err) {
                console.error(`Failed to migrate atom ${atom.id}`, err);
            }
        }
    }

    if (needsSave) {
        localStorage.setItem(STORAGE_KEYS.ATOMS, JSON.stringify(atoms));
        console.log(`Migrated ${migratedCount} atoms to SHA-256 hashes.`);
    } else {
        console.log("Data migration check complete: All atoms are up to date.");
    }
}
