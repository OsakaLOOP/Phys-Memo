import {
  useState, useEffect, useRef, useMemo,
  type FC, type ChangeEvent, type MouseEvent
} from 'react';

import { 
  ArrowRight, Maximize, Crop, 
  Database, GitCommit, X, FileText, Hash, Layers,
  Network, Book, Download, Upload, Plus, Trash2, Search, Tag,
  ChevronRight, ChevronDown, Folder, FolderOpen
} from 'lucide-react';

import * as d3 from 'd3';
import 'katex/dist/katex.min.css';

import RichTextRenderer from './components/RichTextRenderer';
import EditableBlock from './components/EditableBlock';
// import SmartFormulaBlock from './components/SmartFormulaBlock';

// AttrStrand Imports
import { core } from './attrstrand/core';
import { storage } from './attrstrand/storage';
import type { IEdition, IPopulatedEdition } from './attrstrand/types';
import { AtomListEditor } from './components/AttrStrand/AtomListEditor';
import { ConceptNetworkView } from './components/AttrStrand/ConceptNetworkView';
import { TopicChildCard } from './components/AttrStrand/TopicChildCard';
import { useStore } from 'zustand';
import { useWorkspaceStore, useGlobalStore, workspaceActions } from './store/workspaceStore';

// --- Type Definitions ---
interface NodeData {
  id: string;
  disciplines: string[]; // 核心学科：流体力学、颗粒物理等
  topic: string; // 研究主题（可跨多学科）：颗粒流、湍流等
  title: string;
  type:  'LAW' | 'FORMULA' | 'MODEL' | 'PAPER' | 'EVIDENCE' | 'TOPIC';
  latex: string;
  desc: string;
  references: string;
  constraints: string[];
  relations: Relation[];
}

interface Relation {
  targetId: string;
  type: 'DERIVES_FROM' | 'SPECIAL_CASE' | 'EMPIRICAL_FIT' | 'CONTRADICTS' | 'MODIFIES' | 'EXPLAINS';
  condition: string;
}

interface NodeTypeConfig {
  label: string;
  color: string;
  nodeColor: string;
}

interface DisciplineData {
  name: string; // unique key (e.g. '流体力学')
  abbr: string; // e.g. '流体' (1-3 chars)
  color: string; // hex
  hue: number; // for graph
}

