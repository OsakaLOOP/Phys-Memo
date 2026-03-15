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

        // 防线重叠算法：记录每个父节点已被使用的出射斜率（dx / dy）
        // 因为每个节点Y坐标固定为 virtualRow * layerHeight
        // dx = (childXIndex - parentXIndex)
        // dy = (childRow - parentRow)
        // 斜率 slope = dx / dy
        const usedSlopesByParent = new Map<string, Set<number>>();

        // 为了让子节点计算斜率时，父节点的 X 已经被分配，需要按照轨道的起始节点的深度/行号来排序处理
        const trackProcessingOrder = Array.from({ length: tracks.length }, (_, i) => i)
            .sort((a, b) => {
                const trackA = tracks[a];
                const trackB = tracks[b];
                const rowA = idToVirtualRow.get(trackA[0]) || 0;
                const rowB = idToVirtualRow.get(trackB[0]) || 0;
                return rowA - rowB;
            });

        for (const i of trackProcessingOrder) {
            // 第一个轨道（深度最浅/主干）固定在中间
            if (i === 0 && trackXIndex.size === 0) {
                trackXIndex.set(i, 0);
                continue;
            }

            const trackStrand = tracks[i];
            const startId = trackStrand[0];
            const startEdition = idToEdition.get(startId)!;
            const parentId = startEdition.parentEditionId;

            let candidateX = 0;
            let found = false;

            // 如果有父节点，我们需要找一个不产生共线重叠的 X 偏移
            if (parentId && idToTrackIndex.has(parentId)) {
                const parentTrackIdx = idToTrackIndex.get(parentId)!;
                // 如果因为某种原因父节点还没有分配，默认0（排序后一般不会出现）
                const parentXIndex = trackXIndex.has(parentTrackIdx) ? trackXIndex.get(parentTrackIdx)! : 0;
                const parentRow = idToVirtualRow.get(parentId) || 0;
                const childRow = idToVirtualRow.get(startId) || 0;
                const dy = childRow - parentRow; // y 的距离差（以行数为单位）

                if (!usedSlopesByParent.has(parentId)) {
                    usedSlopesByParent.set(parentId, new Set());
                }
                const slopes = usedSlopesByParent.get(parentId)!;

                // 先尝试竖直, 然后左右交替.
                let offset = 0;
                while (!found) {
                    // 尝试右边
                    const dxRight = parentXIndex + offset - parentXIndex;
                    const slopeRight = dxRight / dy;
                    if (!slopes.has(slopeRight) && !Array.from(trackXIndex.values()).includes(parentXIndex + offset)) {
                        candidateX = parentXIndex + offset;
                        slopes.add(slopeRight);
                        found = true;
                        break;
                    }

                    // 尝试左边
                    const dxLeft = parentXIndex - offset - parentXIndex;
                    const slopeLeft = dxLeft / dy;
                    if (!slopes.has(slopeLeft) && !Array.from(trackXIndex.values()).includes(parentXIndex - offset)) {
                        candidateX = parentXIndex - offset;
                        slopes.add(slopeLeft);
                        found = true;
                        break;
                    }
                    offset++;
                }
            } else {
                // 如果没有父节点（或者父节点不在列表内），退化为寻找全局未使用的空位
                let offset = 0;
                while (!found) {
                    if (!Array.from(trackXIndex.values()).includes(offset)) {
                        candidateX = offset;
                        found = true;
                    } else if (offset > 0 && !Array.from(trackXIndex.values()).includes(-offset)) {
                        candidateX = -offset;
                        found = true;
                    }
                    offset++;
                }
            }

            trackXIndex.set(i, candidateX);
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
                 trackIdx
             };
             nodes.set(e.id, node);
        });

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
