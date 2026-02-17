import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Book, Download, Plus, Trash2, Search, 
  Link as LinkIcon, ArrowRight, Maximize, Crop, 
  Database, Tag, AlertCircle, GitCommit, X, Edit3, Eye, FileText, Hash, Layers, 
  Network, Share2
} from 'lucide-react';

// --- 全局常量定义 ---

const NODE_TYPES = {
  FORMULA: { label: '公式 (Formula)', color: 'bg-blue-50 text-blue-700 border-blue-200', nodeColor: '#3b82f6' },
  LAW: { label: '定律 (Law)', color: 'bg-purple-50 text-purple-700 border-purple-200', nodeColor: '#a855f7' },
  MODEL: { label: '模型 (Model)', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', nodeColor: '#10b981' },
  PAPER: { label: '文献 (Paper)', color: 'bg-slate-100 text-slate-700 border-slate-200', nodeColor: '#64748b' },
  EVIDENCE: { label: '证据/反例 (Evidence)', color: 'bg-rose-50 text-rose-700 border-rose-200', nodeColor: '#f43f5e' },
};

const RELATION_TYPES = {
  DERIVES_FROM: { label: '推导自', icon: '↳', color: 'text-slate-500' },
  SPECIAL_CASE: { label: '特例属于', icon: '⊂', color: 'text-blue-500' },
  EMPIRICAL_FIT: { label: '经验拟合于', icon: '≈', color: 'text-emerald-500' },
  CONTRADICTS: { label: '矛盾/反驳', icon: '≠', color: 'text-red-500' },
  MODIFIES: { label: '修正了', icon: 'Δ', color: 'text-orange-500' },
  EXPLAINS: { label: '解释机制', icon: '?', color: 'text-purple-500' },
};

const PRESET_DOMAINS = [
  "流体力学 (Fluid Dynamics)",
  "颗粒物理 (Granular Physics)",
  "量子力学 (Quantum Mechanics)",
  "统计力学 (Statistical Mechanics)",
  "电动力学 (Electrodynamics)",
  "凝聚态物理 (Condensed Matter)"
];

// --- IndexedDB 工具类 ---
const DB_NAME = 'PhysMemosDB_v6';
const STORE_NAME = 'nodes';
const DB_VERSION = 1;

const dbHelper = {
  open: () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
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
  put: async (item) => {
    const db = await dbHelper.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(item);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  delete: async (id) => {
    const db = await dbHelper.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
};

// --- D3 Graph Component ---
const KnowledgeGraph = ({ nodes, activeNodeId, onNodeClick }) => {
  const svgRef = useRef(null);
  const [hoveredNode, setHoveredNode] = useState(null);

  // 转换数据为 D3 格式
  const graphData = useMemo(() => {
    const d3Nodes = nodes.map(n => ({ ...n })); // Shallow copy
    const d3Links = [];
    nodes.forEach(source => {
      if (source.relations) {
        source.relations.forEach(rel => {
          // 确保目标节点存在
          if (nodes.find(n => n.id === rel.targetId)) {
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
    if (!window.d3 || !svgRef.current) return;
    const d3 = window.d3;

    // 清理旧图表
    d3.select(svgRef.current).selectAll("*").remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const svg = d3.select(svgRef.current)
      .attr("viewBox", [0, 0, width, height]);

    // 定义箭头标记
    svg.append("defs").selectAll("marker")
      .data(["end"])
      .join("marker")
      .attr("id", d => `arrow-${d}`)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 25) // 箭头位置偏移，避免覆盖节点
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("fill", "#94a3b8")
      .attr("d", "M0,-5L10,0L0,5");

    // 力导向模拟
    const simulation = d3.forceSimulation(graphData.nodes)
      .force("link", d3.forceLink(graphData.links).id(d => d.id).distance(150))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(40));

    // 绘制连线
    const link = svg.append("g")
      .selectAll("line")
      .data(graphData.links)
      .join("line")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrow-end)");

    // 绘制连线标签 (关系类型)
    const linkLabel = svg.append("g")
      .selectAll("text")
      .data(graphData.links)
      .join("text")
      .text(d => RELATION_TYPES[d.type]?.icon || '')
      .attr("font-size", 10)
      .attr("fill", "#64748b")
      .attr("text-anchor", "middle")
      .attr("dy", -3);

    // 绘制节点组
    const node = svg.append("g")
      .selectAll("g")
      .data(graphData.nodes)
      .join("g")
      .call(d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended));

    // 节点圆圈
    const circle = node.append("circle")
      .attr("r", 15)
      .attr("fill", d => NODE_TYPES[d.type]?.nodeColor || '#cbd5e1')
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .attr("cursor", "pointer")
      .on("click", (event, d) => onNodeClick(d.id));

    // 节点文本
    node.append("text")
      .text(d => d.title.length > 10 ? d.title.substring(0, 10) + '...' : d.title)
      .attr("x", 18)
      .attr("y", 5)
      .attr("font-size", 12)
      .attr("fill", "#1e293b")
      .style("pointer-events", "none")
      .style("font-weight", "500");

    // 领域标签 (Topic Pill)
    node.append("rect")
      .attr("x", -10)
      .attr("y", 20)
      .attr("width", d => d.topic ? d.topic.length * 5 + 10 : 0)
      .attr("height", 14)
      .attr("rx", 7)
      .attr("fill", "#f1f5f9")
      .style("display", d => d.topic ? "block" : "none");

    node.append("text")
      .text(d => d.topic ? d.topic.split('(')[0].trim() : '')
      .attr("x", 0)
      .attr("y", 30)
      .attr("font-size", 8)
      .attr("text-anchor", "start")
      .attr("fill", "#64748b")
      .style("display", d => d.topic ? "block" : "none");

    // --- 交互逻辑 (Highlighting) ---
    // 将 D3 对象暴露给 React Effect 使用，或直接在这里绑定事件
    // 这里直接绑定 D3 事件处理高亮
    
    node.on("mouseenter", (event, d) => {
      setHoveredNode(d);
      
      // 找出连接的节点 ID 和 连线
      const linkedNodeIds = new Set();
      linkedNodeIds.add(d.id);
      
      graphData.links.forEach(l => {
        if (l.source.id === d.id) linkedNodeIds.add(l.target.id);
        if (l.target.id === d.id) linkedNodeIds.add(l.source.id);
      });

      // 样式更新
      node.style("opacity", n => linkedNodeIds.has(n.id) ? 1 : 0.1);
      link.style("stroke", l => (l.source.id === d.id || l.target.id === d.id) ? "#4f46e5" : "#cbd5e1")
          .style("stroke-width", l => (l.source.id === d.id || l.target.id === d.id) ? 2.5 : 1.5)
          .style("opacity", l => (l.source.id === d.id || l.target.id === d.id) ? 1 : 0.1);
      linkLabel.style("opacity", l => (l.source.id === d.id || l.target.id === d.id) ? 1 : 0);
      
      // 高亮当前选中的圆圈
      d3.select(event.currentTarget).select("circle")
        .attr("stroke", "#4f46e5")
        .attr("stroke-width", 4);
    })
    .on("mouseleave", (event, d) => {
      setHoveredNode(null);
      
      // 恢复默认
      node.style("opacity", 1);
      link.style("stroke", "#cbd5e1")
          .style("stroke-width", 1.5)
          .style("opacity", 1);
      linkLabel.style("opacity", 1);
      
      d3.select(event.currentTarget).select("circle")
        .attr("stroke", "#fff")
        .attr("stroke-width", 2);
    });

    // 实时更新位置
    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      linkLabel
        .attr("x", d => (d.source.x + d.target.x) / 2)
        .attr("y", d => (d.source.y + d.target.y) / 2);

      node
        .attr("transform", d => `translate(${d.x},${d.y})`);
    });

    // 拖拽函数
    function dragstarted(event) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

  }, [graphData, onNodeClick]);

  return (
    <div className="w-full h-full relative bg-slate-50/50">
      <svg ref={svgRef} className="w-full h-full" style={{ touchAction: 'none' }}></svg>
      {/* 简单的图例 */}
      <div className="absolute bottom-4 right-4 bg-white/90 p-3 rounded-lg border border-slate-200 shadow-sm text-xs backdrop-blur-sm">
        <div className="font-bold text-slate-500 mb-2">Node Types</div>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(NODE_TYPES).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: v.nodeColor }}></div>
              <span className="text-slate-600">{v.label.split(' ')[0]}</span>
            </div>
          ))}
        </div>
      </div>
      {/* 悬停提示 */}
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


