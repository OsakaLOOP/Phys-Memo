import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { IContentAtom } from '../../attrstrand/types';
import RichTextRenderer from '../RichTextRenderer';
import { Edit3, Check, X } from 'lucide-react';

interface AtomBlockProps {
    atom: IContentAtom;
    onUpdate: (newContent: string) => void;
    readOnly?: boolean;
    className?: string;
    index?: number; // Pass index for numbered lists (refs)
    counters?: { h2: number, h3: number, n: number }; // Placeholder for numbering context
}

export const AtomBlock: React.FC<AtomBlockProps> = ({ atom, onUpdate, readOnly = false, className = '', index = 0 }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(atom.contentJson);

    // Tooltip state
    const [showTooltip, setShowTooltip] = useState(false);
    const [tooltipPos, setTooltipPos] = useState({ top: 0, right: 0 });
    const indicatorRef = useRef<HTMLDivElement>(null);
    const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        setEditValue(atom.contentJson);
    }, [atom.contentJson]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (tooltipTimeoutRef.current) {
                clearTimeout(tooltipTimeoutRef.current);
            }
        };
    }, []);

    // Handle tooltip interactions
    const handleIndicatorEnter = () => {
        if (tooltipTimeoutRef.current) {
            clearTimeout(tooltipTimeoutRef.current);
            tooltipTimeoutRef.current = null;
        }

        if (indicatorRef.current) {
            const rect = indicatorRef.current.getBoundingClientRect();
            // Position: top aligns with indicator, right edge aligns with indicator's left edge
            // Add a small gap (e.g., 8px) so it doesn't touch the indicator
            setTooltipPos({
                top: rect.top,
                right: window.innerWidth - rect.left + 8
            });
            setShowTooltip(true);
        }
    };

    const handleMouseLeave = () => {
        tooltipTimeoutRef.current = setTimeout(() => {
            setShowTooltip(false);
        }, 200);
    };

    const handleTooltipEnter = () => {
        if (tooltipTimeoutRef.current) {
            clearTimeout(tooltipTimeoutRef.current);
            tooltipTimeoutRef.current = null;
        }
    };

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
        if (e.key === 'Enter') {
             // For tags and refs, single enter saves
             if (atom.field === 'tags' || atom.field === 'refs') {
                 handleSave();
             } else if (e.metaKey || e.ctrlKey) {
                 handleSave();
             }
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

    const renderContent = () => {
        if (atom.field === 'tags') {
            // Match EditableBlock 'tags' style
            return (
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-yellow-50 text-yellow-700 border border-yellow-200">
                    <RichTextRenderer content={atom.contentJson} className="inline-block [&>p]:inline [&>p]:m-0" />
                </span>
            );
        }

        if (atom.field === 'refs') {
            // Match EditableBlock 'references' style (list item look)
            return (
                <div className="flex gap-2 items-start text-sm text-slate-600">
                    <span className="font-mono text-slate-400 select-none pt-0.5">{index + 1}.</span>
                    <div className="flex-1">
                        <RichTextRenderer content={atom.contentJson} className="inline-block" />
                    </div>
                </div>
            );
        }

        // Default RichText
        return <RichTextRenderer content={atom.contentJson} enableAnalysis={true} />;
    };

    const renderEditor = () => {
        if (atom.field === 'tags') {
             return (
                 <input
                    type="text"
                    className="w-full p-1 text-sm bg-white border border-indigo-500 rounded shadow-sm focus:ring-2 focus:ring-indigo-200 outline-none"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    placeholder="Tag..."
                 />
             );
        }

         if (atom.field === 'refs') {
             return (
                 <textarea
                    className="w-full min-h-[60px] p-2 text-sm bg-white border border-indigo-500 rounded shadow-sm focus:ring-2 focus:ring-indigo-200 outline-none resize-y font-mono"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    placeholder="Reference..."
                 />
             );
        }

        return (
            <textarea
                className="w-full min-h-[100px] p-3 text-sm bg-white border-2 border-indigo-400 rounded-lg shadow-inner focus:outline-none resize-y font-mono leading-relaxed"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
            />
        );
    }


    return (
        <div className={`group relative mb-2 transition-all ${atom.field === 'tags' ? 'inline-block mr-2 mb-2' : ''} ${className}`}>
            {/* Attribution Indicator (Left Sidebar) - REPOSITIONED */}
            <div
                ref={indicatorRef}
                className="absolute right-full top-0 bottom-0 w-1 mr-2 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-indigo-200 cursor-help z-50"
                onMouseEnter={handleIndicatorEnter}
                onMouseLeave={handleMouseLeave}
            >
                {/* Tooltip content removed from here, now rendered via Portal */}
            </div>

            {/* Portal Tooltip */}
            {showTooltip && createPortal(
                <div
                    className="fixed bg-white shadow-lg border rounded p-2 text-xs w-48 z-[9999] pointer-events-auto"
                    style={{
                        top: tooltipPos.top,
                        right: tooltipPos.right
                    }}
                    onMouseEnter={handleTooltipEnter}
                    onMouseLeave={handleMouseLeave}
                >
                    <div className="font-bold mb-1 text-slate-600 border-b pb-1">版权分布</div>
                    {adjustedAuthors.map(({ author, share }) => (
                        <div key={author} className="flex justify-between text-slate-500 py-0.5">
                            <span className="truncate max-w-[100px]">{author}</span>
                            <span className="font-mono">{(share * 100).toFixed(1)}%</span>
                        </div>
                    ))}
                    <div className="mt-1 pt-1 border-t text-[10px] text-slate-400 font-mono truncate">
                        ID: {atom.id}
                    </div>
                </div>,
                document.body
            )}

            {isEditing ? (
                <div className="relative min-w-[200px]">
                    {renderEditor()}
                    <div className="absolute top-1 right-1 flex gap-1 z-10">
                         {/* Simplified controls for small items */}
                        <button
                            onClick={handleSave}
                            className="p-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                            title="Save (Enter / Ctrl+Enter)"
                        >
                            <Check size={12} />
                        </button>
                        <button
                            onClick={handleCancel}
                            className="p-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                            title="Cancel (Esc)"
                        >
                            <X size={12} />
                        </button>
                    </div>
                </div>
            ) : (
                <div
                    onClick={() => !readOnly && setIsEditing(true)}
                    className={`
                        rounded transition-colors relative
                        ${!readOnly ? 'cursor-pointer hover:bg-slate-50' : ''}
                        ${atom.field === 'tags' ? '' : 'min-h-[2rem] p-2 border border-transparent hover:border-slate-200'}
                    `}
                >
                   {renderContent()}

                   {!readOnly && atom.field !== 'tags' && atom.field !== 'refs' && (
                       <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                           <Edit3 className="w-4 h-4 text-indigo-300" />
                       </div>
                   )}
                </div>
            )}
        </div>
    );
};
