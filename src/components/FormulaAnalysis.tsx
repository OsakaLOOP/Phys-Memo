import { useState, useRef, useEffect, type FC } from 'react';
import { parseFormula, type ParsedCategory } from '../utils/latexParser';
import katex from 'katex';
import { Info } from 'lucide-react';

interface FormulaAnalysisProps {
  latex: string;
}

const FormulaAnalysis: FC<FormulaAnalysisProps> = ({ latex }) => {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedCategory[]>([]);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Parse when latex changes
  useEffect(() => {
    if (latex) {
      const data = parseFormula(latex);
      setParsedData(data);
    }
  }, [latex]);

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setShowAnalysis(true);
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setShowAnalysis(false);
    }, 200);
  };

  if (parsedData.length === 0) return null;

  return (
    <div
      className="absolute top-0 right-0 z-20"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={buttonRef}
        className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors bg-white/80 backdrop-blur-sm rounded-bl-lg border-l border-b border-transparent hover:border-slate-200 shadow-sm"
        title="公式模板解析"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Info className="w-3.5 h-3.5" />
      </button>

      {/* Modal */}
      {showAnalysis && (
        <div
          ref={modalRef}
          className="absolute top-8 right-0 w-80 max-h-96 bg-white shadow-xl rounded-xl border border-indigo-100 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 origin-top-right"
          style={{ zIndex: 100 }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="p-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">公式模板解析 / PARSING</span>
            <span className="text-[10px] text-slate-400">已解析共 {parsedData.reduce((acc, c) => acc + c.instances.length, 0)} 个变量</span>
          </div>
          <div className="overflow-y-auto p-0 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white sticky top-0 z-10 text-[10px] font-bold text-slate-400 uppercase border-b border-slate-100">
                  <th className="py-2 px-4 w-1/5 text-nowrap">基/BASE</th>
                  <th className="py-2 px-4">变体实例 / INSTANCES</th>
                </tr>
              </thead>
              <tbody className="text-sm text-slate-700 divide-y divide-slate-50">
                {parsedData.map((category) => (
                  <tr key={category.type} className="group hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 px-4 align-top border-r border-slate-50 bg-slate-50/30">
                      <div
                        className="font-serif italic font-bold text-indigo-900 bg-indigo-50/50 inline-block px-2 py-1 rounded"
                        dangerouslySetInnerHTML={{
                          __html: katex.renderToString(category.type, { throwOnError: false })
                        }}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-2">
                        {category.instances.map(inst => (
                          <InstanceItem key={inst.uuid} latex={inst.latex} />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

interface InstanceItemProps {
  latex: string;
}

const InstanceItem: FC<InstanceItemProps> = ({ latex }) => {
  const [showSource, setShowSource] = useState(false);

  return (
    <span
      className="px-2 py-1 bg-white border border-slate-200 rounded shadow-sm text-slate-800 hover:border-indigo-300 transition-colors cursor-pointer select-none hover:bg-slate-50"
      onClick={(e) => {
        e.stopPropagation();
        setShowSource(!showSource);
      }}
      title={showSource ? "Click to render" : "Click to view source"}
    >
      {showSource ? (
        <code className="text-[10px] font-mono text-indigo-600 bg-indigo-50 px-1 rounded">{latex}</code>
      ) : (
        <span dangerouslySetInnerHTML={{
          __html: katex.renderToString(latex, { throwOnError: false })
        }} />
      )}
    </span>
  );
};

export default FormulaAnalysis;