interface D3Node extends NodeData {
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface D3Link {
  source: string | D3Node;
  target: string | D3Node;
  type: string;
  condition: string;
}

interface GraphData {
  nodes: D3Node[];
  links: D3Link[];
}

// --- Global Constants ---

const NODE_TYPES: Record<string, NodeTypeConfig> = {
  LAW: { label: '定律 (Law)', color: 'bg-blue-50 text-blue-700 border-blue-200', nodeColor: '#3b82f6' },
  FORMULA: { label: '公式 (Formula)', color: 'bg-purple-50 text-purple-700 border-purple-200', nodeColor: '#a855f7' },
  MODEL: { label: '模型 (Model)', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', nodeColor: '#10b981' },
  PAPER: { label: '文献 (Paper)', color: 'bg-slate-100 text-slate-700 border-slate-200', nodeColor: '#64748b' },
  EVIDENCE: { label: '证据/反例 (Evidence)', color: 'bg-rose-50 text-rose-700 border-rose-200', nodeColor: '#f43f5e' },
  TOPIC: { label: '主题 (Topic)', color: 'bg-amber-50 text-amber-700 border-amber-200', nodeColor: '#f59e0b' },
};

// 节点类型 -> 形状映射
const NODE_SHAPE_MAP: Record<string, string> = {
  FORMULA: 'circle',      // 圆形
  LAW: 'rect',            // 矩形
  MODEL: 'polygon',       // 多边形
  PAPER: 'diamond',       // 菱形
  EVIDENCE: 'star',       // 星形
  TOPIC: 'rect',          // 矩形 (Root Node)
};

// Topic 颜色映射（基于 HSL 空间）
const TOPIC_COLORS: Record<string, string> = {
  '颗粒流': '#f59e0b',          // amber
  '流体流动': '#3b82f6',         // blue
  '颗粒流堵塞': '#ef4444',       // red
  '未分类': '#cbd5e1',           // slate
};

import { RELATION_TYPES } from './constants';

// --- IndexedDB Helper Class ---

const DB_NAME = 'PhysMemosDB_v6';
const STORE_NAME = 'nodes';
const DB_VERSION = 2;

interface IDBHelper {
  open: () => Promise<IDBDatabase>;
  getAll: () => Promise<NodeData[]>;
  put: (item: NodeData) => Promise<IDBValidKey>;
  delete: (id: string) => Promise<void>;
  getAllDisciplines: () => Promise<DisciplineData[]>;
  putDiscipline: (item: DisciplineData) => Promise<IDBValidKey>;
  deleteDiscipline: (name: string) => Promise<void>;
}

const dbHelper: IDBHelper = {
  open: () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('disciplines')) {
          db.createObjectStore('disciplines', { keyPath: 'name' });
        }
      };
    });
  },
  getAll: async () => {
    const db = await dbHelper.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  put: async (item: NodeData) => {
    const db = await dbHelper.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(item);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  delete: async (id: string) => {
    const db = await dbHelper.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },
  getAllDisciplines: async () => {
    const db = await dbHelper.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('disciplines', 'readonly');
      const store = transaction.objectStore('disciplines');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  putDiscipline: async (item: DisciplineData) => {
    const db = await dbHelper.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('disciplines', 'readwrite');
      const store = transaction.objectStore('disciplines');
      const request = store.put(item);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  deleteDiscipline: async (name: string) => {
    const db = await dbHelper.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('disciplines', 'readwrite');
      const store = transaction.objectStore('disciplines');
      const request = store.delete(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
};

// --- D3 Graph Component ---

interface KnowledgeGraphProps {
  nodes: NodeData[];
  disciplinesMap: Record<string, DisciplineData>;
  activeNodeId: string | null;
  onNodeClick: (id: string) => void;
}

interface HoveredNodeState extends NodeData {
  x?: number;
  y?: number;
}

const KnowledgeGraph: FC<KnowledgeGraphProps> = ({ nodes, disciplinesMap, onNodeClick }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<HoveredNodeState | null>(null);
  const [legendPaths, setLegendPaths] = useState<Record<string, string>>({});

  // Convert data to D3 format
  const graphData = useMemo((): GraphData => {
    // Filter out TOPIC nodes as they shouldn't appear in the graph
    const d3Nodes: D3Node[] = nodes
      .filter(n => n.type !== 'TOPIC')
      .map(n => ({ ...n }));

    // Create a set of valid node IDs for fast lookup
    const validNodeIds = new Set(d3Nodes.map(n => n.id));

    const d3Links: D3Link[] = [];
    nodes.forEach(source => {
      // Only process links from valid nodes
      if (validNodeIds.has(source.id) && source.relations) {
        source.relations.forEach(rel => {
          // Only add links to valid nodes
          if (validNodeIds.has(rel.targetId)) {
            d3Links.push({
              source: source.id,
              target: rel.targetId,
              type: rel.type,
              condition: rel.condition
            });
          }
        });
      }
    });
    return { nodes: d3Nodes, links: d3Links };
  }, [nodes]);

  useEffect(() => {
    if (!svgRef.current) return;

    // Clear old chart
    d3.select(svgRef.current).selectAll("*").remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const svg = d3.select(svgRef.current)
      .attr("viewBox", [0, 0, width, height]);

    // Define arrow marker
    svg.append("defs").selectAll("marker")
      .data(["end"])
      .join("marker")
      .attr("id", (d: string) => `arrow-${d}`)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 25)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("fill", "#94a3b8")
      .attr("d", "M0,-5L10,0L0,5");

    // Force simulation
    const simulation = d3.forceSimulation<D3Node>(graphData.nodes)
      .force("link", d3.forceLink<D3Node, D3Link>(graphData.links).id((d) => d.id).distance(150))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(40));

    // 绘制动态背景学科区域（贝塞尔曲线多边形 Venn图）
    const disciplines = new Set<string>();
    graphData.nodes.forEach(n => (n.disciplines || []).forEach(d => disciplines.add(d)));
    
    const disciplineGroups: Record<string, D3Node[]> = {};
    disciplines.forEach(d => {
      disciplineGroups[d] = graphData.nodes.filter(n => (n.disciplines || []).includes(d));
    });

    // 凸包计算函数
    const computeConvexHull = (points: [number, number][]): [number, number][] => {
      if (points.length < 3) return points;
      // 使用 D3 的 polygonHull
      const hull = d3.polygonHull(points);
      return hull || points;
    };

    // 生成平滑的贝塞尔曲线路径（确保凸性和圆角）
    const generateBezierPath = (nodes: D3Node[], padding: number = 60): string => {
      const points = nodes
        .filter(n => n.x !== undefined && n.y !== undefined)
        .map(n => [n.x!, n.y!] as [number, number]);

      if (points.length === 0) return "";
      if (points.length === 1) {
        // 单个节点：生成完美圆形
        const [x, y] = points[0];
        const steps = 32;
        const circlePoints: [number, number][] = [];
        for (let i = 0; i < steps; i++) {
          const angle = (i / steps) * Math.PI * 2;
          circlePoints.push([x + padding * Math.cos(angle), y + padding * Math.sin(angle)]);
        }
        return d3.line().curve(d3.curveBasisClosed)(circlePoints) || "";
      }

      if (points.length === 2) {
        // 两个节点：生成椭圆/胶囊形
        const [p1, p2] = points;
        const cx = (p1[0] + p2[0]) / 2;
        const cy = (p1[1] + p2[1]) / 2;
        const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        const angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);

        const steps = 32;
        const ellipsePoints: [number, number][] = [];
        const a = dist / 2 + padding; // 长半轴
        const b = padding;            // 短半轴

        for (let i = 0; i < steps; i++) {
          const t = (i / steps) * Math.PI * 2;
          // 标准椭圆方程
          const x0 = a * Math.cos(t);
          const y0 = b * Math.sin(t);
          // 旋转和平移
          const x = cx + x0 * Math.cos(angle) - y0 * Math.sin(angle);
          const y = cy + x0 * Math.sin(angle) + y0 * Math.cos(angle);
          ellipsePoints.push([x, y]);
        }
        return d3.line().curve(d3.curveBasisClosed)(ellipsePoints) || "";
      }

      // 多个节点：计算凸包并扩展
      const hull = computeConvexHull(points);
      if (!hull || hull.length < 2) return "";

      // 计算凸包的中心
      const centerX = hull.reduce((sum, p) => sum + p[0], 0) / hull.length;
      const centerY = hull.reduce((sum, p) => sum + p[1], 0) / hull.length;

      // 向外扩展凸包点（确保凸性）
      const expandedHull = hull.map(p => {
        const dx = p[0] - centerX;
        const dy = p[1] - centerY;
        const dist = Math.hypot(dx, dy);
        const scale = dist > 0 ? 1 + padding / dist : 1;
        return [centerX + dx * scale, centerY + dy * scale] as [number, number];
      });

      // 沿着凸包边缘插入更多点以获得更平滑的圆角
      // 并确保内部角度不小于 minAngleDeg（例如 40 度）
      const minAngleDeg = 40;
      const minAngleRad = (minAngleDeg * Math.PI) / 180;

      // 计算每个顶点的内角
      const angles: number[] = [];
      for (let i = 0; i < expandedHull.length; i++) {
        const prev = expandedHull[(i - 1 + expandedHull.length) % expandedHull.length];
        const curr = expandedHull[i];
        const next = expandedHull[(i + 1) % expandedHull.length];
        const v1 = [prev[0] - curr[0], prev[1] - curr[1]];
        const v2 = [next[0] - curr[0], next[1] - curr[1]];
        const dot = v1[0] * v2[0] + v1[1] * v2[1];
        const mag1 = Math.hypot(v1[0], v1[1]);
        const mag2 = Math.hypot(v2[0], v2[1]);
        let ang = 0;
        if (mag1 > 0 && mag2 > 0) {
          const cosv = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
          ang = Math.acos(cosv);
        }
        angles.push(ang);
      }

      const smoothedHull: [number, number][] = [];
      const baseInsert = 2;
      const extraInsert = 4;
      for (let i = 0; i < expandedHull.length; i++) {
        const current = expandedHull[i];
        const next = expandedHull[(i + 1) % expandedHull.length];
        // 如果当前或下一个顶点的内角小于最小角度，则增加插值点数量
        let inserts = baseInsert;
        if (angles[i] < minAngleRad || angles[(i + 1) % expandedHull.length] < minAngleRad) {
          inserts += extraInsert;
        }
        smoothedHull.push(current); 
        for (let j = 1; j <= inserts; j++) {
          const t = j / (inserts + 1);
          const x = current[0] + (next[0] - current[0]) * t;
          const y = current[1] + (next[1] - current[1]) * t;
          smoothedHull.push([x, y] as [number, number]);
        }
      }

      // 使用 B-spline 曲线生成最平滑的贝塞尔曲线（确保圆角）
      // curveBasisClosed 提供更平滑的圆角效果
      const pathData = d3.line()
        .curve(d3.curveBasisClosed)(smoothedHull);

      return pathData || "";
    };

    const bgLayer = svg.append("g").attr("class", "discipline-background");

    // 为每个学科创建路径和标签
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const disciplinePaths: Record<string, any> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const disciplineLabels: Record<string, any> = {};
    const labelPhysics: Record<string, { x: number; y: number; vx: number; vy: number }> = {};

    Array.from(disciplines).forEach(discipline => {
      const color = disciplinesMap[discipline]?.color || '#cbd5e1';
      
      // Initialize physics state
      labelPhysics[discipline] = { x: width / 2, y: height / 2, vx: 0, vy: 0 };

      // 创建路径
      disciplinePaths[discipline] = bgLayer.append("path")
        .attr("id", `path-${discipline}`)
        .attr("fill", color)
        .attr("opacity", 0.08)
        .attr("stroke", color)
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "4,4")
        .attr("stroke-opacity", 0.2)
        .attr("d", "");

      // 创建标签
      disciplineLabels[discipline] = bgLayer.append("text")
        .attr("id", `label-${discipline}`)
        .attr("fill", color)
        .attr("opacity", 0.3)
        .attr("font-size", 12)
        .attr("font-weight", "bold")
        .attr("text-anchor", "middle")
        .attr("pointer-events", "none")
        .text(disciplinesMap[discipline]?.name || discipline);
    });


    // 绘制连线（在节点后面）
    const link = svg.append("g")
      .selectAll("line")
      .data(graphData.links)
      .join("line")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrow-end)");

    // Draw link labels
    const linkLabel = svg.append("g")
      .selectAll("text")
      .data(graphData.links)
      .join("text")
      .text((d: D3Link) => RELATION_TYPES[d.type]?.icon || '')
      .attr("font-size", 10)
      .attr("fill", "#64748b")
      .attr("text-anchor", "middle")
      .attr("dy", -3);

    // Draw nodes
    const node = svg.append("g")
      .selectAll("g")
      .data(graphData.nodes)
      .join("g")
      .call(d3.drag<SVGGElement, D3Node>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended) as any);

    // 为不同形状的节点创建符号生成器
    const symbolType = (d: D3Node) => {
      const shape = NODE_SHAPE_MAP[d.type] || 'circle';
      switch (shape) {
        case 'rect': return d3.symbolSquare;
        case 'polygon': return d3.symbolTriangle;
        case 'diamond': return d3.symbolDiamond;
        case 'star': return d3.symbolStar;
        default: return d3.symbolCircle;
      }
    };

    // 节点形状 - topic 填充色，type 边框色
    const typeColor = (d: D3Node) => NODE_TYPES[d.type]?.nodeColor || '#91a3b0';

    // Bottom Layer: Outline (Type Color) - Thicker
    node.append("path")
      .attr("class", "node-outline")
      .attr("d", (d: D3Node) => d3.symbol(symbolType(d), 310)() || "")
      .attr("fill", "none")
      .attr("stroke", typeColor)
      .attr("stroke-width", 2.5)
      .attr("cursor", "pointer");

    // Top Layer: Fill (Topic Color) + White Inner Stroke
    node.append("path")
      .attr("class", "node-fill")
      .attr("d", (d: D3Node) => d3.symbol(symbolType(d), 300)() || "")
      .attr("fill", (d: D3Node) => TOPIC_COLORS[d.topic] || '#cbd5e1')
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 1)
      .attr("cursor", "pointer")
      .attr("opacity", 0.95)
      .on("click", (_event: MouseEvent, d: D3Node) => onNodeClick(d.id));

    // Generate paths for Legend (area 200 to match nodes)
    const newLegendPaths: Record<string, string> = {};
    Object.keys(NODE_TYPES).forEach(type => {
      // Mock a node object to reuse symbolType function
      const d = { type } as D3Node;
      newLegendPaths[type] = d3.symbol(symbolType(d), 200)() || "";
    });
    setLegendPaths(newLegendPaths);

    // Node text with word-wrap at spaces (preserve full name across lines)
    node.append("text")
      .attr("x", 0)
      .attr("y", 20)
      .attr("text-anchor", "middle")
      .attr("font-size", 10)
      .attr("fill", "#1e293b")
      .attr("font-weight", "600")
      .style("pointer-events", "none")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .each(function(this: any, d: D3Node) {
        const el = d3.select(this);
        const maxChars = 8;
        const words = (d.title || '').split(/\s+/).filter(Boolean);
        const lines: string[] = [];
        let current = '';
        for (const w of words) {
          if ((current ? current.length + 1 + w.length : w.length) <= maxChars) {
            current = current ? current + ' ' + w : w;
          } else {
            if (current) {
              lines.push(current);
              current = w;
            } else {
              // single word longer than maxChars -> break the word into chunks
              const parts = w.match(new RegExp('.{1,' + maxChars + '}', 'g')) || [w];
              for (let i = 0; i < parts.length - 1; i++) lines.push(parts[i]);
              current = parts[parts.length - 1];
            }
          }
        }
        if (current) lines.push(current);

        // render tspans and vertically center
        const lineHeight = 1.05; // em
        const firstDy = "1.2em"; // Start below the node shape
        el.selectAll('*').remove();
        lines.forEach((ln, i) => {
          el.append('tspan')
            .text(ln)
            .attr('x', 0)
            .attr('dy', i === 0 ? firstDy : `${lineHeight}em`);
        });
      });

    // Topic badge (Larger and Colored)
    node.append("text")
      .text((d: D3Node) => d.topic) // Show full topic name
      .attr("x", 0)
      .attr("y", (d:D3Node) => (NODE_SHAPE_MAP[d.type]==="star" || NODE_SHAPE_MAP[d.type]==="polygon")? -20:-15) // Top
      .attr("text-anchor", "middle")
      .attr("font-size", 10) // Increased size
      .attr("font-weight", "500")
      .attr("fill", (d: D3Node) => TOPIC_COLORS[d.topic] || '#94a3b8') // Match topic color
      .attr("opacity", 1)
      .style("pointer-events", "none");

    // Interaction logic
    node.on("mouseenter", (event: MouseEvent, d: D3Node) => {
      setHoveredNode(d);
      
      const linkedNodeIds = new Set<string>();
      linkedNodeIds.add(d.id);
      
      graphData.links.forEach(l => {
        const sourceId = typeof l.source === 'string' ? l.source : (l.source as D3Node).id;
        const targetId = typeof l.target === 'string' ? l.target : (l.target as D3Node).id;
        if (sourceId === d.id) linkedNodeIds.add(targetId);
        if (targetId === d.id) linkedNodeIds.add(sourceId);
      });

      node.style("opacity", (n: any) => linkedNodeIds.has(n.id) ? 1 : 0.1);
      link.style("stroke", (l: any) => {
        const srcId = typeof l.source === 'string' ? l.source : (l.source as D3Node).id;
        const tgtId = typeof l.target === 'string' ? l.target : (l.target as D3Node).id;
        return (srcId === d.id || tgtId === d.id) ? "#4f46e5" : "#cbd5e1";
      })
        .style("stroke-width", (l: any) => {
          const srcId = typeof l.source === 'string' ? l.source : (l.source as D3Node).id;
          const tgtId = typeof l.target === 'string' ? l.target : (l.target as D3Node).id;
          return (srcId === d.id || tgtId === d.id) ? 2.5 : 1.5;
        })
        .style("opacity", (l: any) => {
          const srcId = typeof l.source === 'string' ? l.source : (l.source as D3Node).id;
          const tgtId = typeof l.target === 'string' ? l.target : (l.target as D3Node).id;
          return (srcId === d.id || tgtId === d.id) ? 1 : 0.1;
        });
      linkLabel.style("opacity", (l: any) => {
        const srcId = typeof l.source === 'string' ? l.source : (l.source as D3Node).id;
        const tgtId = typeof l.target === 'string' ? l.target : (l.target as D3Node).id;
        return (srcId === d.id || tgtId === d.id) ? 1 : 0;
      });
      
      // Highlight the outline path
      d3.select(event.currentTarget).select(".node-outline")
        .attr("stroke", "#4f46e5")
        .attr("stroke-width", 4);
    })
      .on("mouseleave", (event: MouseEvent) => {
        setHoveredNode(null);
        
        node.style("opacity", 1);
        link.style("stroke", "#cbd5e1")
          .style("stroke-width", 1.5)
          .style("opacity", 1);
        linkLabel.style("opacity", 1);
        
        // Restore outline path
        d3.select(event.currentTarget).select(".node-outline")
          .attr("stroke", (d: any) => NODE_TYPES[d.type]?.nodeColor || '#91a3b0')
          .attr("stroke-width", 3);
      });

    // Update positions on tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d: D3Link) => (d.source as D3Node).x || 0)
        .attr("y1", (d: D3Link) => (d.source as D3Node).y || 0)
        .attr("x2", (d: D3Link) => (d.target as D3Node).x || 0)
        .attr("y2", (d: D3Link) => (d.target as D3Node).y || 0);

      linkLabel
        .attr("x", (d: D3Link) => ((d.source as D3Node).x! + (d.target as D3Node).x!) / 2 || 0)
        .attr("y", (d: D3Link) => ((d.source as D3Node).y! + (d.target as D3Node).y!) / 2 || 0);

      node
        .attr("transform", (d: D3Node) => `translate(${d.x},${d.y})`);

      // 🔄 动态更新所有学科的贝塞尔曲线多边形
      Array.from(disciplines).forEach(discipline => {
        const disciplineNodes = disciplineGroups[discipline];
        if (disciplineNodes.length === 0) return;

        // 生成新的贝塞尔曲线路径
        const pathData = generateBezierPath(disciplineNodes, 60);
        if (pathData) {
          disciplinePaths[discipline].attr("d", pathData);

          // 计算标签位置（物理模拟）
          const validNodes = disciplineNodes.filter(n => n.x !== undefined && n.y !== undefined);
          if (validNodes.length > 0) {
            const centerX = validNodes.reduce((sum, n) => sum + n.x!, 0) / validNodes.length;
            const centerY = validNodes.reduce((sum, n) => sum + n.y!, 0) / validNodes.length;

            const label = labelPhysics[discipline];
            if (label) {
              // 1. Attraction to Centroid
              const kAttract = 0.05;
              label.vx += (centerX - label.x) * kAttract;
              label.vy += (centerY - label.y) * kAttract;

              // 2. Repulsion from Nodes (Collision Avoidance)
              validNodes.forEach(node => {
                const dx = label.x - node.x!;
                const dy = label.y - node.y!;
                const dist = Math.hypot(dx, dy);
                const minDist = 40; // Fixed buffer

                if (dist < minDist && dist > 0) {
                  const force = (minDist - dist) / dist * 0.2;
                  label.vx += dx * force;
                  label.vy += dy * force;
                }
              });

              // 3. Update & Damping
              label.vx *= 0.5;
              label.vy *= 0.5;
              label.x += label.vx;
              label.y += label.vy;

              disciplineLabels[discipline]
                .attr("x", label.x)
                .attr("y", label.y + 5);
            }
          }
        }
      });
    });

    // Drag functions
    function dragstarted(event: Record<string, unknown>) {
      if (!(event.active as boolean)) simulation.alphaTarget(0.3).restart();
      const subject = event.subject as D3Node;
      subject.fx = subject.x;
      subject.fy = subject.y;
    }

    function dragged(event: Record<string, unknown>) {
      const subject = event.subject as D3Node;
      subject.fx = event.x as number;
      subject.fy = event.y as number;
    }

    function dragended(event: Record<string, unknown>) {
      if (!(event.active as boolean)) simulation.alphaTarget(0);
      const subject = event.subject as D3Node;
      subject.fx = null;
      subject.fy = null;
    }

  }, [graphData, disciplinesMap, onNodeClick]);

  return (
    <div className="w-full h-full relative bg-slate-50/50 select-none">
      <svg ref={svgRef} className="w-full h-full" style={{ touchAction: 'none' }}></svg>
      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-white/90 p-3 rounded-lg border border-slate-200 shadow-sm text-xs backdrop-blur-sm">
        <div className="font-bold text-slate-500 mb-2">Node Types</div>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(NODE_TYPES).map(([k, v]) => (
            <div key={k} className="flex-center-gap">
              <svg width="20" height="20" viewBox="-10 -10 20 20" className="overflow-visible">
                {legendPaths[k] && (
                  <path
                    d={legendPaths[k]}
                    fill="none"
                    stroke={v.nodeColor}
                    strokeWidth="2"
                  />
                )}
              </svg>
              <span className="text-slate-600 font-medium">{v.label.split(' ')[0]}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Hover Tooltip */}
      {hoveredNode && (
        <div className="absolute top-4 left-4 bg-white/95 p-4 rounded-xl shadow-lg border border-indigo-100 max-w-xs animate-in fade-in slide-in-from-top-2">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">
            {NODE_TYPES[hoveredNode.type]?.label}
          </div>
          <div className="font-bold text-slate-800 text-lg leading-tight mb-2">
            {hoveredNode.title}
          </div>
          <div className="text-xs text-slate-500 line-clamp-3">
            {hoveredNode.desc.replace(/[#*`]/g, '')}
          </div>
        </div>
      )}

    </div>
  );
};

// --- Main App Component ---

interface AppViewMode {
  editor: 'editor';
  graph: 'graph';
  history: 'history';
}

type ViewMode = AppViewMode[keyof AppViewMode];

const PhysMemosApp: FC = () => {
  const [nodes, setNodes] = useState<NodeData[]>([]);
  const [disciplines, setDisciplines] = useState<DisciplineData[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedTopics, setCollapsedTopics] = useState<Set<string>>(new Set());
  const [showOcrPanel, setShowOcrPanel] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('editor');
  
  // AttrStrand State
  const [activeEdition, setActiveEdition] = useState<IEdition | IPopulatedEdition | null>(null);
  // Zundo temporal store hooks for responsive undo/redo UI
  const pastStatesLength = useStore(useWorkspaceStore.temporal, (state) => state.pastStates.length);
  const futureStatesLength = useStore(useWorkspaceStore.temporal, (state) => state.futureStates.length);
  const undo = useStore(useWorkspaceStore.temporal, (state) => state.undo);
  const redo = useStore(useWorkspaceStore.temporal, (state) => state.redo);

  const submitWorkspace = async () => {
    // Collect data to submit
    const state = useWorkspaceStore.getState() as any;
    const buildSubmission = (ids: string[]) => {
      return ids.map(id => {
        const atom = state.draftAtomsData[id];
        return {
          contentPayload: atom.content,
          field: atom.field,
          type: atom.type,
          derivedFromId: atom.derivedFromId,
          frontMeta: atom.frontMeta
        };
      });
    };

    const submission = {
        conceptId: state.conceptId,
        conceptName: state.conceptName,
        conceptTopic: state.conceptTopic,
        conceptDisciplines: state.conceptDisciplines,
        baseEditionId: state.baseEditionId,
        saveType: 'usersave' as const,
        coreAtoms: buildSubmission(state.draftAtomLists.core),
        docAtoms: buildSubmission(state.draftAtomLists.doc),
        tagsAtoms: buildSubmission(state.draftAtomLists.tags),
        refsAtoms: buildSubmission(state.draftAtomLists.refs),
        relsAtoms: buildSubmission(state.draftAtomLists.rels),
    };

    const edition = await core.submitEdition(submission, 'user_uuid_here', new Date().toISOString());
    // Once submitted, ideally we update mapping IDs in store to avoid re-rendering issues
    // For simplicity here we just re-init the workspace with the new edition
    const populated = await core.getPopulatedEdition(edition.id);
    if (populated) {
         workspaceActions.initWorkspaceAndClear(populated, edition.conceptId, submission.conceptName, submission.conceptTopic, submission.conceptDisciplines);
    }
  };

  const [ocrText, setOcrText] = useState("");
  // Relation State Logic Removed in favor of AtomListEditor

  // --- Discipline State & Logic ---
  const [showDiscModal, setShowDiscModal] = useState(false);
  const [newDiscName, setNewDiscName] = useState("");
  const [newDiscAbbr, setNewDiscAbbr] = useState("");

  const handleAddDiscipline = async () => {
    const name = newDiscName.trim();
    if (!name) return;
    if (disciplines.some(d => d.name === name)) {
      alert("Discipline already exists!");
      return;
    }

    // Generate random hex color
    const hue = Math.floor(Math.random() * 360);
    const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');

    let abbr = newDiscAbbr.trim();
    if (!abbr) abbr = name.substring(0, 1);

    const newDisc: DisciplineData = {
      name: name,
      abbr: abbr.substring(0, 2),
      color: randomColor,
      hue: hue
    };

    await storage.saveDiscipline(newDisc);
    const newDisciplines = [...disciplines, newDisc];
    setDisciplines(newDisciplines);
    useGlobalStore.getState().setDisciplines(newDisciplines);

    setShowDiscModal(false);
    setNewDiscName("");
    setNewDiscAbbr("");
  };

  const handleDeleteDiscipline = async (name: string) => {
    if (!window.confirm(`确定删除学科 "${name}" 吗？\n这不会自动从所有条目中移除该标签。`)) return;

    await storage.deleteDiscipline(name);
    const newDisciplines = disciplines.filter(d => d.name !== name);
    setDisciplines(newDisciplines);
    useGlobalStore.getState().setDisciplines(newDisciplines);

    // Note: We skip deep DB node updates here for simplicity,
    // real implementation would queue a worker to update all affected Concepts
  };

  const disciplinesMap = useMemo(() => {
    return disciplines.reduce((acc, d) => ({ ...acc, [d.name]: d }), {} as Record<string, DisciplineData>);
  }, [disciplines]);


  const generateTopicId = (name: string) => `topic_${name.trim().replace(/\s+/g, '_')}`;

  const loadData = async () => {
    try {
      // 1. Load Data
      let allDisciplines = await storage.getAllDisciplines();
      let allConcepts = await storage.getAllConcepts();

      // If storage is empty, fetch and migrate from V2 JSON
      if (allDisciplines.length === 0 && allConcepts.length === 0) {
          console.log("Empty storage, running data migration...");
          // We will use migration script from migrateData to handle JSON
          // And load disciplines correctly from v2.
          const { migrateData } = await import('./attrstrand/migration');
          await migrateData();

          allDisciplines = await storage.getAllDisciplines();
          allConcepts = await storage.getAllConcepts();
      }

      setDisciplines(allDisciplines);
      useGlobalStore.getState().setDisciplines(allDisciplines);

      // Build views for Sidebar
      // Extract topics and map node views
      const conceptViewsMap: Record<string, any> = {};
      const nodesToSet: NodeData[] = []; // Emulate NodeData for Graph & Legacy sidebar

      for (const concept of allConcepts) {
          conceptViewsMap[concept.id] = {
              id: concept.id,
              name: concept.name,
              topic: concept.topic,
              disciplines: concept.disciplines
          };

          // Also populate fake nodes array for Graph compatibility
          nodesToSet.push({
              id: concept.id,
              title: concept.name,
              topic: concept.topic,
              disciplines: concept.disciplines,
              type: 'FORMULA', // Default legacy
              latex: '',
              desc: '',
              references: '',
              constraints: [],
              relations: []
          });
      }

      useGlobalStore.getState().setConceptViews(conceptViewsMap);

      const allTopics = Array.from(new Set(nodesToSet.map(n => n.topic).filter(Boolean)));
      const newTopicNodes: NodeData[] = [];

      allTopics.forEach(topicName => {
          const children = nodesToSet.filter(n => n.topic === topicName);
          const disciplines = Array.from(new Set(children.flatMap(c => c.disciplines)));

          newTopicNodes.push({
            id: generateTopicId(topicName),
            topic: topicName,
            title: topicName,
            type: 'TOPIC',
            disciplines: disciplines,
            latex: '',
            desc: '',
            references: '',
            constraints: [],
            relations: []
          });
      });

      const finalNodes = [...nodesToSet, ...newTopicNodes];
      setNodes(finalNodes);

      if (finalNodes.length > 0 && !activeNodeId) {
         const firstTopic = finalNodes.find(n => n.type === 'TOPIC');
         setActiveNodeId(firstTopic ? firstTopic.id : finalNodes[0].id);
      }
    } catch (err) {
      console.error("Storage Error:", err);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const saveNode = async (node: NodeData) => {
    // Only update local graph state. Real changes are committed via workspace
    setNodes(prev => prev.map(n => n.id === node.id ? node : n));
  };

  const handleCreateNode = async () => {
    let initialTopic = '未分类 topic';
    const activeNode = nodes.find(n => n.id === activeNodeId);
    if (activeNode) {
       if (activeNode.type === 'TOPIC') {
          initialTopic = activeNode.title;
       } else {
          initialTopic = activeNode.topic;
       }
    }

    // In a real app we'd submit to core directly.
    // Here we instantiate a fresh workspace instead.
    workspaceActions.initWorkspaceAndClear(null, '', '新物理概念', initialTopic, []);

    // We update UI local nodes
    const newNode: NodeData = {
      id: crypto.randomUUID(),
      disciplines: [],
      topic: initialTopic,
      title: '新物理概念',
      type: 'FORMULA',
      latex: '',
      desc: '',
      references: '',
      constraints: [],
      relations: []
    };

    setNodes(prev => [...prev, newNode]);
    setActiveNodeId(newNode.id);
  };

  const handleDeleteNode = async () => {
    const activeNode = nodes.find(n => n.id === activeNodeId);
    if (!activeNode) return;

    if (!window.confirm('确定删除吗？ (模拟删除)')) return;

    // Real implementation would delete concept from storage
    // Update local state
    setNodes(prev => prev.filter(n => n.id !== activeNode.id));
    setActiveNodeId(null);
  };

  const handleExport = () => {
    const exportData = {
      disciplines,
      nodes: nodes.filter(n => n.type !== 'TOPIC')
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = "phys_memos_dataset.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    // Disabled logic since IndexedDB removed
    alert("导入导出在纯前端 AttrStrand 模式下暂时不可用 (需迁移脚本支持新格式)");
    e.target.value = '';
  };

  // Relation helper functions removed in favor of direct AtomListEditor usage

  const simulateOCR = () => {
    setOcrText("识别中...");
    setTimeout(() => {
      setOcrText("W = C \\rho \\sqrt{g_{eff}} (D - kd)^{2.5}");
    }, 600);
  };

  const activeNode = nodes.find(n => n.id === activeNodeId);

  // Sync AttrStrand when activeNode changes
  useEffect(() => {
    const syncAttrStrand = async () => {
      if (!activeNode || activeNode.type === 'TOPIC') {
        setActiveEdition(null);
        return;
      }

      // Check if concept exists
      let concept = await storage.getConcept(activeNode.id);

      if (!concept) {
          workspaceActions.initWorkspaceAndClear(null, activeNode.id, activeNode.title, activeNode.topic, activeNode.disciplines);
        return;
      }

      // Load latest head
      const heads = Object.entries(concept.currentHeads).sort((a, b) => b[1] - a[1]);
      if (heads.length > 0) {
        const headId = heads[0][0];
        const populated = await core.getPopulatedEdition(headId);
        if (populated) {
          setActiveEdition(populated);
            workspaceActions.initWorkspaceAndClear(populated, activeNode.id, concept.name, concept.topic, concept.disciplines);
        }
      } else {
          // New concept, no heads yet, but workspace initialized earlier
            // If we're here and there's no head, perhaps we just clear history to be safe
            useWorkspaceStore.temporal.getState().clear();
      }
    };

    syncAttrStrand();
  }, [activeNodeId]); // Depend on ID



  const toggleTopicCollapse = (topic: string) => {
    setCollapsedTopics(prev => {
      const next = new Set(prev);
      if (next.has(topic)) {
        next.delete(topic);
      } else {
        next.add(topic);
      }
      return next;
    });
    setActiveNodeId(null); // Deselect active node when toggling
  };

  const filteredNodes = nodes.filter(n => {
    const q = searchQuery.toLowerCase();
    return (
      n.title.toLowerCase().includes(q) ||
      n.type.toLowerCase().includes(q) ||
      (n.topic || '').toLowerCase().includes(q) ||
      (n.disciplines || []).some(d => disciplinesMap[d]?.name.toLowerCase().includes(q)) ||
      (n.constraints && n.constraints.some(c => c.toLowerCase().includes(q)))
    );
  });

  const relevantTopics = Array.from(new Set(filteredNodes.map(n => n.topic))).sort();

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-800 font-sans overflow-hidden">
      
      <style>{`
        .markdown-body h1, .markdown-body h2, .markdown-body h3 { font-weight: 700; margin-top: 1em; margin-bottom: 0.5em; color: #1e293b; }
        .markdown-body h1 { font-size: 1.5em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }
        .markdown-body h2 { font-size: 1.3em; }
        .markdown-body p { margin-bottom: 0.8em; line-height: 1.7; }
        .markdown-body ul { list-style-type: disc; padding-left: 1.5em; margin-bottom: 0.8em; }
        .markdown-body ol { list-style-type: decimal; padding-left: 1.5em; margin-bottom: 0.8em; }
        .markdown-body blockquote { border-left: 4px solid #cbd5e1; padding-left: 1em; color: #64748b; font-style: italic; background: #f8fafc; py: 0.5em; border-radius: 0 4px 4px 0; }
        .markdown-body a { color: #4f46e5; text-decoration: none; border-bottom: 1px dashed #818cf8; }
        .markdown-body a:hover { color: #4338ca; border-bottom-style: solid; }
        .markdown-body code { background: #f1f5f9; padding: 0.2em 0.4em; border-radius: 4px; font-family: monospace; font-size: 0.9em; color: #0f172a; border: 1px solid #e2e8f0; }
        .markdown-body pre { background: #1e293b; padding: 1em; border-radius: 8px; overflow-x: auto; color: #f8fafc; }
        .markdown-body .katex-display { margin: 1em 0; overflow-x: auto; overflow-y: hidden; }
      `}</style>

      {/* Left Sidebar */}
      <div className={`${sidebarOpen ? 'w-80' : 'w-0'} transition-all duration-300 bg-white border-r border-slate-200 flex flex-col z-20 shadow-[4px_0_24px_rgba(0,0,0,0.02)]`}>
        <div className="p-4 border-b border-slate-100 flex-between bg-white">
          <h1 className="font-bold text-lg flex-center-gap text-slate-800 tracking-tight">
            <Database className="w-5 h-5 text-indigo-600" />
            Phys-Memos <span className="text-[10px] font-normal text-slate-400 bg-slate-100 px-1.5 rounded">v5.0</span>
          </h1>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-slate-600">
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
        
        <div className="p-3 bg-white border-b border-slate-50">
          <div className="relative group">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
            <input
              type="text"
              placeholder="搜索概念、领域、标签..."
              className="w-full pl-9 pr-3 py-2 input-field"
              value={searchQuery}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {relevantTopics.map(topic => {
            // Find Topic Node (Header)
            const topicNode = nodes.find(n => n.type === 'TOPIC' && n.title === topic);
            // Find Children (excluding Topic Node itself, from filtered list)
            const children = filteredNodes.filter(n => n.topic === topic && n.type !== 'TOPIC');

            // If strictly searching (query not empty), always expand. Else check state.
            const isExpanded = searchQuery ? true : !collapsedTopics.has(topic);
            const isTopicActive = (topicNode && activeNodeId === topicNode.id) || (activeNode?.topic === topic);

            return (
              <div key={topic} className="border-b border-slate-50">
                {/* Topic Header */}
                <div
                  className={`group flex-between px-3 py-2 cursor-pointer transition-colors ${
                    isTopicActive ? 'bg-indigo-50/80 border-l-4 border-l-indigo-500 pl-2' : 'hover:bg-slate-50 border-l-4 border-l-transparent pl-2'
                  }`}
                >
                  <div
                    className="flex-center-gap flex-1 overflow-hidden"
                    onClick={() => {
                      if (topicNode) {
                        setActiveNodeId(topicNode.id);
                        setViewMode('editor');
                      }
                    }}
                  >
                    {isExpanded ? <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" /> : <Folder className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                    <span className={`font-semibold text-sm truncate ${isTopicActive ? 'text-indigo-900' : 'text-slate-700'}`}>
                      {topicNode ? topicNode.title : topic}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTopicCollapse(topic);
                    }}
                    className="btn-icon"
                  >
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Children List */}
                {isExpanded && (
                  <div className="bg-slate-50/30 pb-1">
                    {children.map(node => {
                      const isActive = activeNodeId === node.id;
                      return (
                        <div
                          key={node.id}
                          onClick={() => {
                            setActiveNodeId(node.id);
                            setViewMode('editor');
                          }}
                          className={`pl-9 pr-3 py-2 cursor-pointer transition-all flex-between group/item ${
                            isActive ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100/50'
                          }`}
                        >
                          <div className="flex-center-gap min-w-0">
                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-indigo-400' : 'bg-slate-300'}`}></div>
                            <span className="truncate text-xs">{node.title}</span>
                          </div>
                        </div>
                      );
                    })}
                    {children.length === 0 && !topicNode && (
                      <div className="pl-9 py-2 text-xs text-slate-400 italic">No items</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom Controls */}
        <div className="p-3 border-t border-slate-100 flex flex-col gap-2 bg-slate-50/50">
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('editor')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition ${
                viewMode === 'editor' ? 'bg-white border border-indigo-200 text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-white/50'
              }`}
            >
              <FileText className="w-4 h-4" /> 编辑
            </button>
            <button
              onClick={() => setViewMode('graph')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition ${
                viewMode === 'graph' ? 'bg-white border border-indigo-200 text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-white/50'
              }`}
            >
              <Network className="w-4 h-4" /> 图谱
            </button>
            <button
              onClick={() => { setViewMode('history'); /* setHistoryParentId(null); */ }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition ${
                viewMode === 'history' ? 'bg-white border border-indigo-200 text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-white/50'
              }`}
            >
              <GitCommit className="w-4 h-4" /> 版本
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreateNode}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" /> 新建
            </button>
            <label
              className="px-3 flex-center cursor-pointer btn-secondary"
              title="导入数据集"
            >
              <Upload className="w-4 h-4" />
              <input type="file" className="hidden" accept=".json" onChange={handleImport} />
            </label>
            <button
              onClick={handleExport}
              className="px-3 btn-secondary"
              title="导出完整数据集"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Work Area */}
      <div className="flex-1 flex flex-col h-full relative bg-white">
        
        {viewMode === 'graph' ? (
          <KnowledgeGraph
            nodes={nodes}
            disciplinesMap={disciplinesMap}
            activeNodeId={activeNodeId}
            onNodeClick={(id) => {
              setActiveNodeId(id);
              setViewMode('editor');
            }}
          />
        ) : viewMode === 'history' && activeNodeId ? (
            <div className="flex-1 p-8 bg-slate-50 overflow-hidden flex flex-col">
                <h2 className="text-xl font-bold mb-4 text-slate-700">Concept History: {activeNode?.title}</h2>
                <ConceptNetworkView
                    conceptId={activeNodeId}
                    currentEditionId={activeEdition?.id}
                    onSelectEdition={async (edition) => {
                        // Switch to this edition
                        setActiveEdition(edition);
                        const populated = await core.getPopulatedEdition(edition.id);
                        if (populated && activeNode) {
                            workspaceActions.initWorkspaceAndClear(populated, activeNode.id, activeNode.title, activeNode.topic, activeNode.disciplines);
                        }
                    }}
                    onCreateBranch={(_parent) => {
                        alert("Branch creation not implemented in UI demo yet, but core supports it!");
                    }}
                />
            </div>
        ) : (
          <>
            <div className={`bg-white border-b border-slate-100 flex flex-col justify-center px-8 z-10 transition-all ${activeNode?.type === 'TOPIC' ? 'h-16' : 'min-h-32 py-4 space-y-4'}`}>
              <div className="flex-between w-full">
                <div className="flex-center-gap">
                  {!sidebarOpen && (
                    <button onClick={() => setSidebarOpen(true)} className="btn-ghost rounded-full mr-2">
                      <ArrowRight className="w-5 h-5" />
                    </button>
                  )}
                  {activeNode && activeNode.type !== 'TOPIC' && (
                    <div className="flex items-center gap-4 animate-in fade-in slide-in-from-left-2">
                      {/* 学科多选（圆形按钮） */}
                      <div className="flex flex-col gap-2">
                        <span className="text-xs font-bold text-slate-400 flex-center-gap">
                          <Layers className="w-3.5 h-3.5 text-indigo-400" />
                          学科
                        </span>
                        <div className="flex flex-wrap gap-2 items-center">
                          {disciplines.map((disc) => {
                            const isSelected = activeNode.disciplines.includes(disc.name);
                            const isCapsule = (disc.abbr || '').length > 1;
                            return (
                              <div key={disc.name} className="relative group">
                                <button
                                  onClick={() => {
                                    const updated = isSelected
                                      ? activeNode.disciplines.filter(d => d !== disc.name)
                                      : [...activeNode.disciplines, disc.name];
                                    saveNode({ ...activeNode, disciplines: updated });
                                  }}
                                  className={`
                                    flex-center transition-all duration-200 font-bold text-xs flex-shrink-0 hover:shadow-md
                                    ${isCapsule ? 'h-8 px-3 rounded-full' : 'w-8 h-8 rounded-full'}
                                  `}
                                  style={{
                                    borderWidth: '2px',
                                    borderColor: isSelected ? disc.color : '#e2e8f0',
                                    backgroundColor: isSelected ? `${disc.color}12` : '#f3f4f6',
                                    color: isSelected ? disc.color : '#94a3b8'
                                  }}
                                  title={disc.name}
                                >
                                  {disc.abbr || disc.name.substring(0, 1)}
                                </button>
                                <button
                                   onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteDiscipline(disc.name);
                                   }}
                                   className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex-center opacity-0 group-hover:opacity-100 transition-all shadow-sm z-10 hover:bg-red-600 hover:scale-110"
                                   title="全局删除此学科"
                                >
                                   <X className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            );
                          })}
                          <button
                             onClick={() => setShowDiscModal(true)}
                             className="w-8 h-8 rounded-full flex-center border-2 border-dashed border-slate-300 text-slate-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50 transition-all"
                             title="新建学科"
                          >
                             <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      
                      {/* 主题/Topic */}
                      <div className="flex flex-col gap-2">
                        <span className="text-xs font-bold text-slate-400 flex-center-gap">
                          <Tag className="w-3.5 h-3.5 text-amber-400" />
                          主题
                        </span>
                        <input
                          className="border border-slate-200 rounded-md px-3 py-1.5 text-sm w-40 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
                          value={activeNode.topic}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => saveNode({...activeNode, topic: e.target.value})}
                          placeholder="例如: 颗粒流"
                        />
                      </div>
                    </div>
                  )}
                  {activeNode && activeNode.type === 'TOPIC' && (
                    <div className="flex-center-gap text-slate-400 font-medium text-sm animate-in fade-in slide-in-from-left-2">
                      <FolderOpen className="w-5 h-5 text-amber-400" />
                      <span>主题概览模式</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowOcrPanel(!showOcrPanel)}
                    className={`flex-center-gap px-4 py-1.5 text-xs font-medium rounded-full transition border ${
                      showOcrPanel ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Crop className="w-3.5 h-3.5" />
                    <span>OCR 辅助阅读</span>
                  </button>
                  {activeNode && (
                    <button
                      onClick={handleDeleteNode}
                      className="btn-danger p-2 rounded-full text-slate-300"
                      title={activeNode.type === 'TOPIC' ? "删除主题" : "删除条目"}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Secondary Row: Title & Type (Only for non-TOPIC nodes) */}
              {activeNode ? (
                activeNode.type !== 'TOPIC' ? (
                  <div className="flex items-center gap-4 w-full animate-in fade-in slide-in-from-bottom-2">
                    <input
                      type="text"
                      value={activeNode.title}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => saveNode({ ...activeNode, title: e.target.value })}
                      className="text-2xl font-bold text-slate-800 bg-transparent border-none focus:outline-none focus:ring-0 placeholder-slate-300 min-w-[200px] w-full"
                      placeholder="输入概念标题..."
                    />
                    <div className="relative">
                      <select
                        value={activeNode.type}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => saveNode({ ...activeNode, type: e.target.value as NodeData['type'] })}
                        className="appearance-none pl-3 pr-8 py-1 text-xs font-medium border border-slate-200 rounded-full bg-slate-50 hover:bg-white transition cursor-pointer focus:ring-2 focus:ring-indigo-100 outline-none text-slate-600"
                      >
                        {Object.keys(NODE_TYPES).map(key => (
                          <option key={key} value={key}>
                            {NODE_TYPES[key as keyof typeof NODE_TYPES].label}
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-2.5 top-1.5 pointer-events-none text-slate-400">
                        <ArrowRight className="w-3 h-3 rotate-90" />
                      </div>
                    </div>
                  </div>
                ) : null
              ) : (
                <span className="text-slate-300 font-medium">请在左侧选择或新建条目</span>
              )}
            </div>

            {activeNode ? (
              activeNode.type === 'TOPIC' ? (
                // --- TOPIC OVERVIEW PAGE ---
                <div className="flex-1 overflow-y-auto bg-slate-50/30">
                  <div className="max-w-5xl mx-auto p-8 space-y-8">
                    {/* Header Section */}
                    <div className="card-base p-8">
                      <div className='flex flex-row'>
                        <div className="mb-6 pr-4">
                          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">主题名称 / Topic</label>
                          <input
                            type="text"
                            value={activeNode.title}
                            onChange={async (e) => {
                              const newTitle = e.target.value;
                              const oldTitle = activeNode.title;

                              if (nodes.some(n => n.type === 'TOPIC' && n.title === newTitle && n.id !== activeNode.id)) {
                                // 预留防冲突
                              }

                              // Optimistic update for UI
                              const updatedNode = { ...activeNode, title: newTitle, topic: newTitle };

                              // Propagate to children
                              const children = nodes.filter(n => n.topic === oldTitle && n.id !== activeNode.id);
                              const updatedChildren = children.map(c => ({ ...c, topic: newTitle }));

                              const newNodes = nodes.map(n => {
                                if (n.id === activeNode.id) return updatedNode;
                                const child = updatedChildren.find(c => c.id === n.id);
                                return child || n;
                              });

                              setNodes(newNodes);
                              await dbHelper.put(updatedNode);
                              for (const child of updatedChildren) await dbHelper.put(child);
                            }}
                            className="text-3xl font-bold text-slate-800 bg-transparent border-b-2 border-transparent hover:border-slate-200 focus:border-indigo-500 focus:outline-none w-full transition-colors"
                            placeholder="Topic Name..."
                          />
                        </div>
                        <div className="space-y-4 grow">
                            
                            <div className="p-4 bg-indigo-50/50 rounded-lg border border-indigo-100 flex flex-row">
                               <div className='pr-8'>
                               <div className="text-2xl font-bold text-indigo-600 mb-1 ">
                                 {nodes.filter(n => n.topic === activeNode.title && n.type !== 'TOPIC').length}
                               </div>
                               <div className="text-xs text-indigo-400 font-medium uppercase tracking-wider">Entries</div>
                               </div>

                               <div>
                               <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">所属学科(自动聚合) / Disciplines</span>
                               <div className="flex flex-wrap gap-2">
                                  {Array.from(new Set(nodes.filter(n => n.topic === activeNode.title && n.type !== 'TOPIC').flatMap(n => n.disciplines))).map(disciplineKey => {
                                      const disc = disciplinesMap[disciplineKey];
                                      if (!disc) return null;
                                      return (
                                          <span
                                              key={disciplineKey}
                                              className="px-3 py-1.5 rounded-full text-xs font-bold border cursor-default"
                                              style={{ backgroundColor: `${disc.color}20`, color: disc.color, borderColor: disc.color }}
                                          >
                                              {disc.name}
                                          </span>
                                      );
                                  })}
                                  {Array.from(new Set(nodes.filter(n => n.topic === activeNode.title && n.type !== 'TOPIC').flatMap(n => n.disciplines))).length === 0 && (
                                      <span className="text-xs text-slate-400 italic">暂无关联学科 / No disciplines found</span>
                                  )}
                               </div>
                            </div>
                            </div>
                         </div>
                      </div>

                      <div>
                        <EditableBlock
                          label="主题摘要 / Summary"
                          value={activeNode.desc}
                          onChange={(val) => saveNode({ ...activeNode, desc: val as string })}
                          type="markdown"
                          variant="subtle"
                          placeholder="Describe this topic..."
                          className="card-panel min-h-[120px] bg-slate-50 border-none"
                        />
                      </div>
                      
                    </div>

                    {/* Children Cards List - REFACTORED to use TopicChildCard */}
                    <div>
                      <h3 className="text-lg font-bold text-slate-700 mb-4 flex-center-gap">
                        <Layers className="w-5 h-5 text-slate-400" />
                        {activeNode.title} 中的条目
                      </h3>
                      <div className="space-y-3">
                        {nodes.filter(n => n.topic === activeNode.title && n.type !== 'TOPIC').map(child => (
                           <TopicChildCard
                               key={child.id}
                               conceptId={child.id}
                               legacyTitle={child.title}
                               legacyType={child.type}
                               legacyTypeConfig={NODE_TYPES[child.type]}
                               onClick={() => setActiveNodeId(child.id)}
                           />
                        ))}
                        {nodes.filter(n => n.topic === activeNode.title && n.type !== 'TOPIC').length === 0 && (
                           <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 bg-slate-50/50">
                              暂无下属条目
                           </div>
                        )}
                      </div>
                    </div>

                    {/* Aggregated References */}
                    <div className="card-panel bg-slate-100 p-6 rounded-xl">
                       <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 flex-center-gap">
                          <Book className="w-4 h-4" />
                          文献聚合 / Aggregated References
                       </h3>
                       <ol className="list-decimal list-outside ml-4 space-y-2 text-xs text-slate-600">
                          {Array.from(new Set(
                             nodes
                               .filter(n => n.topic === activeNode.title && n.type !== 'TOPIC')
                               .flatMap(n => (n.references || '').split('\n'))
                               .map(r => r.trim())
                               .filter(Boolean)
                          )).map((ref, i) => (
                             <li key={i}>
                                <RichTextRenderer content={ref} className="inline-block" />
                             </li>
                          ))}
                          {nodes.filter(n => n.topic === activeNode.title && n.type !== 'TOPIC').every(n => !n.references) && (
                             <li className="text-slate-400 italic list-none -ml-4">No references found.</li>
                          )}
                       </ol>
                    </div>
                  </div>
                </div>
              ) : (
                // --- STANDARD NODE EDITOR ---
              <div className="flex-1 overflow-y-auto bg-slate-50/30">
                <div className="max-w-full   mx-auto p-8 space-y-6">
                  {/* Replace SmartFormulaBlock and EditableBlock with AtomListEditor */}
                  <div className="flex justify-end mb-4 gap-2">
                       <button
                            onClick={() => undo()}
                            disabled={pastStatesLength === 0}
                            className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-50"
                       >
                            撤销
                       </button>
                       <button
                            onClick={() => redo()}
                            disabled={futureStatesLength === 0}
                            className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-50"
                       >
                            重做
                       </button>
                       <button onClick={submitWorkspace} className="btn-primary text-xs py-1.5 px-3 ml-2">
                            <GitCommit className="w-4 h-4 mr-1"/> 保存版本
                       </button>
                  </div>

                  <div className="mb-2">
                     <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex-center-gap">核心定义 · 数学形式 / DEF</label>
                     <div className="bg-white border-2 border-indigo-100 shadow-sm p-6 rounded-xl">
                        <AtomListEditor field="core" />
                     </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-1">
                      <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-sm h-full">
                         <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex-center-gap">适用域 / Fields</label>
                         <AtomListEditor field="tags" />
                      </div>
                    </div>
                    <div className="md:col-span-2">
                       <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-sm h-full">
                         <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex-center-gap">笔记 · 摘要 / Notes</label>
                         <AtomListEditor field="doc" />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="card-base">
                    <div className="flex-center-gap mb-6">
                      <GitCommit className="w-5 h-5 text-indigo-500" />
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">关联与推演 / Related</span>
                    </div>
                    {/* Migrated Relation Editor */}
                    <div className="mb-4">
                       <AtomListEditor field="rels" className="space-y-0" />
                    </div>
                  </div>
                  
                  <div className="card-base">
                    <div className="flex-center-gap mb-4">
                      <Hash className="w-4 h-4 text-indigo-500" />
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">参考文献 / References</span>
                    </div>
                    <AtomListEditor field="refs" className="bg-slate-50/50 rounded-lg border border-slate-100 p-2" />
                  </div>
                </div>
                </div>
              </div>
            )
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-300 bg-slate-50/30">
                <Database className="w-20 h-20 mb-6 text-slate-200" />
                <p className="text-lg font-medium text-slate-400">选择一个物理概念进行编辑</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* OCR Panel */}
      {showOcrPanel && (
        <div className="w-96 border-l border-slate-200 bg-white flex flex-col shadow-2xl z-30 animate-in slide-in-from-right-10 duration-300">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center backdrop-blur-sm">
            <h3 className="font-bold text-sm text-slate-700 flex-center-gap">
              <Book className="w-4 h-4 text-indigo-500" />
              文献阅读 / OCR 提取
            </h3>
            <button onClick={() => setShowOcrPanel(false)} className="btn-icon">
              <Maximize className="w-4 h-4" />
            </button>
          </div>
          <div className="p-5 flex-1 overflow-y-auto">
            <div
              className="border-2 border-dashed border-slate-200 rounded-xl h-56 bg-slate-50 flex flex-col items-center justify-center mb-6 relative group cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-all"
              onClick={simulateOCR}
            >
              <div className="p-4 bg-white rounded-full shadow-sm mb-3 group-hover:scale-110 transition-transform">
                <Crop className="w-6 h-6 text-indigo-500" />
              </div>
              <span className="text-sm font-medium text-slate-500">点击模拟框选公式</span>
              <span className="text-xs text-slate-400 mt-1">支持 PDF 截图或手写笔记</span>
            </div>
            {ocrText && (
              <div className="bg-white border border-indigo-100 shadow-lg shadow-indigo-500/5 rounded-xl p-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex-between mb-2">
                  <span className="text-xs font-bold text-indigo-600 uppercase tracking-wide">识别结果</span>
                  <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">置信度 98%</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 mb-4 group relative">
                  <code className="text-xs font-mono text-slate-700 break-all block">{ocrText}</code>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => activeNode && saveNode({ ...activeNode, latex: ocrText })}
                    className="flex-center gap-1.5 text-xs btn-primary py-2"
                  >
                    <ArrowRight className="w-3 h-3" /> 填入公式
                  </button>
                  <button
                    onClick={() => activeNode && saveNode({ ...activeNode, desc: activeNode.desc + '\n\n> OCR 来源备注: ' + ocrText })}
                    className="flex-center gap-1.5 text-xs bg-white border border-slate-200 text-slate-600 py-2 rounded-lg hover:bg-slate-50 font-medium transition"
                  >
                    <Plus className="w-3 h-3" /> 追加笔记
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Discipline Modal */}
      {showDiscModal && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex-center animate-in fade-in duration-200">
           <div className="bg-white p-6 rounded-xl shadow-2xl border border-slate-200 w-80 space-y-4">
              <div className="flex-between mb-2">
                 <h3 className="font-bold text-slate-700 flex-center-gap">
                    <Layers className="w-4 h-4 text-indigo-500" />
                    新建学科
                 </h3>
                 <button onClick={() => setShowDiscModal(false)} className="text-slate-400 hover:text-slate-600">
                    <X className="w-4 h-4" />
                 </button>
              </div>

              <div className="space-y-1">
                 <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">名称 (Name)</label>
                 <input
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 transition-all"
                    placeholder="例如: 量子光学"
                    value={newDiscName}
                    onChange={e => setNewDiscName(e.target.value)}
                    autoFocus
                 />
              </div>

              <div className="space-y-1">
                 <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">缩写 (Abbr, 1-2 chars)</label>
                 <div className="flex gap-2">
                    <input
                       className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 transition-all"
                       placeholder="默认首字"
                       maxLength={2}
                       value={newDiscAbbr}
                       onChange={e => setNewDiscAbbr(e.target.value)}
                    />
                    <div className="w-10 h-10 rounded-full flex-center bg-indigo-50 text-indigo-600 text-xs font-bold border border-indigo-100">
                       {newDiscAbbr || (newDiscName ? newDiscName[0] : '?')}
                    </div>
                 </div>
              </div>

              <div className="pt-2 flex gap-3">
                 <button
                    onClick={() => setShowDiscModal(false)}
                    className="flex-1 px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 font-medium border border-transparent hover:border-slate-200 transition-all"
                 >
                    取消
                 </button>
                 <button
                    onClick={handleAddDiscipline}
                    disabled={!newDiscName.trim()}
                    className="flex-1 px-4 btn-primary disabled:opacity-50 hover:shadow-md transition-all"
                 >
                    创建
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default PhysMemosApp;
