import { create } from 'zustand';
import { temporal } from 'zundo';
import type {
    IWorkspaceDraft, AtomDraft, DraftId, ContentAtomField,
    ContentAtomType, IPopulatedEdition, DisciplineData, IConceptView, IContentAtom
} from '../attrstrand/types';

// 全局 Store
interface GlobalState {
    disciplines: DisciplineData[];
    conceptViews: Record<string, IConceptView>; // sidebar
    setDisciplines: (disciplines: DisciplineData[]) => void;
    setConceptViews: (views: Record<string, IConceptView>) => void;
}

export const useGlobalStore = create<GlobalState>()((set) => ({
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
    updateAtomBlobs: (id: DraftId, blobs: Record<string, Blob | ArrayBuffer>) => void;
    updateAtomMeta: (id: DraftId, frontMeta: Record<string, any>) => void;

    // 批量更新 Atom 状态 (用于单实例编辑器)
    applyAtomTransactions: (field: ContentAtomField, transactions: {
        id: DraftId;
        action: 'update' | 'create' | 'delete';
        content?: string;
        index?: number; // 对于 create
    }[], newOrder?: DraftId[]) => void;

    // Commit 触发的更新操作
    markCommitted: (newBaseEditionId: string, oldToNewMap: Record<string, string>) => void;

    // Lint state per field
    fieldLintErrors: Record<ContentAtomField, boolean>;
    setFieldLintError: (field: ContentAtomField, hasError: boolean) => void;

    // Editor UI State
    activeEditor: { field: ContentAtomField, id: DraftId } | null;
    setActiveEditor: (editor: { field: ContentAtomField, id: DraftId } | null) => void;
    cmUndoDepth: number;
    cmRedoDepth: number;
    setCMHistoryDepth: (undoDepth: number, redoDepth: number) => void;

    // CM Parallel State (NOT tracked by zundo) - 仅用于外界 UI 读取显示
    cmDraftAtomLists: Record<ContentAtomField, string[]>;
    cmDraftAtomsData: Record<DraftId, AtomDraft>;
    syncCMToParallelState: (field: ContentAtomField, newList: string[], newAtomsData: Record<DraftId, AtomDraft>) => void;
    initParallelState: (field: ContentAtomField) => void;

    // 应用 CM 产生的批量快照到 Zundo 历史
    applyCMSnapshotsToZundo: (field: ContentAtomField, snapshots: { list: string[], data: Record<string, AtomDraft> }[]) => void;
}

// 来自 uuid 的 DraftId
const genTempId = () => `temp_${crypto.randomUUID().replace(/-/g, '')}`;

export const useWorkspaceStore = create<WorkspaceState>()(
    temporal((set) => ({
        conceptId: '',
        baseEditionId: null as string | null,
        conceptName: '',
        conceptTopic: '未分类',
        conceptDisciplines: [] as string[] as string[],
        lastEdited: new Date().toISOString(),
        cmSessionId: null,

        draftAtomLists: { core: [], doc: [], tags: [], refs: [], rels: [] } as Record<ContentAtomField, string[]>,
        draftAtomsData: {},

        fieldLintErrors: {
            core: false,
            doc: false,
            tags: false,
            refs: false,
            rels: false,
        },
        setFieldLintError: (field, hasError) => set((state) => ({
            fieldLintErrors: { ...state.fieldLintErrors, [field]: hasError }
        })),

        activeEditor: null,
        setActiveEditor: (editor) => set({ activeEditor: editor, cmUndoDepth: 0, cmRedoDepth: 0 }),
        cmUndoDepth: 0,
        cmRedoDepth: 0,
        setCMHistoryDepth: (undoDepth, redoDepth) => set({ cmUndoDepth: undoDepth, cmRedoDepth: redoDepth }),

        cmDraftAtomLists: { core: [], doc: [], tags: [], refs: [], rels: [] } as Record<ContentAtomField, string[]>,
        cmDraftAtomsData: {},

        syncCMToParallelState: (field: ContentAtomField, newList: string[], newAtomsData: Record<DraftId, AtomDraft>) => {
            set((state) => ({
                cmDraftAtomLists: { ...state.cmDraftAtomLists, [field]: newList },
                cmDraftAtomsData: { ...state.cmDraftAtomsData, ...newAtomsData }
            }));
        },

        initParallelState: (field: ContentAtomField) => {
            set((state) => ({
                cmDraftAtomLists: { ...state.cmDraftAtomLists, [field]: [...(state.draftAtomLists[field] || [])] },
                cmDraftAtomsData: { ...state.cmDraftAtomsData, ...state.draftAtomsData }
            }));
        },

        applyCMSnapshotsToZundo: (field: ContentAtomField, snapshots: { list: string[], data: Record<string, AtomDraft> }[]) => {
            // All snapshots from this session get the same tag
            const sessionId = `cm_${crypto.randomUUID().substring(0, 8)}`;

            // Apply snapshots sequentially to generate separate history entries
            for (const snap of snapshots) {
                set((state) => {
                    const mergedData = { ...state.draftAtomsData };
                    for (const id of snap.list) {
                        if (snap.data[id]) {
                            mergedData[id] = snap.data[id];
                        }
                    }

                    return {
                        draftAtomLists: { ...state.draftAtomLists, [field]: [...snap.list] },
                        draftAtomsData: mergedData,
                        lastEdited: new Date().toISOString(),
                        cmSessionId: sessionId
                    };
                });
            }

            // At the end of packing all snapshots, print out the final history state
            logZundoState(`applyCMSnapshotsToZundo (sessionId: ${sessionId}, snapshots: ${snapshots.length})`);
        },

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
                    cmSessionId: null,
                    draftAtomLists: { core: [], doc: [], tags: [], refs: [], rels: [] } as Record<ContentAtomField, string[]>,
                    draftAtomsData: {},
                cmDraftAtomLists: { core: [], doc: [], tags: [], refs: [], rels: [] } as Record<ContentAtomField, string[]>,
                cmDraftAtomsData: {},
                activeEditor: null,
                });
                return;
            }
            // 否则加载已有 Edition 数据到 Workspace 内存
            const draftAtomsData: Record<DraftId, AtomDraft> = {};// 待提取至 types
            
            type PopulatedAtom = Omit<IContentAtom, 'backMeta'> & { contentJson?: string };
            const mapIds = (atoms: PopulatedAtom[]): string[] => {
                return atoms.map((a) => {
                    // 初始化加载时，严格去除头尾空行
                    const rawContent = a.content || a.contentJson || '';
                    draftAtomsData[a.id] = {
                        id: a.id,
                        field: a.field,
                        type: a.type,
                        content: rawContent.trim(),
                        creatorId: a.creatorId,
                        derivedFromId: a.id, // 加载原有 Atom 的继承.
                        frontMeta: a.frontMeta || {},
                        isDirty: false,
                        diffAdded: a.diffAdded,
                        diffDeleted: a.diffDeleted,
                        diffRetained: a.diffRetained,
                        attr: a.attr,
                    } as AtomDraft; // AtomDraft 忽略了 attr 等但实际可以用来在气泡等渲染兜底。由于 type 限定，我们这里合并入并断言或提取
                    // 注意：AtomDraft 类型定义使用了 Omit去除了这些字段，如果是作为草稿其实不该包含，
                    // 但我们需要渲染，修改 types.ts 以让 AtomDraft 兼容或者这里 as AtomDraft。
                    // 此处加上 diff 和 attr 字段保证保存后刷新能读取到后端计算的结果
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
                cmSessionId: null,
                draftAtomLists: {
                    core: mapIds(edition.coreAtoms),
                    doc: mapIds(edition.docAtoms),
                    tags: mapIds(edition.tagsAtoms),
                    refs: mapIds(edition.refsAtoms),
                    rels: mapIds(edition.relsAtoms),
                },
                draftAtomsData,
                cmDraftAtomLists: {
                    core: mapIds(edition.coreAtoms),
                    doc: mapIds(edition.docAtoms),
                    tags: mapIds(edition.tagsAtoms),
                    refs: mapIds(edition.refsAtoms),
                    rels: mapIds(edition.relsAtoms),
                },
                cmDraftAtomsData: { ...draftAtomsData },
                activeEditor: null,
            });
        },
        // Concept Metadata 更新. 后期必须引入防抖, 而且 Metadata 将会跟着 Concept 一起提交.
        updateConceptMeta: (name: string, topic: string, disciplines: string[]) => {
            set({ conceptName: name, conceptTopic: topic, conceptDisciplines: disciplines, lastEdited: new Date().toISOString() });
        },

        addAtomId: (field: ContentAtomField, id: DraftId, index?: number) => {
            set((state) => {
                const list = [...(state.draftAtomLists[field] || [])];
                if (index !== undefined) {
                    if (index === -1) {
                        list.unshift(id);
                    } else if (index >= 0) {
                        list.splice(index + 1, 0, id);
                    } else {
                        list.push(id);
                    }
                } else {
                    list.push(id);
                }

                                const newData = { ...state.draftAtomsData };
                if (!newData[id]) {
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
                    draftAtomLists: { ...state.draftAtomLists, [field]: list },
                    draftAtomsData: newData,
                    lastEdited: new Date().toISOString(),
                    cmSessionId: null
                };
            });
        },

        updateAtomBlobs: (id: DraftId, blobs: Record<string, Blob | ArrayBuffer>) => {
            set((state) => {
                const atom = state.draftAtomsData[id];
                if (!atom) return state;
                const updatedAtom = { ...atom, blobs, isDirty: true, type: 'bin' };

                return {
                    draftAtomsData: { ...state.draftAtomsData, [id]: updatedAtom as any },
                    lastEdited: new Date().toISOString(),
                    cmSessionId: null
                };
            });
        },

        updateAtomMeta: (id: DraftId, frontMeta: Record<string, any>) => {
            set((state) => {
                const atom = state.draftAtomsData[id];
                if (!atom) return state;
                let updatedAtom;
                if (atom.type === 'bin') {
                    updatedAtom = { ...atom, content: JSON.stringify(frontMeta), isDirty: true };
                } else {
                    updatedAtom = { ...atom, frontMeta, isDirty: true };
                }

                return {
                    draftAtomsData: { ...state.draftAtomsData, [id]: updatedAtom },
                    lastEdited: new Date().toISOString(),
                    cmSessionId: null
                };
            });
        },

        removeAtomId: (field: ContentAtomField, index: number) => {
            set((state) => {
                const list = [...(state.draftAtomLists[field] || [])];
                list.splice(index, 1);

                // 撤销不删除孤立 Atom 数据. 后期引入 lost-found 和清理机制. 由于撤销后新操作而被覆盖的 Atom 数据会作为 autosave 保存, 然后本地清理.

                return {
                    draftAtomLists: { ...state.draftAtomLists, [field]: list },
                    lastEdited: new Date().toISOString(),
                    cmSessionId: null
                };
            });
        },

        updateAtomContent: (id: DraftId, content: string) => {
            set((state) => {
                const atom = state.draftAtomsData[id];
                if (!atom) return state;
                const updatedAtom = { ...atom, content, isDirty: true };

                // 维持 derivedFromId不变, 以便提交时溯源. 在 markCommitted 时才会更新指向新的 Hash.

                return {
                    draftAtomsData: { ...state.draftAtomsData, [id]: updatedAtom },
                    lastEdited: new Date().toISOString(),
                    cmSessionId: null
                };
            });
        },

        applyAtomTransactions: (field: ContentAtomField, transactions: {
            id: DraftId;
            action: 'update' | 'create' | 'delete';
            content?: string;
            index?: number; // 对于 create
        }[], newOrder?: DraftId[]) => {
            set((state) => {
                let currentList = [...(state.draftAtomLists[field] || [])];
                const newData = { ...state.draftAtomsData };

                let orderChanged = false;

                for (const t of transactions) {
                    if (t.action === 'update' && t.content !== undefined) {
                        const atom = newData[t.id];
                        if (atom && atom.content !== t.content) {
                            newData[t.id] = { ...atom, content: t.content, isDirty: true };
                        }
                    } else if (t.action === 'create') {
                        let type: ContentAtomType = 'markdown';
                        if (field === 'core') type = 'latex';
                        if (field === 'tags' || field === 'rels') type = 'inline';
                        if (field === 'refs') type = 'sources';

                        newData[t.id] = {
                            id: t.id,
                            field,
                            type,
                            content: t.content || '',
                            creatorId: 'user',
                            derivedFromId: null,
                            frontMeta: {},
                            isDirty: true,
                        };

                        // Default insert behavior if newOrder is not provided
                        if (!newOrder) {
                            if (t.index !== undefined) {
                                if (t.index === -1) {
                                    currentList.unshift(t.id);
                                } else if (t.index >= 0) {
                                    currentList.splice(t.index + 1, 0, t.id);
                                } else {
                                    currentList.push(t.id);
                                }
                            } else {
                                currentList.push(t.id);
                            }
                            orderChanged = true;
                        }
                    } else if (t.action === 'delete') {
                        if (!newOrder) {
                            const idx = currentList.indexOf(t.id);
                            if (idx > -1) {
                                currentList.splice(idx, 1);
                                orderChanged = true;
                            }
                        }
                        // We intentionally don't delete from draftAtomsData to avoid breaking undo
                    }
                }

                if (newOrder) {
                     currentList = [...newOrder];
                     orderChanged = true;
                }

                // Optimization: only update state if something actually changed
                // (transactions might just be no-op updates)
                const stateChanges: Partial<WorkspaceState> = {};
                if (orderChanged) {
                     stateChanges.draftAtomLists = { ...state.draftAtomLists, [field]: currentList };
                }

                // Shallow compare data changes - simplified check since we mutated newData
                stateChanges.draftAtomsData = newData;
                stateChanges.lastEdited = new Date().toISOString();
                stateChanges.cmSessionId = null;

                return stateChanges as Partial<WorkspaceState>;
            });
        },

        markCommitted: (newBaseEditionId: string, oldToNewMap: Record<string, string>) => {
             // 提交后计算 Hashe, 重置 isDirty
             set((state) => {
                 const newData: Record<DraftId, AtomDraft> = {};
                 const mapList = (list: string[]) => list.map(id => oldToNewMap[id] || id);

                 const draftAtomLists = {
                     core: mapList(state.draftAtomLists.core || []),
                     doc: mapList(state.draftAtomLists.doc || []),
                     tags: mapList(state.draftAtomLists.tags || []),
                     refs: mapList(state.draftAtomLists.refs || []),
                     rels: mapList(state.draftAtomLists.rels || []),
                 };

                 const cmDraftAtomLists = { ...draftAtomLists };

                                  for (const oldId of Object.keys(state.draftAtomsData)) {
                     const newId = oldToNewMap[oldId] || oldId;
                     newData[newId] = {
                         ...state.draftAtomsData[oldId],
                         id: newId,
                         isDirty: false,                          derivedFromId: newId                      };
                 }

                 return {
                     baseEditionId: newBaseEditionId,
                     draftAtomLists,
                     draftAtomsData: newData,
                     cmDraftAtomLists,
                     cmDraftAtomsData: { ...newData }
                 };
             });
        }
    }),
    {
        limit: 50,
        // 仅包含文档编辑相关状态.
        partialize: (state) => ({
            conceptName: state.conceptName,
            conceptTopic: state.conceptTopic,
            conceptDisciplines: state.conceptDisciplines,
            draftAtomLists: state.draftAtomLists,
            draftAtomsData: state.draftAtomsData,
            cmSessionId: state.cmSessionId,
        }),
        // 必须配置 deep equality，否则 partialize 每次返回新对象会导致 zundo 哪怕无关状态改变也会记录相同历史
        equality: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        handleSet: (handleSet) => {
            // 后续副作用逻辑占位
            return (state) => {
               handleSet(state);
            };
        }
    })
);


