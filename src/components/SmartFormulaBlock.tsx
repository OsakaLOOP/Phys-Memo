import React, { useState, useRef, useMemo, type FC } from 'react';
import EditableBlock, { type EditableBlockProps } from './EditableBlock';
import { parseFormula } from '../utils/latexParser';
import RichTextRenderer from './RichTextRenderer';
import { Info } from 'lucide-react';

const SmartFormulaBlock: FC<EditableBlockProps> = (props) => {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Parse when value changes using useMemo to avoid effect/state loop
  const parsedData = useMemo(() => {
    if (typeof props.value === 'string' && props.type === 'latex') {
      return parseFormula(props.value);
    }
    return [];
  }, [props.value, props.type]);

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

  return (
    <div className="relative group/smart-block">
      <EditableBlock
        {...props}
        onEditStateChange={(editing) => {
           setIsEditing(editing);
           if (editing) setShowAnalysis(false);
        }}
      />

      {!isEditing && props.type === 'latex' && parsedData.length > 0 && (
         <div
            className="absolute top-0 right-0 z-20"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
         >
            <button
              ref={buttonRef}
              className="p-2 text-slate-400 hover:text-indigo-600 transition-colors bg-white/50 backdrop-blur-sm rounded-bl-xl border-l border-b border-transparent hover:border-slate-200"
            >
               <Info className="w-4 h-4" />
            </button>

            {/* Modal */}
            {showAnalysis && (
               <div
                  ref={modalRef}
                  className="absolute top-8 right-0 w-80 max-h-96 bg-white shadow-xl rounded-xl border border-indigo-100 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 origin-top-right"
                  style={{ zIndex: 100 }}
               >
                  <div className="p-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                     <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Formula Analysis</span>
                     <span className="text-[10px] text-slate-400">{parsedData.reduce((acc, c) => acc + c.instances.length, 0)} vars detected</span>
                  </div>
                  <div className="overflow-y-auto p-0 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
                     <table className="w-full text-left border-collapse">
                        <thead>
                           <tr className="bg-white sticky top-0 z-10 text-[10px] font-bold text-slate-400 uppercase border-b border-slate-100">
                              <th className="py-2 px-4 w-1/4">Type</th>
                              <th className="py-2 px-4">Instances (Context)</th>
                           </tr>
                        </thead>
                        <tbody className="text-sm text-slate-700 divide-y divide-slate-50">
                           {parsedData.map((category) => (
                              <tr key={category.type} className="group hover:bg-slate-50/50 transition-colors">
                                 <td className="py-3 px-4 align-top border-r border-slate-50 bg-slate-50/30">
                                    <div className="font-serif italic font-bold text-indigo-900 bg-indigo-50/50 inline-block px-2 py-1 rounded">
                                       <RichTextRenderer content={`$${category.type}$`} className="inline-block" />
                                    </div>
                                 </td>
                                 <td className="py-3 px-4">
                                    <div className="flex flex-wrap gap-2">
                                       {category.instances.map(inst => (
                                          <span key={inst.uuid} className="px-2 py-1 bg-white border border-slate-200 rounded shadow-sm text-slate-800 hover:border-indigo-300 transition-colors">
                                             <RichTextRenderer content={`$${inst.latex}$`} className="inline-block" />
                                          </span>
                                       ))}
                                    </div>
                                 </td>
                              </tr>
                           ))}
                           {parsedData.length === 0 && (
                              <tr>
                                 <td colSpan={2} className="py-8 text-center text-slate-400 italic text-xs">
                                    No variables detected.
                                 </td>
                              </tr>
                           )}
                        </tbody>
                     </table>
                  </div>
               </div>
            )}
         </div>
      )}
    </div>
  );
};

export default SmartFormulaBlock;
