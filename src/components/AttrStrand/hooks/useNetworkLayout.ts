import { useMemo } from 'react';
import * as d3 from 'd3';
import type { IConceptRoot, IEdition } from '../../../attrstrand/types';

export interface ProcessedNode {
    edition: IEdition;
    isHead: boolean;
    isCurrent: boolean;
    depth: number; // 距离root的深度
    color: string;
    x: number;
    y: number;
    trackIdx: number;
    childrenIds: string[]; // 子节点 ID 列表
}

export interface ProcessedLink {
    source: ProcessedNode;
    target: ProcessedNode;
    color: string;
}

export interface NetworkLayoutResult {
    nodes: ProcessedNode[];
    links: ProcessedLink[];
    layerHeight: number;
    nodeRadius: number;
    textStartX: number;
    totalHeight: number;
    start_Y: number;
    width: number;
    height: number;
}

const COLORS = d3.schemeCategory10; // 颜色板

export function useNetworkLayout(
    editions: IEdition[],
    concept: IConceptRoot | null,
    currentEditionId: string | undefined,
    containerWidth: number
): NetworkLayoutResult | null {
    return useMemo(() => {
        if (!editions.length || !concept || containerWidth <= 0) return null;

        const width = containerWidth - 32; // padding
        const height = 600;
        const nodeRadius = 6;
        const layerHeight = 45; // 每层高度

        // 1. 数据预处理与层级计算
        const heads = new Set(Object.keys(concept.currentHeads));

        const idToEdition = new Map<string, IEdition>();
        const childrenMap = new Map<string, string[]>(); // parentId -> childIds

        editions.forEach(e => {
            idToEdition.set(e.id, e);
            if (e.parentEditionId) {
                if (!childrenMap.has(e.parentEditionId)) {
                    childrenMap.set(e.parentEditionId, []);
                }
                childrenMap.get(e.parentEditionId)!.push(e.id);
            }
        });

        // 计算每个节点的深度 (因为 editions 已经是严格拓扑排序，只需要线性的动态规划即可)
        const depths = new Map<string, number>();

        editions.forEach(e => {
            let depth = 0;
            if (e.parentEditionId && depths.has(e.parentEditionId)) {
                depth = depths.get(e.parentEditionId)! + 1;
            }
            depths.set(e.id, depth);
        });

        // 2. 分支颜色分配算法（通达性与单条通路分割）
        const tracks: Array<string[]> = [];
        const unassignedIds = new Set(editions.map(e => e.id));

        // 从上到下找最长链：严格按照刚才算出的拓扑深度排序
        const sortedIds = [...editions].sort((a, b) => (depths.get(b.id) || 0) - (depths.get(a.id) || 0)).map(e => e.id);

        while (unassignedIds.size > 0) {
            // 寻找当前未分配节点中深度最大的（即最上面的叶子端）
            const startId = sortedIds.find(id => unassignedIds.has(id));
            if (!startId) break;

            const currentTrack: string[] = [];
            let currId: string | undefined = startId;
            let currentCreator = idToEdition.get(currId!)!.creator;

            while (currId && unassignedIds.has(currId)) {
                currentTrack.push(currId);
                unassignedIds.delete(currId);

                const edition = idToEdition.get(currId);
                const parentId = edition?.parentEditionId;

                if (parentId && idToEdition.has(parentId)) {
                    const parentEdition = idToEdition.get(parentId)!;
                    // 同一用户且通达
                    if (parentEdition.creator === currentCreator) {
                        currId = parentId;
                    } else {
                        currId = undefined; // 断开，作为新轨道的起点
                    }
                } else {
                    currId = undefined;
                }
            }
            tracks.push(currentTrack.reverse());
        }

        // 计算所有节点的虚拟行号以分配独占的Y轴高度，为后面的斜率计算做准备
        const sortedForRows = [...editions].sort((a, b) => {
            const depthA = depths.get(a.id) || 0;
            const depthB = depths.get(b.id) || 0;
            if (depthA !== depthB) return depthA - depthB;
            return new Date(a.timestampISO).getTime() - new Date(b.timestampISO).getTime();
        });

        const idToVirtualRow = new Map<string, number>();
        sortedForRows.forEach((e, idx) => {
            idToVirtualRow.set(e.id, idx);
        });

        // 为每条轨道分配颜色，避免相连的轨道颜色相同
        const trackColors = new Map<number, string>();
        const trackConnections = new Map<number, Set<number>>();
        for (let i = 0; i < tracks.length; i++) {
            trackConnections.set(i, new Set());
        }

        const idToTrackIndex = new Map<string, number>();
        tracks.forEach((track, index) => {
            track.forEach(id => idToTrackIndex.set(id, index));
        });

        editions.forEach(e => {
            if (e.parentEditionId && idToEdition.has(e.parentEditionId)) {
                const myTrack = idToTrackIndex.get(e.id);
                const parentTrack = idToTrackIndex.get(e.parentEditionId);
                if (myTrack !== undefined && parentTrack !== undefined && myTrack !== parentTrack) {
                    trackConnections.get(myTrack)?.add(parentTrack);
                    trackConnections.get(parentTrack)?.add(myTrack);
                }
            }
        });

        for (let i = 0; i < tracks.length; i++) {
            const usedColors = new Set<string>();
            trackConnections.get(i)?.forEach(neighbor => {
                if (trackColors.has(neighbor)) {
                    usedColors.add(trackColors.get(neighbor)!);
                }
            });

            let color = COLORS[i % COLORS.length]; // fallback
            for (const c of COLORS) {
                if (!usedColors.has(c)) {
                    color = c;
                    break;
                }
            }
            trackColors.set(i, color);
        }



// 3. 树状向上螺旋生长的布局
        const nodes: Map<string, ProcessedNode> = new Map();
        const baseWidth = 30; // 轨道之间的水平步长

        // 为每个轨道分配一个 X 位置
        const trackXIndex = new Map<number, number>();

        // 记录每个轨道活跃的行区间 [startRow, endRow]
        const trackRanges = new Map<number, { startRow: number; endRow: number }>();
        tracks.forEach((track, i) => {
            const rows = track.map(id => idToVirtualRow.get(id) || 0);
            let startRow = Math.min(...rows);
            const endRow = Math.max(...rows);

            // 轨道的起点其实是从父节点分支出来的那一刻，所以区间的起点要包含父节点的行号
            const firstId = track[0];
            const parentId = idToEdition.get(firstId)?.parentEditionId;
            if (parentId && idToVirtualRow.has(parentId)) {
                startRow = Math.min(startRow, idToVirtualRow.get(parentId)!);
            }
            trackRanges.set(i, { startRow, endRow });
        });

        // 按起点行号从小到大（从旧到新）的顺序分配轨道，这样新分支总是在父分支分配后处理
        const trackProcessingOrder = Array.from({ length: tracks.length }, (_, i) => i)
            .sort((a, b) => {
                const rangeA = trackRanges.get(a)!;
                const rangeB = trackRanges.get(b)!;
                if (rangeA.startRow !== rangeB.startRow) return rangeA.startRow - rangeB.startRow;
                return rangeA.endRow - rangeB.endRow;
            });

        // activeIntervals 记录每个 X 坐标上已经被占据的行区间列表
        const activeIntervals = new Map<number, Array<{ start: number; end: number }>>();

        const isOverlap = (s1: number, e1: number, s2: number, e2: number) => {
            return Math.max(s1, s2) <= Math.min(e1, e2);
        };

        const isLaneFree = (x: number, start: number, end: number) => {
            const intervals = activeIntervals.get(x);
            if (!intervals) return true;
            for (const interval of intervals) {
                if (isOverlap(start, end, interval.start, interval.end)) {
                    return false;
                }
            }
            return true;
        };

        const addInterval = (x: number, start: number, end: number) => {
            if (!activeIntervals.has(x)) activeIntervals.set(x, []);
            activeIntervals.get(x)!.push({ start, end });
        };

        // 动态移开占据空间的外部轨道，为新的子轨道腾出空间
        const shiftOuterLanes = (fromX: number, direction: 1 | -1, _startRow: number, _endRow: number) => {
            // 找出需要移动的 track
            const tracksToShift: number[] = [];
            for (const [trackIdx, trackX] of trackXIndex.entries()) {
                if (direction === 1 && trackX >= fromX) {
                    tracksToShift.push(trackIdx);
                } else if (direction === -1 && trackX <= fromX) {
                    tracksToShift.push(trackIdx);
                }
            }

            if (tracksToShift.length > 0) {
                // 清理旧的区间
                for (const trackIdx of tracksToShift) {
                    const oldX = trackXIndex.get(trackIdx)!;
                    const r = trackRanges.get(trackIdx)!;
                    const intervals = activeIntervals.get(oldX);
                    if (intervals) {
                        const index = intervals.findIndex(int => int.start === r.startRow && int.end === r.endRow);
                        if (index !== -1) intervals.splice(index, 1);
                    }
                }
                // 应用新的位置并重新写入区间
                for (const trackIdx of tracksToShift) {
                    const oldX = trackXIndex.get(trackIdx)!;
                    const newX = oldX + direction;
                    trackXIndex.set(trackIdx, newX);
                    const r = trackRanges.get(trackIdx)!;
                    addInterval(newX, r.startRow, r.endRow);
                }
            }
        };

        for (const i of trackProcessingOrder) {
            const range = trackRanges.get(i)!;

            if (i === 0) {
                trackXIndex.set(i, 0);
                addInterval(0, range.startRow, range.endRow);
                continue;
            }

            const startId = tracks[i][0];
            const parentId = idToEdition.get(startId)?.parentEditionId;

            let candidateX = 0;

            if (parentId && idToTrackIndex.has(parentId)) {
                const parentTrackIdx = idToTrackIndex.get(parentId)!;
                const parentXIndex = trackXIndex.get(parentTrackIdx) || 0;

                // 优先尝试直接继承父节点的位置（即保持完全垂直）
                // 只有当父节点的轨道在上方（或当前行）已经被别的连续分支占据时，才考虑左右散开
                if (isLaneFree(parentXIndex, range.startRow + 1, range.endRow) && isLaneFree(parentXIndex, range.startRow, range.startRow)) {
                     candidateX = parentXIndex;
                } else {
                    let candLeft = parentXIndex - 1;
                    let candRight = parentXIndex + 1;

                    const isLeftFree = isLaneFree(candLeft, range.startRow, range.endRow);
                    const isRightFree = isLaneFree(candRight, range.startRow, range.endRow);

                    if (isRightFree && isLaneFree(candRight, range.startRow, range.startRow)) {
                        candidateX = candRight;
                    } else if (isLeftFree && isLaneFree(candLeft, range.startRow, range.startRow)) {
                        candidateX = candLeft;
                    } else {
                        shiftOuterLanes(candRight, 1, range.startRow, range.endRow);
                        candidateX = candRight;
                    }
                }
            } else {
                let offset = 0;
                let found = false;
                while (!found) {
                    if (isLaneFree(offset, range.startRow, range.endRow)) {
                        candidateX = offset;
                        found = true;
                    } else if (offset > 0 && isLaneFree(-offset, range.startRow, range.endRow)) {
                        candidateX = -offset;
                        found = true;
                    }
                    offset++;
                }
            }

            trackXIndex.set(i, candidateX);
            addInterval(candidateX, range.startRow, range.endRow);
        }

        const center_X = width / 4; // 将图表偏左绘制，给右侧留出文本空间
        const start_Y = height - 40; // 根节点从底部开始

        // 我们计算所有节点的最大 xOffset，用于整体偏移修正，让右侧文字有足够空间
        const trackXOffsets = Array.from(trackXIndex.values());
        const minXOffset = Math.min(0, ...trackXOffsets);

        // 防止左侧越界，重新计算 base X
        const safeCenterX = Math.max(center_X, -minXOffset * baseWidth + 50);

        editions.forEach(e => {
             const depth = depths.get(e.id) || 0;
             const trackIdx = idToTrackIndex.get(e.id)!;
             const color = trackColors.get(trackIdx)!;

             const xOffset = trackXIndex.get(trackIdx) || 0;

             // X轴位置：基础位置 + 轨道偏移
             const x = safeCenterX + xOffset * baseWidth;

             // Y轴位置：从底部往上，每个节点独占一行
             const virtualRow = idToVirtualRow.get(e.id) || 0;
             const y = start_Y - virtualRow * layerHeight;

             const node: ProcessedNode = {
                 edition: e,
                 isHead: heads.has(e.id),
                 isCurrent: e.id === currentEditionId,
                 depth,
                 color,
                 x,
                 y,
                 trackIdx,
                 childrenIds: childrenMap.get(e.id) || []
             };
             nodes.set(e.id, node);
        });

        // 对 childrenIds 根据子节点的 X 坐标进行排序，方便渲染时计算发散的角度/偏移
        for (const node of nodes.values()) {
            if (node.childrenIds.length > 1) {
                node.childrenIds.sort((a, b) => {
                    const childA = nodes.get(a);
                    const childB = nodes.get(b);
                    return (childA?.x || 0) - (childB?.x || 0);
                });
            }
        }

        // 4. 生成连线
        const links: ProcessedLink[] = [];
        editions.forEach(e => {
            if (e.parentEditionId && nodes.has(e.parentEditionId)) {
                const source = nodes.get(e.parentEditionId)!;
                const target = nodes.get(e.id)!;
                // 使用目标节点的颜色作为连线颜色
                links.push({ source, target, color: target.color });
            }
        });

        const maxTrackXIndex = Math.max(0, ...trackXOffsets);
        const textStartX = safeCenterX + maxTrackXIndex * baseWidth + baseWidth * 1.5;
        const totalHeight = Math.max(0, editions.length - 1) * layerHeight;

        return {
            nodes: Array.from(nodes.values()),
            links,
            layerHeight,
            nodeRadius,
            textStartX,
            totalHeight,
            start_Y,
            width,
            height
        };
    }, [editions, concept, currentEditionId, containerWidth]);
}
