import React, { useState, useEffect } from 'react';
import { IContentAtom } from '../../attrstrand/types';
import RichTextRenderer from '../RichTextRenderer';
import { Edit3, Check, X } from 'lucide-react';

interface AtomBlockProps {
    atom: IContentAtom;
    onUpdate: (newContent: string) => void;
    readOnly?: boolean;
    className?: string;
    counters?: { h2: number, h3: number, n: number }; // Placeholder for numbering context
}

export const AtomBlock: React.FC<AtomBlockProps> = ({ atom, onUpdate, readOnly = false, className = '' }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(atom.contentJson);

    useEffect(() => {
        setEditValue(atom.contentJson);
    }, [atom.contentJson]);

    const handleSave = () => {
        if (editValue !== atom.contentJson) {
            onUpdate(editValue);
        }
        setIsEditing(false);
    };

    const handleCancel = () => {
        setEditValue(atom.contentJson);
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            handleSave();
        } else if (e.key === 'Escape') {
            handleCancel();
        }
    };

    // Attribution display with adjustment: (Val + 0.1/n) / 1.1
    const authors = Object.entries(atom.attr);
    const n = authors.length;
    const adjustedAuthors = authors.map(([author, share]) => {
        const adjustedShare = (share + (n > 0 ? (0.1 / n) : 0)) / 1.1;
        return { author, share: adjustedShare };
    }).sort((a, b) => b.share - a.share);

    return (
        <div className={`group relative mb-4 transition-all ${className}`}>
            {/* Attribution Indicator (Left Sidebar) */}
            <div className="absolute -left-2 top-0 bottom-0 w-1 rounded-l opacity-0 group-hover:opacity-100 transition-opacity bg-indigo-200 cursor-help">
                <div className="absolute left-2 top-0 bg-white shadow-lg border rounded p-2 text-xs w-48 hidden group-hover:block z-50">
                    <div className="font-bold mb-1 text-slate-600 border-b pb-1">Copyright Distribution</div>
                    {adjustedAuthors.map(({ author, share }) => (
                        <div key={author} className="flex justify-between text-slate-500 py-0.5">
                            <span className="truncate max-w-[100px]">{author}</span>
                            <span className="font-mono">{(share * 100).toFixed(1)}%</span>
                        </div>
                    ))}
                    <div className="mt-1 pt-1 border-t text-[10px] text-slate-400 font-mono truncate">
                        ID: {atom.id}
                    </div>
                </div>
            </div>

            {isEditing ? (
                <div className="relative">
                    <textarea
                        className="w-full min-h-[100px] p-3 text-sm bg-white border-2 border-indigo-400 rounded-lg shadow-inner focus:outline-none resize-y font-mono leading-relaxed"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        autoFocus
                    />
                    <div className="absolute top-2 right-2 flex gap-1 z-10">
                        <button
                            onClick={handleSave}
                            className="p-1.5 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                            title="Save (Ctrl+Enter)"
                        >
                            <Check size={14} />
                        </button>
                        <button
                            onClick={handleCancel}
                            className="p-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                            title="Cancel (Esc)"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </div>
            ) : (
                <div
                    onClick={() => !readOnly && setIsEditing(true)}
                    className={`
                        min-h-[2rem] p-2 rounded border border-transparent transition-colors relative
                        ${!readOnly ? 'hover:bg-slate-50 hover:border-slate-200 cursor-pointer' : ''}
                    `}
                >
                   <RichTextRenderer content={atom.contentJson} enableAnalysis={true} />

                   {!readOnly && (
                       <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                           <Edit3 className="w-4 h-4 text-indigo-300" />
                       </div>
                   )}
                </div>
            )}
        </div>
    );
};
