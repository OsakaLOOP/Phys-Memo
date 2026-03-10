import { create } from 'zustand';
import { temporal } from 'zundo';
import type {
    IWorkspaceDraft, AtomDraft, DraftId, ContentAtomField,
    ContentAtomType, IPopulatedEdition, DisciplineData, IConceptView
} from '../attrstrand/types';

// Global Data Store
interface GlobalState {
    disciplines: DisciplineData[];
    conceptViews: Record<string, IConceptView>; // Map of all concepts for the sidebar
    setDisciplines: (disciplines: DisciplineData[]) => void;
    setConceptViews: (views: Record<string, IConceptView>) => void;
}

export const useGlobalStore = create<GlobalState>((set: any) => ({
    disciplines: [],
    conceptViews: {},
    setDisciplines: (disciplines: DisciplineData[]) => set({ disciplines }),
    setConceptViews: (views: Record<string, IConceptView>) => set({ conceptViews: views }),
}));

// Workspace Draft Store with Undo/Redo
interface WorkspaceState extends IWorkspaceDraft {
    initWorkspace: (edition: IPopulatedEdition | null, conceptId: string, conceptName: string, conceptTopic: string, conceptDisciplines: string[]) => void;

    // Concept Metadata
    updateConceptMeta: (name: string, topic: string, disciplines: string[]) => void;

    // List Operations
    addAtomId: (field: ContentAtomField, id: DraftId, index?: number) => void;
    removeAtomId: (field: ContentAtomField, index: number) => void;

    // Atom Operations
    updateAtomContent: (id: DraftId, content: string) => void;

    // Commit Control
    markCommitted: (newBaseEditionId: string, oldToNewMap: Record<string, string>) => void;
}

// Helper to generate temporary DraftId
const genTempId = () => `temp_${crypto.randomUUID().replace(/-/g, '')}`;

