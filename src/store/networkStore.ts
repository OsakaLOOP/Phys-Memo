import { create } from 'zustand';
import { storage } from '../attrstrand/storage';
import type { IConceptRoot, IEdition } from '../attrstrand/types';

interface NetworkState {
    conceptId: string | null;
    concept: IConceptRoot | null;
    editions: IEdition[];
    isLoading: boolean;
    error: Error | null;

    fetchData: (conceptId: string, force?: boolean) => Promise<void>;
    clear: () => void;
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
    conceptId: null,
    concept: null,
    editions: [],
    isLoading: false,
    error: null,

    fetchData: async (conceptId: string, force = false) => {
        const state = get();
        if (!force && state.conceptId === conceptId && state.concept && state.editions.length > 0) {
            return; // Already loaded
        }

        set({ isLoading: true, error: null });
        try {
            const [c, e] = await Promise.all([
                storage.getConcept(conceptId),
                storage.getEditionsByConcept(conceptId)
            ]);

            // 严格基于父子依赖的拓扑排序 (Kahn's Algorithm) + 时间兜底
            const idToEdition = new Map<string, IEdition>();
            const childrenMap = new Map<string, string[]>();
            const inDegree = new Map<string, number>();

            e.forEach(edition => {
                idToEdition.set(edition.id, edition);
                inDegree.set(edition.id, 0); // 初始化入度
                childrenMap.set(edition.id, []);
            });

            e.forEach(edition => {
                if (edition.parentEditionId && idToEdition.has(edition.parentEditionId)) {
                    childrenMap.get(edition.parentEditionId)!.push(edition.id);
                    inDegree.set(edition.id, inDegree.get(edition.id)! + 1);
                }
            });

            // 提取所有入度为 0 的根节点
            const queue: IEdition[] = [];
            e.forEach(edition => {
                if (inDegree.get(edition.id) === 0) {
                    queue.push(edition);
                }
            });

            // 按照时间排序优先处理较早的节点
            queue.sort((a, b) => new Date(a.timestampISO).getTime() - new Date(b.timestampISO).getTime());

            const sortedEditions: IEdition[] = [];
            while (queue.length > 0) {
                const current = queue.shift()!;
                sortedEditions.push(current);

                const children = childrenMap.get(current.id)!;
                // 对子节点也按照时间排序，保证同一父节点的子节点有序
                children.sort((aId, bId) => {
                    const aDate = new Date(idToEdition.get(aId)!.timestampISO).getTime();
                    const bDate = new Date(idToEdition.get(bId)!.timestampISO).getTime();
                    return aDate - bDate;
                });

                for (const childId of children) {
                    const degree = inDegree.get(childId)! - 1;
                    inDegree.set(childId, degree);
                    if (degree === 0) {
                        queue.push(idToEdition.get(childId)!);
                    }
                }
            }

            // 兜底：处理可能的环形依赖 (断开环)，追加到最后
            if (sortedEditions.length < e.length) {
                const remaining = e.filter(edition => !sortedEditions.includes(edition));
                remaining.sort((a, b) => new Date(a.timestampISO).getTime() - new Date(b.timestampISO).getTime());
                sortedEditions.push(...remaining);
            }

            set({
                conceptId,
                concept: c,
                editions: sortedEditions,
                isLoading: false
            });
        } catch (error) {
            console.error('Failed to load network data:', error);
            set({ error: error as Error, isLoading: false });
        }
    },

    clear: () => set({ conceptId: null, concept: null, editions: [], isLoading: false, error: null }),
}));
