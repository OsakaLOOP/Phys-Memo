import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { IEdition, IPopulatedEdition } from '../../attrstrand/types';
import { useNetworkStore } from '../../store/networkStore';
import { useNetworkLayout } from './hooks/useNetworkLayout';
import type { ProcessedLink } from './hooks/useNetworkLayout';
import { CopyrightTooltip } from './CopyrightTooltip';
import { core } from '../../attrstrand/core';

interface ConceptNetworkViewProps {
    conceptId: string;
    currentEditionId?: string;
    onSelectEdition: (edition: IEdition) => void;
    onCreateBranch: (parentEdition: IEdition) => void;
}

export const ConceptNetworkView: React.FC<ConceptNetworkViewProps> = ({
    conceptId,
    currentEditionId,
    onSelectEdition,
}) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(800);
    const [hoveredEditionId, setHoveredEditionId] = useState<string | null>(null);
    const [hoverPos, setHoverPos] = useState<{ x: number, y: number } | null>(null);
    const [populatedEditionsCache, setPopulatedEditionsCache] = useState<Record<string, IPopulatedEdition>>({});
    const [isFetchingHovered, setIsFetchingHovered] = useState(false);

    const { editions, concept, fetchData, isLoading } = useNetworkStore();

    useEffect(() => {
        fetchData(conceptId);
    }, [conceptId, fetchData]);

    useEffect(() => {
        if (!containerRef.current) return;
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                if (entry.contentRect.width > 0) {
                     setContainerWidth(entry.contentRect.width);
                }
            }
        });
        resizeObserver.observe(containerRef.current);
        // 初始化宽度
        if (containerRef.current.clientWidth > 0) {
            setContainerWidth(containerRef.current.clientWidth);
        }
        return () => resizeObserver.disconnect();
    }, []);

    const layout = useNetworkLayout(editions, concept, currentEditionId, containerWidth);

    useEffect(() => {
        if (!layout || !svgRef.current) return;

        const {
            nodes,
            links,
            layerHeight,
            nodeRadius,
            textStartX,
            totalHeight,
            start_Y,
            width,
            height
        } = layout;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();

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
        // 待修改.

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
            .data(nodes)
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

        // Git 风格文本
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
             .attr("fill", d => d.color)
             .text(d => d.edition.id.slice(0, 7));

        // 悬浮交互：节点背景高亮
        const highlightBg = zoomLayer.insert("g", ":first-child").attr("class", "highlight-layer");

        nodeGroup.on("mouseenter", function(event, d) {
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

             // 触发 tooltip 显示
             const [mx, my] = d3.pointer(event, containerRef.current);
             setHoverPos({ x: mx + 10, y: my + 10 });
             setHoveredEditionId(d.edition.id);
        })
        .on("mousemove", function(event) {
             const [mx, my] = d3.pointer(event, containerRef.current);
             setHoverPos({ x: mx + 10, y: my + 10 });
        })
        .on("mouseleave", function(_event, d) {
             d3.select(this).select("circle").attr("stroke-width", d.isHead ? 3 : 2);
             highlightBg.selectAll(".row-hover").remove();

             setHoveredEditionId(null);
             setHoverPos(null);
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
        const topY = start_Y - totalHeight - 50; // padding

        // 移动到顶部可见，或者根据 currentEditionId 定位
        const currentNode = nodes.find(n => n.isCurrent);
        const currentY = currentNode ? currentNode.y : topY;

        // 使 current 居中
        const initialTransform = d3.zoomIdentity.translate(0, height / 2 - currentY).scale(1);
        svg.call(zoom.transform, initialTransform);

    }, [layout, currentEditionId]);

    // 加载 Hover 的 Edition 详细数据
    useEffect(() => {
        if (hoveredEditionId && !populatedEditionsCache[hoveredEditionId]) {
            setIsFetchingHovered(true);
            core.getPopulatedEdition(hoveredEditionId).then(populated => {
                if (populated) {
                    setPopulatedEditionsCache(prev => ({ ...prev, [hoveredEditionId]: populated }));
                }
                setIsFetchingHovered(false);
            }).catch(err => {
                console.error("Failed to load populated edition for tooltip", err);
                setIsFetchingHovered(false);
            });
        }
    }, [hoveredEditionId, populatedEditionsCache]);

    const renderTooltip = () => {
        if (!hoveredEditionId || !hoverPos) return null;

        const populated = populatedEditionsCache[hoveredEditionId];
        let tooltipContent;

        if (!populated || isFetchingHovered) {
            tooltipContent = (
                <CopyrightTooltip
                    authors={[]}
                    diffAdded={0}
                    diffDeleted={0}
                    diffRetained={0}
                    itemId={hoveredEditionId}
                    isLoading={true}
                />
            );
        } else {
            const attr = populated.editionAttr || { 'user': 1 };
            const authors = Object.entries(attr);
            const n = authors.length;
            const adjustedAuthors = authors.map(([author, share]) => {
                const adjustedShare = (Number(share) + (n > 0 ? (0.1 / n) : 0)) / 1.1;
                return { author, share: adjustedShare };
            }).sort((a, b) => b.share - a.share);

            tooltipContent = (
                <CopyrightTooltip
                    authors={adjustedAuthors}
                    diffAdded={populated.editionDiffAdded || 0}
                    diffDeleted={populated.editionDiffDeleted || 0}
                    diffRetained={populated.editionDiffRetained || 0}
                    itemId={hoveredEditionId}
                />
            );
        }

        return (
            <div
                style={{
                    position: 'absolute',
                    left: hoverPos.x,
                    top: hoverPos.y,
                    zIndex: 100,
                    pointerEvents: 'none'
                }}
            >
                {tooltipContent}
            </div>
        );
    };

    return (
        <div className="border rounded bg-slate-50 p-4 relative overflow-hidden" ref={containerRef}>
            {renderTooltip()}
            <div className="mb-4 flex justify-between items-center z-10 relative">
                <h3 className="font-bold text-sm text-slate-700">分支追溯视图 / Branch History</h3>
                <div className="text-xs text-slate-500 flex items-center">
                    <span className="inline-block w-3 h-3 rounded-full border-[3px] border-indigo-500 mr-1 bg-white flex items-center justify-center">
                        <span className="w-1 h-1 bg-indigo-500 rounded-full"></span>
                    </span>
                    <span className="mr-3">分支端点 (Head)</span>
                    <span className="inline-block w-3 h-3 rounded-full border-[2px] border-slate-500 border-dashed mr-1"></span>
                    <span>当前 (Current)</span>
                    {isLoading && <span className="ml-3 text-indigo-500">Loading...</span>}
                </div>
            </div>
            <div className="border rounded shadow-inner bg-white overflow-hidden" style={{ height: '600px' }}>
                <svg ref={svgRef} width="100%" height="100%" className="cursor-grab active:cursor-grabbing" />
            </div>
        </div>
    );
};
