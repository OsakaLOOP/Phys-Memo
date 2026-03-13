import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { IConceptRoot, IEdition } from '../../attrstrand/types';
import { storage } from '../../attrstrand/storage';

interface ConceptNetworkViewProps {
    conceptId: string;
    currentEditionId?: string;
    onSelectEdition: (edition: IEdition) => void;
    onCreateBranch: (parentEdition: IEdition) => void;
}

interface ProcessedNode {
    edition: IEdition;
    isHead: boolean;
    isCurrent: boolean;
    depth: number; // 距离根的距离
    color: string;
    x: number;
    y: number;
    trackIdx: number;
}

interface ProcessedLink {
    source: ProcessedNode;
    target: ProcessedNode;
    color: string;
}

const COLORS = d3.schemeCategory10; // 颜色板

export const ConceptNetworkView: React.FC<ConceptNetworkViewProps> = ({
    conceptId,
    currentEditionId,
    onSelectEdition,
}) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [editions, setEditions] = useState<IEdition[]>([]);
    const [concept, setConcept] = useState<IConceptRoot | null>(null);

    useEffect(() => {
        const loadData = async () => {
            const c = await storage.getConcept(conceptId);
            setConcept(c);
            const e = await storage.getEditionsByConcept(conceptId);
            // 按照时间排序以构建层级
            e.sort((a, b) => new Date(a.timestampISO).getTime() - new Date(b.timestampISO).getTime());
            setEditions(e);
        };
        loadData();
    }, [conceptId]);

    useEffect(() => {
        if (!editions.length || !svgRef.current || !concept || !containerRef.current) return;

        const containerWidth = containerRef.current.clientWidth || 800;
        const width = containerWidth - 32; // padding
        const height = 600;
        const nodeRadius = 6;
        const layerHeight = 45; // 每层高度

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();

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

        // 寻找根节点 (可能没有 parentEditionId, 或者其 parentEditionId 不在当前列表里)
        const roots = editions.filter(e => !e.parentEditionId || !idToEdition.has(e.parentEditionId));

        const depths = new Map<string, number>();
        let maxDepth = 0;

        const assignDepth = (id: string, depth: number) => {
            depths.set(id, depth);
            maxDepth = Math.max(maxDepth, depth);
            const children = childrenMap.get(id) || [];
            children.forEach(childId => assignDepth(childId, depth + 1));
        };

        roots.forEach(root => assignDepth(root.id, 0));

        // 兜底深度：如果还有没遍历到的节点（可能形成了环，或者是孤立图但没被作为root选出）
        // 我们通过不断寻找没有父节点的节点作为临时 root 继续遍历
        while (depths.size < editions.length) {
            const unvisited = editions.filter(e => !depths.has(e.id));
            if (unvisited.length === 0) break;

            // 找一个 parentId 不在未访问列表中的节点（即它指向已访问节点或死链）作为起点
            const tempRoot = unvisited.find(e => !e.parentEditionId || !unvisited.find(u => u.id === e.parentEditionId)) || unvisited[0];

            // 计算它的临时深度，如果有指向已访问的 parent，则等于 parent + 1，否则等于最大深度 + 1（放在最上面）
            let newDepth = maxDepth + 1;
            if (tempRoot.parentEditionId && depths.has(tempRoot.parentEditionId)) {
                newDepth = depths.get(tempRoot.parentEditionId)! + 1;
            }
            assignDepth(tempRoot.id, newDepth);
        }

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
        const layerNodes = new Map<number, ProcessedNode[]>();

        // 为每个轨道分配一个 X 位置
        const trackXIndex = new Map<number, number>();

        // 防线重叠算法：记录每个父节点已被使用的出射斜率（dx / dy）
        // 因为每个节点Y坐标固定为 virtualRow * layerHeight
        // dx = (childXIndex - parentXIndex)
        // dy = (childRow - parentRow)
        // 斜率 slope = dx / dy
        const usedSlopesByParent = new Map<string, Set<number>>();

        trackXIndex.set(0, 0); // 第一条主干居中

        for (let i = 1; i < tracks.length; i++) {
            const trackStrand = tracks[i];
            const startId = trackStrand[0];
            const startEdition = idToEdition.get(startId)!;
            const parentId = startEdition.parentEditionId;

            let candidateX = 0;
            let found = false;

            // 如果有父节点，我们需要找一个不产生共线重叠的 X 偏移
            if (parentId && idToTrackIndex.has(parentId)) {
                const parentTrackIdx = idToTrackIndex.get(parentId)!;
                const parentXIndex = trackXIndex.get(parentTrackIdx) || 0;
                const parentRow = idToVirtualRow.get(parentId) || 0;
                const childRow = idToVirtualRow.get(startId) || 0;
                const dy = childRow - parentRow; // y 的距离差（以行数为单位）

                if (!usedSlopesByParent.has(parentId)) {
                    usedSlopesByParent.set(parentId, new Set());
                }
                const slopes = usedSlopesByParent.get(parentId)!;

                // 从 1 开始向两边找空位
                let offset = 1;
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
                let offset = 1;
                while (!found) {
                    if (!Array.from(trackXIndex.values()).includes(offset)) {
                        candidateX = offset;
                        found = true;
                    } else if (!Array.from(trackXIndex.values()).includes(-offset)) {
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

             if (!layerNodes.has(depth)) {
                 layerNodes.set(depth, []);
             }
             layerNodes.get(depth)!.push(node);
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

        // 5. D3 绘制
        const zoomLayer = svg.append("g");

        // 特殊处理跨轨道的连线：让它平滑弯曲
        const customLinkGenerator = (d: ProcessedLink) => {
            if (d.source.trackIdx === d.target.trackIdx) {
                return `M${d.source.x},${d.source.y} L${d.target.x},${d.target.y}`;
            } else {
                // 绘制贝塞尔曲线，在分支点平滑过渡
                return `M${d.source.x},${d.source.y} C${d.source.x},${d.source.y - layerHeight/2} ${d.target.x},${d.target.y + layerHeight/2} ${d.target.x},${d.target.y}`;
            }
        };

        zoomLayer.selectAll("path.link")
            .data(links)
            .join("path")
            .attr("class", "link")
            .attr("d", d => customLinkGenerator(d))
            .attr("fill", "none")
            .attr("stroke", d => d.color)
            .attr("stroke-width", 2.5)
            .attr("stroke-opacity", 0.8);

        // 节点组
        const nodeGroup = zoomLayer.selectAll("g.node")
            .data(Array.from(nodes.values()))
            .join("g")
            .attr("class", "node")
            .attr("transform", d => `translate(${d.x}, ${d.y})`)
            .attr("cursor", "pointer")
            .on("click", (_event, d) => onSelectEdition(d.edition));

        // 节点圆圈
        nodeGroup.append("circle")
            .attr("r", d => d.isCurrent ? nodeRadius + 1 : nodeRadius)
            .attr("fill", d => d.isHead ? "#fff" : d.color)
            .attr("stroke", d => d.color)
            .attr("stroke-width", d => d.isHead ? 3 : 2);

        // Current 标记
        nodeGroup.filter(d => d.isCurrent)
            .append("circle")
            .attr("r", nodeRadius + 5)
            .attr("fill", "none")
            .attr("stroke", d => d.color)
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", "2,2");

        // 头节点内部点
        nodeGroup.filter(d => d.isHead)
             .append("circle")
             .attr("r", 2)
             .attr("fill", d => d.color);

        // 计算文本偏移，所有文本统一对齐到某个 X 坐标，形成类似于 Git Log 的表格效果
        // 找到最右侧的轨道的 X 位置，再往右加偏移
        const maxTrackXIndex = Math.max(0, ...trackXOffsets);
        const textStartX = safeCenterX + maxTrackXIndex * baseWidth + baseWidth * 1.5;

        // Git 风格文本
        // 修改 translate，基于全局统一 X 的位置，而不是相对于节点自身
        const textGroup = nodeGroup.append("g")
            .attr("transform", d => `translate(${textStartX - d.x}, 4)`);

        textGroup.append("text")
            .attr("font-size", "12px")
            .attr("font-family", "monospace")
            .attr("font-weight", "500")
            .attr("fill", "#334155")
            // 加一个白色描边以便在复杂连线前更清晰
            .attr("stroke", "white")
            .attr("stroke-width", 2)
            .attr("stroke-linejoin", "round")
            .attr("paint-order", "stroke")
            .text(d => `${d.edition.saveType}: ${d.edition.creator}`);

        textGroup.append("text")
            .attr("x", 160) // 进一步向右
            .attr("font-size", "11px")
            .attr("fill", "#94a3b8")
            .text(d => new Date(d.edition.timestampISO).toLocaleString(undefined, {
                 month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            }));

        // 节点 ID (短)
        textGroup.append("text")
             .attr("x", 320)
             .attr("font-size", "10px")
             .attr("font-family", "monospace")
             .attr("fill", "#cbd5e1")
             .text(d => d.edition.id.slice(0, 7));

        // 悬浮交互：节点背景高亮
        const highlightBg = zoomLayer.insert("g", ":first-child").attr("class", "highlight-layer");

        nodeGroup.on("mouseenter", function(_event, d) {
             d3.select(this).select("circle").attr("stroke-width", 4);

             // 添加整行高亮
             highlightBg.append("rect")
                 .attr("class", "row-hover")
                 .attr("x", 0)
                 .attr("y", d.y - layerHeight / 2)
                 .attr("width", width)
                 .attr("height", layerHeight)
                 .attr("fill", "rgba(0,0,0,0.03)")
                 .attr("pointer-events", "none");
        })
        .on("mouseleave", function(_event, d) {
             d3.select(this).select("circle").attr("stroke-width", d.isHead ? 3 : 2);
             highlightBg.selectAll(".row-hover").remove();
        });

        // 缩放平移
        const zoom = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.5, 3])
            .on("zoom", (event) => {
                zoomLayer.attr("transform", event.transform);
            });

        svg.call(zoom);

        // 计算整体边界，初始化平移使最新节点（顶部）可见
        // 根在 y = start_Y, 最新在 y = start_Y - (editions.length - 1) * layerHeight
        const totalHeight = Math.max(0, editions.length - 1) * layerHeight;
        const topY = start_Y - totalHeight - 50; // padding

        // 移动到顶部可见，或者根据 currentEditionId 定位
        const currentY = currentEditionId && nodes.has(currentEditionId) ? nodes.get(currentEditionId)!.y : topY;

        // 使 current 居中
        const initialTransform = d3.zoomIdentity.translate(0, height / 2 - currentY).scale(1);
        svg.call(zoom.transform, initialTransform);

    }, [editions, concept, currentEditionId]);


    return (
        <div className="border rounded bg-slate-50 p-4 relative overflow-hidden" ref={containerRef}>
            <div className="mb-4 flex justify-between items-center z-10 relative">
                <h3 className="font-bold text-sm text-slate-700">分支追溯视图 / Branch History</h3>
                <div className="text-xs text-slate-500 flex items-center">
                    <span className="inline-block w-3 h-3 rounded-full border-[3px] border-indigo-500 mr-1 bg-white flex items-center justify-center">
                        <span className="w-1 h-1 bg-indigo-500 rounded-full"></span>
                    </span>
                    <span className="mr-3">分支端点 (Head)</span>
                    <span className="inline-block w-3 h-3 rounded-full border-[2px] border-slate-500 border-dashed mr-1"></span>
                    <span>当前 (Current)</span>
                </div>
            </div>
            <div className="border rounded shadow-inner bg-white overflow-hidden" style={{ height: '600px' }}>
                <svg ref={svgRef} width="100%" height="100%" className="cursor-grab active:cursor-grabbing" />
            </div>
        </div>
    );
};
