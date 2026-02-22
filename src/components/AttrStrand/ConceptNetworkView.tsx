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

interface GraphNode extends d3.SimulationNodeDatum {
    id: string;
    edition: IEdition;
    isHead: boolean;
    isCurrent: boolean;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
    source: string | GraphNode;
    target: string | GraphNode;
}

export const ConceptNetworkView: React.FC<ConceptNetworkViewProps> = ({
    conceptId,
    currentEditionId,
    onSelectEdition,
    // onCreateBranch
}) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [editions, setEditions] = useState<IEdition[]>([]);
    const [concept, setConcept] = useState<IConceptRoot | null>(null);

    useEffect(() => {
        const loadData = async () => {
            const c = await storage.getConcept(conceptId);
            setConcept(c);
            const e = await storage.getEditionsByConcept(conceptId);
            // Sort by creation time to help layout
            e.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            setEditions(e);
        };
        loadData();
    }, [conceptId]);

    useEffect(() => {
        if (!editions.length || !svgRef.current || !concept) return;

        const width = 800;
        const height = 400;
        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();

        // 1. Prepare Data
        const heads = new Set(Object.keys(concept.currentHeads));
        const nodes: GraphNode[] = editions.map(e => ({
            id: e.id,
            edition: e,
            isHead: heads.has(e.id),
            isCurrent: e.id === currentEditionId,
            x: width / 2,
            y: height / 2
        }));

        const links: GraphLink[] = [];
        editions.forEach(e => {
            if (e.parentEditionId) {
                // Verify parent exists in our list
                if (nodes.find(n => n.id === e.parentEditionId)) {
                    links.push({
                        source: e.parentEditionId,
                        target: e.id
                    });
                }
            }
        });

        // 2. Simulation
        // Force Y based on time?
        // const timeScale = d3.scaleTime()
        //     .domain(d3.extent(editions, e => new Date(e.createdAt)) as [Date, Date])
        //     .range([50, width - 50]);

        const simulation = d3.forceSimulation<GraphNode>(nodes)
            .force("link", d3.forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance(50))
            .force("charge", d3.forceManyBody().strength(-200))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collide", d3.forceCollide(30))
            // .force("x", d3.forceX((d: any) => timeScale(new Date(d.edition.createdAt))).strength(0.5))
            // .force("y", d3.forceY(height/2).strength(0.1));

        // 3. Render
        const link = svg.append("g")
            .attr("stroke", "#999")
            .attr("stroke-opacity", 0.6)
            .selectAll("line")
            .data(links)
            .join("line")
            .attr("marker-end", "url(#arrowhead)");

        // Arrowhead definition
        svg.append("defs").append("marker")
            .attr("id", "arrowhead")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 20) // Shift back so it doesn't overlap node center too much
            .attr("refY", 0)
            .attr("markerWidth", 6)
            .attr("markerHeight", 6)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M0,-5L10,0L0,5")
            .attr("fill", "#999");

        const node = svg.append("g")
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5)
            .selectAll("circle")
            .data(nodes)
            .join("circle")
            .attr("r", d => d.isCurrent ? 12 : (d.isHead ? 8 : 5))
            .attr("fill", d => d.isCurrent ? "#6366f1" : (d.isHead ? "#10b981" : "#94a3b8"))
            .attr("cursor", "pointer")
            .on("click", (_event, d) => onSelectEdition(d.edition))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .call(d3.drag<SVGCircleElement, GraphNode>()
                .on("start", (event) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    event.subject.fx = event.subject.x;
                    event.subject.fy = event.subject.y;
                })
                .on("drag", (event) => {
                    event.subject.fx = event.x;
                    event.subject.fy = event.y;
                })
                .on("end", (event) => {
                    if (!event.active) simulation.alphaTarget(0);
                    event.subject.fx = null;
                    event.subject.fy = null;
                }) as any
            );

        node.append("title")
            .text(d => `${d.edition.creator} (${new Date(d.edition.createdAt).toLocaleTimeString()})`);

        // Labels for heads
        const labels = svg.append("g")
            .selectAll("text")
            .data(nodes.filter(n => n.isHead))
            .join("text")
            .attr("dx", 12)
            .attr("dy", 4)
            .text(d => d.edition.creator)
            .attr("font-size", "10px")
            .attr("fill", "#333");

        simulation.on("tick", () => {
            link
                .attr("x1", (d: any) => d.source.x)
                .attr("y1", (d: any) => d.source.y)
                .attr("x2", (d: any) => d.target.x)
                .attr("y2", (d: any) => d.target.y);

            node
                .attr("cx", (d: any) => d.x)
                .attr("cy", (d: any) => d.y);

            labels
                .attr("x", (d: any) => d.x)
                .attr("y", (d: any) => d.y);
        });

        // Cleanup
        return () => {
            simulation.stop();
        };

    }, [editions, concept, currentEditionId]);


    return (
        <div className="border rounded bg-slate-50 p-4">
            <div className="mb-2 flex justify-between items-center">
                <h3 className="font-bold text-sm text-slate-700">Edition History</h3>
                <div className="text-xs text-slate-500">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1"></span>Head
                    <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 mx-2 mr-1"></span>Current
                </div>
            </div>
            <svg ref={svgRef} width="800" height="400" className="w-full h-auto bg-white border rounded shadow-inner" />
            <div className="mt-2 text-xs text-slate-500 flex justify-end gap-2">
                <button
                    className="px-3 py-1 bg-white border rounded hover:bg-slate-50 shadow-sm"
                    onClick={() => {
                        // Ideally we pass the selected edition
                        // Here assuming parent tracks selection via onSelectEdition
                        // But we need a button to TRIGGER creation
                        // Maybe this button shouldn't be here, but inside the parent UI context?
                        // Yes.
                    }}
                >
                    Create Branch from Selected
                </button>
            </div>
        </div>
    );
};
