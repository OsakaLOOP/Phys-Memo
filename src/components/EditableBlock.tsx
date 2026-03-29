import React, { useState, useEffect, useRef, type FC, type ChangeEvent, type KeyboardEvent, type Ref } from 'react';
import { Edit3 } from 'lucide-react';
import RichTextRenderer from './RichTextRenderer';

// --- Editable Block Component ---

export interface EditableBlockProps {
  label?: string;
  value: string | string[];
  onChange: (value: string | string[]) => void;
  type?: 'text' | 'tags' | 'markdown' | 'latex' | 'references';
  placeholder?: string;
  variant?: 'default' | 'simple' | 'core' | 'subtle';
  className?: string;
  onEditStateChange?: (isEditing: boolean) => void;
  enableAnalysis?: boolean;
}

const EditableBlock: FC<EditableBlockProps> = ({
  label,
  value,
  onChange,
  type = 'text',
  placeholder = '点击编辑...',
  variant = 'default',
  className = '',
  onEditStateChange,
  enableAnalysis = false
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState<string | string[]>(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setTempValue(value);
  }, [value]);

  useEffect(() => {
    if (onEditStateChange) onEditStateChange(isEditing);
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing, onEditStateChange]);

  const handleSave = () => {
    setIsEditing(false);
    if (tempValue !== value) {
      onChange(tempValue);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (type === 'text' || type === 'tags') {
      if (e.key === 'Enter') handleSave();
    } else {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
    }
  };

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isEditing) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' || target.closest('a') || target.closest('.ref-link')) return;
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;// 选中文本时不进入编辑
    setIsEditing(true);
  };

  const containerStyles: Record<string, string> = {
    core: "bg-white border-2 border-indigo-100 shadow-sm p-6 rounded-xl",
    simple: "bg-white border border-slate-200 p-4 rounded-lg shadow-sm",
    subtle: "bg-transparent border-b border-transparent hover:border-slate-200 p-2",
  };

  const labelStyles = "block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex-center-gap";

  const renderView = () => {
    if (!value || (Array.isArray(value) && value.length === 0)) {
      return <div className="text-slate-400 italic text-sm cursor-text hover:text-slate-500 transition-colors">{placeholder}</div>;
    }

    switch (type) {
      case 'latex': {
        const strValue = value as string;
        // Wrap in $$ if not already wrapped, to ensure KaTeX rendering for raw formulas
        const content = (strValue.trim().startsWith('$') || strValue.trim().startsWith('\\['))
          ? strValue
          : `$$${strValue}$$`;

        return (
          <div className="group relative min-h-[3rem] bg-slate-50/50 rounded border border-slate-100 hover:border-indigo-300 transition-all duration-300 cursor-pointer py-6 px-2 text-lg">
            <RichTextRenderer content={content} className="text-slate-800 [&_.katex-display]:my-0" enableAnalysis={enableAnalysis} />
            <div className="absolute top-2 right-2 opacity-0 translate-x-1 -translate-y-1 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
              <Edit3 className="w-4 h-4 text-indigo-400" />
            </div>
          </div>
        );
      }
      case 'tags':
        return (
          <div className="flex flex-wrap gap-2">
            {Array.isArray(value) && value.map((tag, i) => (
              <span key={i} className="inline-flex-center badge-base bg-yellow-50 text-yellow-700 border-yellow-200 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm hover:scale-105">
                <RichTextRenderer content={tag} className="inline-block [&>p]:inline [&>p]:m-0" />
              </span>
            ))}
          </div>
        );
      case 'markdown':
        return <RichTextRenderer content={value as string} className="prose prose-sm max-w-none text-slate-700" enableAnalysis={enableAnalysis} />;
      case 'references': {
        const refs = (value as string).split('\n').filter(r => r.trim());
        if (refs.length === 0) return <div className="text-slate-400 italic text-sm">{placeholder}</div>;
        return (
          <ol className="list-decimal list-outside ml-4 space-y-2 text-sm text-slate-600">
            {refs.map((ref, idx) => (
              <li key={idx} id={`ref-${idx + 1}`} className="pl-2 transition-colors duration-500 rounded p-1">
                <RichTextRenderer content={ref} className="inline-block" />
              </li>
            ))}
          </ol>
        );
      }
      default:
        return <div className="text-base font-medium text-slate-800">{value}</div>;
    }
  };

  const renderEdit = () => {
    switch (type) {
      case 'markdown':
      case 'references':
      case 'latex':
        return (
          <div className="relative">
            <textarea
              ref={inputRef as Ref<HTMLTextAreaElement>}
              className="w-full min-h-[160px] p-3 text-sm bg-white border border-indigo-500 rounded shadow-inner focus:ring-2 focus:ring-indigo-200 outline-none resize-y font-mono leading-relaxed"
              value={tempValue as string}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setTempValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              placeholder={type === 'references' ? "每行输入一条参考文献..." : placeholder}
            />
            <div className="absolute bottom-2 right-2 text-[10px] text-slate-400 bg-white/80 px-1 rounded border border-slate-100">
              {type === 'references' ? '每行一条 · 支持 Markdown' : '支持 Markdown & LaTeX ($...$)'}
            </div>
          </div>
        );
      case 'tags':
        return (
          <input
            ref={inputRef as Ref<HTMLInputElement>}
            type="text"
            className="w-full p-2 text-sm input-bordered border-indigo-500 rounded"
            value={Array.isArray(tempValue) ? tempValue.join(', ') : tempValue}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTempValue(e.target.value.split(/,\s*/).filter(Boolean))}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            placeholder="输入标签，用逗号分隔..."
          />
        );
      default:
        return (
          <input
            ref={inputRef as Ref<HTMLInputElement>}
            type="text"
            className="w-full p-2 text-sm input-bordered border-indigo-500 rounded font-mono"
            value={tempValue as string}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTempValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
          />
        );
    }
  };

  return (
    <div className={`${containerStyles[variant] || "bg-white p-4 border rounded"} ${className} transition-all duration-200`}>
      {label && <label className={labelStyles}>{label}</label>}
      <div onClick={handleContainerClick} className="cursor-pointer min-h-[20px]">
        {isEditing ? renderEdit() : renderView()}
      </div>
    </div>
  );
};

export default EditableBlock;
