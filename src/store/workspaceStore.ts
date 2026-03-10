import { create } from 'zustand';
import { temporal } from 'zundo';
import type {
    IWorkspaceDraft, AtomDraft, DraftId, ContentAtomField,
    ContentAtomType, IPopulatedEdition, DisciplineData, IConceptView
} from '../attrstrand/types';

// 全局 Store
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

// 实现历史记录撤销重做的 Workspace Draft Store
interface WorkspaceState extends IWorkspaceDraft {
    initWorkspace: (edition: IPopulatedEdition | null, conceptId: string, conceptName: string, conceptTopic: string, conceptDisciplines: string[]) => void;

    // Concept Metadata
    updateConceptMeta: (name: string, topic: string, disciplines: string[]) => void;

    // Atom ID List 操作
    addAtomId: (field: ContentAtomField, id: DraftId, index?: number) => void;
    removeAtomId: (field: ContentAtomField, index: number) => void;

    // Atom 自身操作
    updateAtomContent: (id: DraftId, content: string) => void;

    // Commit 触发的更新操作
    markCommitted: (newBaseEditionId: string, oldToNewMap: Record<string, string>) => void;
}

// 来自 uuid 的 DraftId
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
                // 新建空白 Workspace
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
            // 否则加载已有 Edition 数据到 Workspace 内存
            const draftAtomsData: Record<DraftId, AtomDraft> = {};// 待提取至 types
            
            const mapIds = (atoms: any[]): string[] => {
                return atoms.map((a) => {
                    draftAtomsData[a.id] = {
                        id: a.id,
                        field: a.field,
                        type: a.type,
                        content: a.content || a.contentJson, // legacy
                        creatorId: a.creatorId,
                        derivedFromId: a.id, // 加载原有 Atom 的继承.
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
        // Concept Metadata 更新. 后期必须引入防抖, 而且 Metadata 将会跟着 Concept 一起提交.
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
                        creatorId: 'user', // 待完善用户系统后替换
                        derivedFromId: null, // 新建 Atom 的 uuid 分配
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
                const listKey = `draft${field.charAt(0).toUpperCase() + field.slice(1)}AtomIds` as keyof IWorkspaceDraft;// 糟糕的做法.
                const list = [...(state[listKey] as string[])];
                list.splice(index, 1);

                // 撤销不删除孤立 Atom 数据. 后期引入 lost-found 和清理机制. 由于撤销后新操作而被覆盖的 Atom 数据会作为 autosave 保存, 然后本地清理.

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

                // 维持 derivedFromId不变, 以便提交时溯源. 在 markCommitted 时才会更新指向新的 Hash.

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

// --- Action Helpers ---
// Zundo 的清理操作应当在 Zustand 外部同步执行，确保业务原子性和清空历史的正确性。

export const workspaceActions = {
    initWorkspaceAndClear: (
        edition: IPopulatedEdition | null,
        conceptId: string,
        conceptName: string,
        conceptTopic: string,
        conceptDisciplines: string[]
    ) => {
        useWorkspaceStore.getState().initWorkspace(edition, conceptId, conceptName, conceptTopic, conceptDisciplines);
        useWorkspaceStore.temporal.getState().clear();
    },

    markCommittedAndClear: (newBaseEditionId: string, oldToNewMap: Record<string, string>) => {
        useWorkspaceStore.getState().markCommitted(newBaseEditionId, oldToNewMap);
        useWorkspaceStore.temporal.getState().clear();
    }
};

export { genTempId };