// --- 核心组件：Markdown + KaTeX 混合渲染器 (不变) ---
const RichTextRenderer = ({ content, className = "" }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !window.marked || !window.katex) {
      if(containerRef.current) containerRef.current.innerText = content;
      return;
    }
    const mathBlocks = [];
    let protectedText = content.replace(/\$\$(.*?)\$\$|\$(.*?)\$/gs, (match, blockMath, inlineMath) => {
      const id = `__MATH_${mathBlocks.length}__`;
      mathBlocks.push({ id, tex: blockMath || inlineMath, display: !!blockMath });
      return id;
    });
    let html = window.marked.parse(protectedText);
    mathBlocks.forEach(item => {
      let renderedMath = "";
      try {
        renderedMath = window.katex.renderToString(item.tex, { throwOnError: false, displayMode: item.display });
      } catch (e) { renderedMath = `<span class="text-red-500 error">LaTeX Error</span>`; }
      html = html.replace(item.id, renderedMath);
    });
    html = html.replace(/\[(\d+)\]/g, (match, num) => {
      return `<a href="#ref-${num}" class="ref-link inline-block px-1 rounded text-indigo-600 bg-indigo-50 hover:bg-indigo-100 font-mono text-xs cursor-pointer select-none" onclick="event.stopPropagation(); const el = document.getElementById('ref-${num}'); if(el){ el.scrollIntoView({behavior: 'smooth'}); el.classList.add('bg-yellow-100'); setTimeout(()=>el.classList.remove('bg-yellow-100'), 2000); } return false;">[${num}]</a>`;
    });
    containerRef.current.innerHTML = html;
  }, [content]);
  return <div ref={containerRef} className={`markdown-body ${className}`} />;
};