// --- Action Helpers ---
// Zundo 的清理操作在 Zustand 外部同步执行，确保业务原子性和清空历史的正确性。

export const logZundoState = (action: string) => {
    const temporalState = useWorkspaceStore.temporal.getState();
    const past = temporalState.pastStates;
    const future = temporalState.futureStates;

    const formatState = (s: any) => s.cmSessionId ? `[${s.cmSessionId.substring(0, 6)}]` : '[none]';

    const pastStr = past.map(formatState).join(' -> ');
    const futureStr = future.map(formatState).join(' -> ');

    console.log(`[Zundo] ${action} | Past: ${pastStr || 'empty'} | Future: ${futureStr || 'empty'}`);
};

export const workspaceActions = {

    jumpSessionUndo: () => {
        const temporalState = useWorkspaceStore.temporal.getState();
        const past = temporalState.pastStates;
        if (past.length === 0) return;

        const currentSessionId = useWorkspaceStore.getState().cmSessionId;

        // If the current state doesn't have a session ID, just do a normal step undo
        if (!currentSessionId) {
            temporalState.undo(1);
            logZundoState('jumpSessionUndo (steps: 1)');
            return;
        }

        // pastStates is a stack where the end of the array is the most recent past state.
        // We step backwards through the past states.
        let steps = 0;
        for (let i = past.length - 1; i >= 0; i--) {
            steps++;
            // If we hit a state with a DIFFERENT session ID (or null), we stop stepping back
            // because we've found the boundary of the session.
            if (past[i].cmSessionId !== currentSessionId) {
                break;
            }
        }

        temporalState.undo(steps);
        logZundoState(`jumpSessionUndo (steps: ${steps})`);
    },

    jumpSessionRedo: () => {
        const temporalState = useWorkspaceStore.temporal.getState();
        const future = temporalState.futureStates;
        if (future.length === 0) return;

        // Note: futureStates is a stack where the end of the array is the IMMEDIATE NEXT state to redo.
        // Pop the state at future.length - 1 to redo it.
        const nextState = future[future.length - 1];
        const nextSessionId = nextState.cmSessionId;

        // If the immediate next state doesn't belong to a session, just normal redo
        if (!nextSessionId) {
            temporalState.redo(1);
            logZundoState('jumpSessionRedo (steps: 1)');
            return;
        }

        // We want to redo all the way to the END of this upcoming session.
        // That means we keep popping from the end of futureStates as long as the session ID matches.
        let steps = 0;
        for (let i = future.length - 1; i >= 0; i--) {
            steps++;
            if (i - 1 >= 0 && future[i - 1].cmSessionId !== nextSessionId) {
                break;
            }
        }

        temporalState.redo(steps);
        logZundoState(`jumpSessionRedo (steps: ${steps})`);
    },

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