export const useWorkspaceStore = create<WorkspaceState>()(
    temporal((set: any) => ({
        conceptId: '',
        baseEditionId: null as string | null as string | null,
        conceptName: '',
        conceptTopic: '未分类',
        conceptDisciplines: [] as string[] as string[],
        lastEdited: new Date().toISOString(),

        draftCoreAtomIds: [] as string[],
        draftDocAtomIds: [] as string[],
        draftTagsAtomIds: [] as string[],
        draftRefsAtomIds: [] as string[],
        draftRelsAtomIds: [] as string[],
        draftAtomsData: {},

        initWorkspace: (edition: IPopulatedEdition | null, conceptId: string, conceptName: string, conceptTopic: string, conceptDisciplines: string[]) => {
            if (!edition) {
                // Empty new workspace
                set({
                    conceptId,
                    baseEditionId: null as string | null,
                    conceptName,
                    conceptTopic,
                    conceptDisciplines,
                    lastEdited: new Date().toISOString(),
                    draftCoreAtomIds: [] as string[],
                    draftDocAtomIds: [] as string[],
                    draftTagsAtomIds: [] as string[],
                    draftRefsAtomIds: [] as string[],
                    draftRelsAtomIds: [] as string[],
                    draftAtomsData: {},
                });
                return;
            }

            const draftAtomsData: Record<DraftId, AtomDraft> = {};

            const mapIds = (atoms: any[]): string[] => {
                return atoms.map((a) => {
                    draftAtomsData[a.id] = {
                        id: a.id,
                        field: a.field,
                        type: a.type,
                        content: a.content || a.contentJson, // Handle legacy load temporarily
                        creatorId: a.creatorId,
                        derivedFromId: a.derivedFromId || a.id, // For loaded atoms, the original id is the derivation point if it gets edited
                        frontMeta: a.frontMeta || {},
                        isDirty: false
                    };
                    return a.id;
                });
            };

            set({
                conceptId: edition.conceptId,
                baseEditionId: edition.id,
                conceptName,
                conceptTopic,
                conceptDisciplines,
                lastEdited: new Date().toISOString(),
                draftCoreAtomIds: mapIds(edition.coreAtoms),
                draftDocAtomIds: mapIds(edition.docAtoms),
                draftTagsAtomIds: mapIds(edition.tagsAtoms),
                draftRefsAtomIds: mapIds(edition.refsAtoms),
                draftRelsAtomIds: mapIds(edition.relsAtoms),
                draftAtomsData,
            });
        },

        updateConceptMeta: (name: string, topic: string, disciplines: string[]) => {
            set({ conceptName: name, conceptTopic: topic, conceptDisciplines: disciplines, lastEdited: new Date().toISOString() });
        },

        addAtomId: (field: ContentAtomField, id: DraftId, index?: number) => {
            set((state: any) => {
                const listKey = `draft${field.charAt(0).toUpperCase() + field.slice(1)}AtomIds` as keyof IWorkspaceDraft;
                const list = [...(state[listKey] as string[])];
                if (index !== undefined && index >= 0) {
                    list.splice(index + 1, 0, id);
                } else {
                    list.push(id);
                }

                // Ensure atom exists in data map
                const newData = { ...state.draftAtomsData };
                if (!newData[id]) {
                    // Default type mapping
                    let type: ContentAtomType = 'markdown';
                    if (field === 'core') type = 'latex';
                    if (field === 'tags' || field === 'rels') type = 'inline';
                    if (field === 'refs') type = 'sources';

                    newData[id] = {
                        id,
                        field,
                        type,
                        content: '',
                        creatorId: 'user', // Replace with real user context if needed
                        derivedFromId: null, // New UUID atom
                        frontMeta: {},
                        isDirty: true,
                    };
                }

                return {
                    [listKey]: list,
                    draftAtomsData: newData,
                    lastEdited: new Date().toISOString()
                };
            });
        },

        removeAtomId: (field: ContentAtomField, index: number) => {
            set((state: any) => {
                const listKey = `draft${field.charAt(0).toUpperCase() + field.slice(1)}AtomIds` as keyof IWorkspaceDraft;
                const list = [...(state[listKey] as string[])];
                list.splice(index, 1);

                // Note: We don't necessarily delete the draftAtomsData key yet, allows undo without losing data object

                return {
                    [listKey]: list,
                    lastEdited: new Date().toISOString()
                };
            });
        },

        updateAtomContent: (id: DraftId, content: string) => {
            set((state: any) => {
                const atom = state.draftAtomsData[id];
                if (!atom) return state; // Should not happen

                const updatedAtom = { ...atom, content, isDirty: true };

                // If it's an original hash atom, its derivedFromId is already correctly its original hash.
                // If it's a UUID atom, its derivedFromId is null.

                return {
                    draftAtomsData: { ...state.draftAtomsData, [id]: updatedAtom },
                    lastEdited: new Date().toISOString()
                };
            });
        },

        markCommitted: (newBaseEditionId: string, oldToNewMap: Record<string, string>) => {
             // Re-map all temp UUIDs or old hashes to their new submitted Hashes, and reset isDirty
             set((state: any) => {
                 const newData: Record<DraftId, AtomDraft> = {};
                 const mapList = (list: string[]) => list.map(id => oldToNewMap[id] || id);

                 const draftCoreAtomIds = mapList(state.draftCoreAtomIds);
                 const draftDocAtomIds = mapList(state.draftDocAtomIds);
                 const draftTagsAtomIds = mapList(state.draftTagsAtomIds);
                 const draftRefsAtomIds = mapList(state.draftRefsAtomIds);
                 const draftRelsAtomIds = mapList(state.draftRelsAtomIds);

                 // Keep data mapped to new IDs
                 for (const oldId of Object.keys(state.draftAtomsData)) {
                     const newId = oldToNewMap[oldId] || oldId;
                     newData[newId] = {
                         ...state.draftAtomsData[oldId],
                         id: newId,
                         isDirty: false, // Clean slate
                         derivedFromId: newId // Ready for next edits
                     };
                 }

                 return {
                     baseEditionId: newBaseEditionId,
                     draftCoreAtomIds,
                     draftDocAtomIds,
                     draftTagsAtomIds,
                     draftRefsAtomIds,
                     draftRelsAtomIds,
                     draftAtomsData: newData,
                 };
             });

             // Also clear zundo history (zundo expose clear mechanism on the store)
             // We'll do it from outside component if needed, or by ignoring history boundary.
        }
    }),
    {
        limit: 50,
        // Optional diffing strategies can be defined here
        handleSet: (handleSet) => {
            // Can add debounce/throttle logic here if required. Zundo hooks directly into Zustand `set`.
            return (state) => {
               // Ignore typing updates from the same field immediately
               handleSet(state);
            };
        }
    })
);

export { genTempId };