// --- 核心组件：通用可编辑块 (不变) ---
const EditableBlock = ({ label, value, onChange, type = 'text', placeholder = '点击编辑...', variant = 'default', className = '' }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);
  const inputRef = useRef(null);
  useEffect(() => { setTempValue(value); }, [value]);
  useEffect(() => { if (isEditing && inputRef.current) inputRef.current.focus(); }, [isEditing]);
  const handleSave = () => { setIsEditing(false); if (tempValue !== value) onChange(tempValue); };
  const handleKeyDown = (e) => {
    if (type === 'text' || type === 'tags') { if (e.key === 'Enter') handleSave(); } 
    else { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave(); }
  };
  const handleContainerClick = (e) => {
    if (isEditing) return;
    if (e.target.tagName === 'A' || e.target.closest('a') || e.target.closest('.ref-link')) return;
    const selection = window.getSelection();
    if (selection.toString().length > 0) return;
    setIsEditing(true);
  };
  const containerStyles = {
    core: "bg-white border-2 border-indigo-100 shadow-sm p-6 rounded-xl",
    simple: "bg-white border border-slate-200 p-4 rounded-lg shadow-sm",
    subtle: "bg-transparent border-b border-transparent hover:border-slate-200 p-2",
  }[variant] || "bg-white p-4 border rounded";
  const labelStyles = "block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2";
  const renderView = () => {
    if (!value || (Array.isArray(value) && value.length === 0)) return <div className="text-slate-400 italic text-sm cursor-text hover:text-slate-500 transition-colors">{placeholder}</div>;
    switch (type) {
      case 'latex': return (<div className="group relative min-h-[3rem] flex items-center justify-center bg-slate-50/50 rounded border border-slate-100 hover:border-indigo-300 transition-colors cursor-pointer py-6"><div dangerouslySetInnerHTML={{ __html: window.katex ? window.katex.renderToString(value, { displayMode: true, throwOnError: false }) : value }} className="text-xl text-slate-800" /><div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"><Edit3 className="w-4 h-4 text-indigo-400" /></div></div>);
      case 'tags': return (<div className="flex flex-wrap gap-2">{Array.isArray(value) && value.map((tag, i) => (<span key={i} className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-yellow-50 text-yellow-700 border border-yellow-200">{tag}</span>))}</div>);
      case 'markdown': return <RichTextRenderer content={value} className="prose prose-sm max-w-none text-slate-700" />;
      case 'references': const refs = value.split('\n').filter(r => r.trim()); if (refs.length === 0) return <div className="text-slate-400 italic text-sm">{placeholder}</div>; return (<ol className="list-decimal list-outside ml-4 space-y-2 text-sm text-slate-600">{refs.map((ref, idx) => (<li key={idx} id={`ref-${idx + 1}`} className="pl-2 transition-colors duration-500 rounded p-1"><RichTextRenderer content={ref} className="inline-block" /></li>))}</ol>);
      default: return <div className="text-base font-medium text-slate-800">{value}</div>;
    }
  };
  const renderEdit = () => {
    switch (type) {
      case 'markdown': case 'references': return (<div className="relative"><textarea ref={inputRef} className="w-full min-h-[160px] p-3 text-sm bg-white border border-indigo-500 rounded shadow-inner focus:ring-2 focus:ring-indigo-200 outline-none resize-y font-mono leading-relaxed" value={tempValue} onChange={(e) => setTempValue(e.target.value)} onBlur={handleSave} onKeyDown={handleKeyDown} placeholder={type === 'references' ? "每行输入一条参考文献..." : placeholder} /><div className="absolute bottom-2 right-2 text-[10px] text-slate-400 bg-white/80 px-1 rounded border border-slate-100">{type === 'references' ? '每行一条 · 支持 Markdown' : '支持 Markdown & LaTeX ($...$)'}</div></div>);
      case 'tags': return (<input ref={inputRef} type="text" className="w-full p-2 text-sm bg-white border border-indigo-500 rounded shadow-sm focus:ring-2 focus:ring-indigo-200 outline-none" value={Array.isArray(tempValue) ? tempValue.join(', ') : tempValue} onChange={(e) => setTempValue(e.target.value.split(/,\s*/).filter(Boolean))} onBlur={handleSave} onKeyDown={handleKeyDown} placeholder="输入标签，用逗号分隔..." />);
      default: return (<input ref={inputRef} type="text" className="w-full p-2 text-sm bg-white border border-indigo-500 rounded shadow-sm focus:ring-2 focus:ring-indigo-200 outline-none font-mono" value={tempValue} onChange={(e) => setTempValue(e.target.value)} onBlur={handleSave} onKeyDown={handleKeyDown} placeholder={placeholder} />);
    }
  };
  return (<div className={`${containerStyles} ${className} transition-all duration-200`}>{label && <label className={labelStyles}>{label}</label>}<div onClick={handleContainerClick} className="cursor-pointer min-h-[20px]">{isEditing ? renderEdit() : renderView()}</div></div>);
};


export default function PhysMemosApp() {
  const [nodes, setNodes] = useState([]);
  const [activeNodeId, setActiveNodeId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showOcrPanel, setShowOcrPanel] = useState(false);
  const [viewMode, setViewMode] = useState('editor'); // 'editor' | 'graph'
  
  const [ocrText, setOcrText] = useState(""); 
  const [newRelTargetId, setNewRelTargetId] = useState("");
  const [newRelType, setNewRelType] = useState("DERIVES_FROM");
  const [newRelCondition, setNewRelCondition] = useState("");

  useEffect(() => {
    const link = document.createElement('link'); link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"; link.rel = "stylesheet"; document.head.appendChild(link);
    const scriptKatex = document.createElement('script'); scriptKatex.src = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"; document.head.appendChild(scriptKatex);
    const scriptMarked = document.createElement('script'); scriptMarked.src = "https://cdn.jsdelivr.net/npm/marked/marked.min.js"; document.head.appendChild(scriptMarked);
    const scriptD3 = document.createElement('script'); scriptD3.src = "https://d3js.org/d3.v7.min.js"; document.head.appendChild(scriptD3);
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await dbHelper.getAll();
      if (data.length === 0) {
        // --- 完整规范数据集 (保持不变) ---
        const initialData = [
          {
            id: 'fd1',
            topic: '流体力学 (Fluid Dynamics)',
            title: '伯努利原理 (Bernoulli Principle)',
            type: 'LAW',
            latex: 'P + \\frac{1}{2}\\rho v^2 + \\rho gh = \\text{Constant}',
            desc: '流体动力学中的能量守恒表述。即对于不可压缩、无粘流体，沿流线的总能量密度保持不变。\n\n> 局限性：不适用于粘性流体（需考虑粘滞耗散）或可压缩流体（需考虑内能变化）。',
            references: "Landau, L. D., & Lifshitz, E. M. (2013). *Fluid Mechanics*. Elsevier.\nBatchelor, G. K. (2000). *An introduction to fluid dynamics*.",
            constraints: ['无粘 (Inviscid)', '不可压缩 (Incompressible)', '定常流 (Steady)'],
            relations: []
          },
          {
            id: 'fd2',
            topic: '流体力学 (Fluid Dynamics)',
            title: '托里拆利定律 (Torricelli Law)',
            type: 'FORMULA',
            latex: 'v_{out} = \\sqrt{2gh}',
            desc: '描述敞口容器底部小孔的出流速度。本质上是重力势能完全转化为动能的理想情况 [1]。',
            references: "Torricelli, E. (1643). *De motu gravium naturaliter descendentium*.",
            constraints: ['敞口容器 (Open Tank)', '液面准静态 (v_top ≈ 0)'],
            relations: [{ targetId: 'fd1', type: 'SPECIAL_CASE', condition: '假设顶部与出口压强均为大气压 $P_{atm}$' }]
          },
          {
            id: 'gp1',
            topic: '颗粒物理 (Granular Physics)',
            title: '堵塞拱模型 (Clogging Arch)',
            type: 'MODEL',
            latex: 'P_{clog} \\propto \\exp\\left(-\\frac{D}{d}\\right)', 
            desc: '颗粒流流出孔口前形成的亚稳态结构。多个颗粒相互挤压形成拱桥，承担上方压力，导致流动中断。只有破坏拱结构（如振动）才能恢复流动 [1]。',
            references: "Zuriguel, I., et al. (2005). Jamming during the discharge of granular matter from a silo. *Physical Review E*.",
            constraints: ['干颗粒 (Dry Grains)', '拥塞状态 (Jamming)'],
            relations: []
          },
          {
            id: 'gp2',
            topic: '颗粒物理 (Granular Physics)',
            title: 'Beverloo 流量公式',
            type: 'LAW',
            latex: 'W = C \\rho_{bulk} \\sqrt{g} (D - kd)^{2.5}',
            desc: '著名的颗粒流流量经验公式。与流体 ($D^2$) 不同，颗粒流流量遵循 $D^{2.5}$ 缩放律。\n\n**物理机制**：\n提出 **"Empty Annulus" (空环)** 概念，即由于颗粒的离散性，孔口边缘 $k \\cdot d$ 宽度的区域没有有效流量贡献 [1]。',
            references: "Beverloo, W. A., Leniger, H. A., & Van de Velde, J. (1961). The flow of granular solids through orifices. *Chemical Engineering Science*.",
            constraints: ['粗颗粒 (Coarse Grains)', '重力驱动 (Gravity)'],
            relations: [
              { targetId: 'gp1', type: 'EMPIRICAL_FIT', condition: '基于空环假设对实验数据的拟合' },
              { targetId: 'fd2', type: 'CONTRADICTS', condition: '流体遵循 $\\sqrt{H}$ 压力依赖，而颗粒流流量与筒仓高度 $H$ 无关（Janssen 效应）' }
            ]
          },
          {
            id: 'gp3',
            topic: '颗粒物理 (Granular Physics)',
            title: 'Alonso et al. (2021)',
            type: 'EVIDENCE',
            latex: '\\mu(P) = \\mu_0 + \\frac{\\mu_1 - \\mu_0}{1 + P_0/P}',
            desc: '在离心机实验中发现 Beverloo 定律在高重力环境下失效。随着有效重力 $g_{eff}$ 增加，流量不再随 $\\sqrt{g}$ 无限增长，而是趋于饱和。\n\n> 原因：高压强下颗粒间摩擦系数 $\\mu$ 增加（压力相关摩擦），导致流变性改变 [1]。',
            references: "Alonso-Marroquin, F., et al. (2021). Granular flow in high gravity. *Journal of Fluid Mechanics*.",
            constraints: ['离心机实验 (Centrifuge)', '高重力 (High-G > 10g)'],
            relations: [
              { targetId: 'gp2', type: 'CONTRADICTS', condition: '当 $g_{eff}$ 极高时，流量不再符合 Beverloo 的 $\\sqrt{g}$ 预测' },
              { targetId: 'gp2', type: 'MODIFIES', condition: '提出了压力相关的摩擦修正项' }
            ]
          }
        ];
        for (let item of initialData) await dbHelper.put(item);
        setNodes(initialData);
        setActiveNodeId('fd1');
      } else {
        setNodes(data);
        if (data.length > 0) setActiveNodeId(data[0].id);
      }
    } catch (err) { console.error("DB Error:", err); }
  };

  const saveNode = async (node) => { setNodes(prev => prev.map(n => n.id === node.id ? node : n)); await dbHelper.put(node); };
  const handleCreateNode = async () => { const newNode = { id: crypto.randomUUID(), topic: '未分类 (Uncategorized)', title: '新物理概念', type: 'FORMULA', latex: '', desc: '', references: '', constraints: [], relations: [] }; await dbHelper.put(newNode); setNodes(prev => [...prev, newNode]); setActiveNodeId(newNode.id); };
  const handleExport = () => { const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(nodes, null, 2)); const a = document.createElement('a'); a.href = dataStr; a.download = "phys_memos_dataset.json"; document.body.appendChild(a); a.click(); a.remove(); };
  const addRelation = () => { if (!newRelTargetId || !activeNode) return; const newRel = { targetId: newRelTargetId, type: newRelType, condition: newRelCondition }; saveNode({ ...activeNode, relations: [...(activeNode.relations || []), newRel] }); setNewRelCondition(""); };
  const removeRelation = (idx) => { const newRels = activeNode.relations.filter((_, i) => i !== idx); saveNode({...activeNode, relations: newRels}); };
  const simulateOCR = () => { setOcrText("识别中..."); setTimeout(() => { setOcrText("W = C \\rho \\sqrt{g_{eff}} (D - kd)^{2.5}"); }, 600); };
  const activeNode = nodes.find(n => n.id === activeNodeId);
  const filteredNodes = nodes.filter(n => { const q = searchQuery.toLowerCase(); return (n.title.toLowerCase().includes(q) || n.type.toLowerCase().includes(q) || (n.topic && n.topic.toLowerCase().includes(q)) || (n.constraints && n.constraints.some(c => c.toLowerCase().includes(q)))); });

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

      {/* --- 左侧边栏 --- */}
      <div className={`${sidebarOpen ? 'w-80' : 'w-0'} transition-all duration-300 bg-white border-r border-slate-200 flex flex-col z-20 shadow-[4px_0_24px_rgba(0,0,0,0.02)]`}>
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white">
          <h1 className="font-bold text-lg flex items-center gap-2 text-slate-800 tracking-tight">
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
            <input type="text" placeholder="搜索概念、领域、标签..." className="w-full pl-9 pr-3 py-2 bg-slate-50 border-none rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white transition-all" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {filteredNodes.map(node => (
            <div key={node.id} onClick={() => { setActiveNodeId(node.id); setViewMode('editor'); }} className={`group px-4 py-3 border-b border-slate-50 cursor-pointer transition-all hover:bg-slate-50 ${activeNodeId === node.id ? 'bg-indigo-50/60 border-l-4 border-l-indigo-500' : 'border-l-4 border-l-transparent'}`}>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-1"><Layers className="w-3 h-3" />{node.topic || '未分类'}</div>
              <div className="flex justify-between items-start mb-1.5">
                <span className={`font-semibold text-sm truncate w-40 ${activeNodeId === node.id ? 'text-indigo-900' : 'text-slate-700'}`}>{node.title}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${NODE_TYPES[node.type]?.color} scale-95 origin-right`}>{NODE_TYPES[node.type]?.label.split(' ')[0]}</span>
              </div>
              <div className="flex flex-wrap gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                {(node.constraints || []).slice(0, 3).map((c, i) => (<span key={i} className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-sm">{c}</span>))}
              </div>
            </div>
          ))}
        </div>

        {/* 底部功能区：模式切换与工具 */}
        <div className="p-3 border-t border-slate-100 flex flex-col gap-2 bg-slate-50/50">
          <div className="flex gap-2">
            <button onClick={() => setViewMode('editor')} className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition ${viewMode === 'editor' ? 'bg-white border border-indigo-200 text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-white/50'}`}>
              <FileText className="w-4 h-4" /> 编辑
            </button>
            <button onClick={() => setViewMode('graph')} className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition ${viewMode === 'graph' ? 'bg-white border border-indigo-200 text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-white/50'}`}>
              <Network className="w-4 h-4" /> 图谱
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreateNode} className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 text-sm font-medium shadow-sm transition"><Plus className="w-4 h-4" /> 新建</button>
            <button onClick={handleExport} className="px-3 text-slate-400 hover:text-slate-600 bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition" title="导出完整数据集"><Download className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {/* --- 主工作区 --- */}
      <div className="flex-1 flex flex-col h-full relative bg-white">
        
        {viewMode === 'graph' ? (
          /* --- 图谱视图 --- */
          <KnowledgeGraph 
            nodes={nodes} 
            activeNodeId={activeNodeId} 
            onNodeClick={(id) => { setActiveNodeId(id); setViewMode('editor'); }} 
          />
        ) : (
          /* --- 编辑器视图 (保持不变) --- */
          <>
            <div className="h-24 bg-white border-b border-slate-100 flex flex-col justify-center px-8 z-10 space-y-2">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                   {!sidebarOpen && (<button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-slate-50 rounded-full text-slate-400 transition"><ArrowRight className="w-5 h-5" /></button>)}
                   {activeNode && (
                     <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                       <Layers className="w-3.5 h-3.5 text-indigo-400" /><span className="font-bold text-slate-400">领域:</span>
                       <input list="domain-suggestions" className="bg-transparent border-none focus:ring-0 p-0 text-slate-700 font-medium w-48 placeholder-slate-300" value={activeNode.topic} onChange={(e) => saveNode({...activeNode, topic: e.target.value})} placeholder="例如: 颗粒物理" />
                       <datalist id="domain-suggestions">{PRESET_DOMAINS.map(d => <option key={d} value={d} />)}</datalist>
                     </div>
                   )}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowOcrPanel(!showOcrPanel)} className={`flex items-center gap-2 px-4 py-1.5 text-xs font-medium rounded-full transition border ${showOcrPanel ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}><Crop className="w-3.5 h-3.5" /><span>OCR 辅助阅读</span></button>
                  {activeNode && (<button onClick={() => { if(window.confirm('确定删除吗？')) { /* delete */ }}} className="text-slate-300 hover:text-red-500 p-2 hover:bg-red-50 rounded-full transition"><Trash2 className="w-4 h-4" /></button>)}
                </div>
              </div>
              {activeNode ? (
                <div className="flex items-center gap-4 w-full">
                   <input type="text" value={activeNode.title} onChange={(e) => saveNode({...activeNode, title: e.target.value})} className="text-2xl font-bold text-slate-800 bg-transparent border-none focus:outline-none focus:ring-0 placeholder-slate-300 min-w-[200px]" placeholder="输入概念标题..." />
                   <div className="relative"><select value={activeNode.type} onChange={(e) => saveNode({...activeNode, type: e.target.value})} className="appearance-none pl-3 pr-8 py-1 text-xs font-medium border border-slate-200 rounded-full bg-slate-50 hover:bg-white transition cursor-pointer focus:ring-2 focus:ring-indigo-100 outline-none text-slate-600">{Object.keys(NODE_TYPES).map(key => (<option key={key} value={key}>{NODE_TYPES[key].label}</option>))}</select><div className="absolute right-2.5 top-1.5 pointer-events-none text-slate-400"><ArrowRight className="w-3 h-3 rotate-90" /></div></div>
                </div>
              ) : <span className="text-slate-300 font-medium">请在左侧选择或新建条目</span>}
            </div>

            {activeNode ? (
              <div className="flex-1 overflow-y-auto bg-slate-50/30">
                <div className="max-w-4xl mx-auto p-8 space-y-6">
                  <EditableBlock label="核心定义 / 数学形式 (LaTeX)" value={activeNode.latex} onChange={(val) => saveNode({...activeNode, latex: val})} type="latex" variant="core" placeholder="在此输入 LaTeX 公式..." />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-1"><EditableBlock label="适用范围 / 约束域 (Strict)" value={activeNode.constraints} onChange={(val) => saveNode({...activeNode, constraints: val})} type="tags" variant="simple" className="h-full" placeholder="添加约束条件..." /></div>
                    <div className="md:col-span-2"><EditableBlock label="物理内涵 / 笔记 / 摘要" value={activeNode.desc} onChange={(val) => saveNode({...activeNode, desc: val})} type="markdown" variant="simple" className="h-full" placeholder="记录推导思路... (支持 Markdown)" /></div>
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-2 mb-6"><GitCommit className="w-5 h-5 text-indigo-500" /><span className="text-xs font-bold text-slate-400 uppercase tracking-wider">逻辑关联与推演 (Relationships)</span></div>
                    <div className="flex flex-wrap gap-2 mb-6 bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <select value={newRelType} onChange={e => setNewRelType(e.target.value)} className="text-xs border-slate-200 rounded shadow-sm py-1.5 px-2 font-medium bg-white focus:ring-indigo-500 focus:border-indigo-500 outline-none">{Object.entries(RELATION_TYPES).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}</select>
                      <select value={newRelTargetId} onChange={e => setNewRelTargetId(e.target.value)} className="text-xs border-slate-200 rounded shadow-sm py-1.5 px-2 flex-1 bg-white focus:ring-indigo-500 focus:border-indigo-500 outline-none"><option value="">选择关联对象...</option>{nodes.filter(n => n.id !== activeNode.id).map(n => (<option key={n.id} value={n.id}>{n.title}</option>))}</select>
                      <input type="text" placeholder="条件说明..." value={newRelCondition} onChange={e => setNewRelCondition(e.target.value)} className="text-xs border-slate-200 rounded shadow-sm py-1.5 px-3 flex-[1.5] focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
                      <button onClick={addRelation} disabled={!newRelTargetId} className="text-xs bg-indigo-600 text-white px-4 py-1.5 rounded font-medium hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition">连接</button>
                    </div>
                    <div className="space-y-4">
                      {(activeNode.relations || []).length === 0 ? (<div className="text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200"><p className="text-slate-400 text-sm">暂无逻辑关联</p></div>) : ((activeNode.relations || []).map((rel, idx) => {
                          const target = nodes.find(n => n.id === rel.targetId);
                          const typeConfig = RELATION_TYPES[rel.type] || RELATION_TYPES.DERIVES_FROM;
                          return (<div key={idx} className="group relative pl-8 pb-1 border-l-2 border-slate-200 last:border-0 hover:border-indigo-200 transition-colors"><div className={`absolute -left-[9px] top-3 w-4 h-4 bg-white rounded-full border-2 border-slate-300 group-hover:border-indigo-400 transition-colors`}></div><div className="flex flex-col sm:flex-row sm:items-start gap-3 bg-white p-3 rounded-lg border border-slate-100 hover:shadow-md transition-all hover:border-indigo-100"><div className={`flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-md bg-slate-50 border border-slate-100 ${typeConfig.color} min-w-fit mt-0.5`}><span>{typeConfig.icon}</span><span>{typeConfig.label}</span></div><div className="flex-1 min-w-0"><div className="flex items-baseline justify-between"><span className="text-sm font-semibold text-slate-700 hover:text-indigo-600 cursor-pointer truncate" onClick={() => { if(target) { setActiveNodeId(target.id); } }}>{target ? target.title : '未知对象'}</span><button onClick={() => removeRelation(idx)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 p-1 transition-all"><X className="w-3.5 h-3.5" /></button></div>{rel.condition && (<div className="mt-1 text-xs text-slate-500 flex items-start gap-1"><span className="text-indigo-400 italic font-serif">if</span><span className="bg-yellow-50 px-1.5 rounded text-yellow-700 border border-yellow-100/50">{rel.condition}</span></div>)}</div></div></div>);
                      }))}
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm"><div className="flex items-center gap-2 mb-4"><Hash className="w-4 h-4 text-indigo-500" /><span className="text-xs font-bold text-slate-400 uppercase tracking-wider">参考文献 (References)</span></div><EditableBlock label="" value={activeNode.references} onChange={(val) => saveNode({...activeNode, references: val})} type="references" variant="subtle" className="bg-slate-50/50 rounded-lg border border-slate-100" placeholder="输入参考文献列表..." /></div>
                </div>
              </div>
            ) : (<div className="flex-1 flex flex-col items-center justify-center text-slate-300 bg-slate-50/30"><Database className="w-20 h-20 mb-6 text-slate-200" /><p className="text-lg font-medium text-slate-400">选择一个物理概念进行编辑</p></div>)}
          </>
        )}
      </div>

      {/* --- OCR Panel (不变) --- */}
      {showOcrPanel && (
        <div className="w-96 border-l border-slate-200 bg-white flex flex-col shadow-2xl z-30 animate-in slide-in-from-right-10 duration-300">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center backdrop-blur-sm"><h3 className="font-bold text-sm text-slate-700 flex items-center gap-2"><Book className="w-4 h-4 text-indigo-500" />文献阅读 / OCR 提取</h3><button onClick={() => setShowOcrPanel(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-200/50"><Maximize className="w-4 h-4" /></button></div>
          <div className="p-5 flex-1 overflow-y-auto">
            <div className="border-2 border-dashed border-slate-200 rounded-xl h-56 bg-slate-50 flex flex-col items-center justify-center mb-6 relative group cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-all" onClick={simulateOCR}><div className="p-4 bg-white rounded-full shadow-sm mb-3 group-hover:scale-110 transition-transform"><Crop className="w-6 h-6 text-indigo-500" /></div><span className="text-sm font-medium text-slate-500">点击模拟框选公式</span><span className="text-xs text-slate-400 mt-1">支持 PDF 截图或手写笔记</span></div>
            {ocrText && (<div className="bg-white border border-indigo-100 shadow-lg shadow-indigo-500/5 rounded-xl p-4 animate-in fade-in slide-in-from-bottom-4 duration-500"><div className="flex items-center justify-between mb-2"><span className="text-xs font-bold text-indigo-600 uppercase tracking-wide">识别结果</span><span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">置信度 98%</span></div><div className="bg-slate-50 p-3 rounded-lg border border-slate-100 mb-4 group relative"><code className="text-xs font-mono text-slate-700 break-all block">{ocrText}</code></div><div className="grid grid-cols-2 gap-3"><button onClick={() => activeNode && saveNode({...activeNode, latex: ocrText})} className="flex items-center justify-center gap-1.5 text-xs bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 font-medium transition shadow-sm"><ArrowRight className="w-3 h-3" /> 填入公式</button><button onClick={() => activeNode && saveNode({...activeNode, desc: activeNode.desc + '\n\n> OCR 来源备注: ' + ocrText})} className="flex items-center justify-center gap-1.5 text-xs bg-white border border-slate-200 text-slate-600 py-2 rounded-lg hover:bg-slate-50 font-medium transition"><Plus className="w-3 h-3" /> 追加笔记</button></div></div>)}
          </div>
        </div>
      )}
    </div>
  );
}