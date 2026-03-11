import React, { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DraftId } from '../../attrstrand/types';
import RichTextRenderer from '../RichTextRenderer';
import { Edit3, Check, X } from 'lucide-react';

interface AtomBlockProps {
    atomId: DraftId;
    readOnly?: boolean;
    className?: string;
    index?: number;
}

export const AtomBlock: React.FC<AtomBlockProps> = ({ atomId, readOnly = false, className = '', index = 0 }) => {
    // Subscribe specifically to this atom's data
    const atom = useWorkspaceStore((state) => state.draftAtomsData[atomId]);
    const updateAtomContent = useWorkspaceStore((state) => state.updateAtomContent);

    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(atom?.content || '');

    useEffect(() => {
        if (atom) {
            setEditValue(atom.content);
        }
    }, [atom?.content]);

    if (!atom) return null; // Defensive check

    const handleSave = () => {
        if (editValue !== atom.content) {
            updateAtomContent(atomId, editValue);
        }
        setIsEditing(false);
    };

    const handleCancel = () => {
        setEditValue(atom.content);
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
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
    // For new/temp atoms, attr might not exist until submitted, handle defensively.
    const attr = atom.attr || { 'user': 1 };
    const authors = Object.entries(attr);
    const n = authors.length;
    const adjustedAuthors = authors.map(([author, share]) => {
        const adjustedShare = (Number(share) + (n > 0 ? (0.1 / n) : 0)) / 1.1;
        return { author, share: adjustedShare };
    }).sort((a, b) => b.share - a.share);

    const renderContent = () => {
        if (!atom.content) return <span className="text-slate-300 italic text-sm">点击编辑内容...</span>;

        if (atom.field === 'tags') {
            return (
                <span className="inline-flex-center badge-base bg-yellow-50 text-yellow-700 border-yellow-200">
                    <RichTextRenderer content={atom.content} className="inline-block [&>p]:inline [&>p]:m-0" />
                </span>
            );
        }

        if (atom.field === 'refs') {
            return (
                <div className="flex gap-2 items-start text-sm text-slate-600">
                    <span className="font-mono text-slate-400 select-none pt-0.5">{index + 1}.</span>
                    <div className="flex-1">
                        <RichTextRenderer content={atom.content} className="inline-block" />
                    </div>
                </div>
            );
        }

        return <RichTextRenderer content={atom.content} enableAnalysis={true} />;
    };

    const renderEditor = () => {
        if (atom.field === 'tags') {
             return (
                 <input
                    type="text"
                    className="w-full p-1 text-sm input-bordered border-indigo-500 rounded"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    placeholder="标签..."
                 />
             );
        }

         if (atom.field === 'refs') {
             return (
                 <textarea
                    className="w-full min-h-[60px] p-2 text-sm input-bordered border-indigo-500 rounded resize-y font-mono"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    placeholder="引用..."
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
            <div className="absolute right-full top-0 bottom-0 w-1 mr-2 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-indigo-200 cursor-help z-50">
                <div className="absolute right-2 top-0 bg-white shadow-lg border rounded p-2 text-xs w-48 hidden group-hover:block pointer-events-auto">
                    <div className="font-bold mb-1 text-slate-600 border-b pb-1">版权归属</div>
                    {adjustedAuthors.map(({ author, share }) => (
                        <div key={author} className="flex justify-between text-slate-500 py-0.5">
                            <span className="truncate max-w-[100px]">{author}</span>
                            <span className="font-mono">{(Number(share) * 100).toFixed(1)}%</span>
                        </div>
                    ))}
                    <div className="mt-1 pt-1 border-t text-[10px] text-slate-400 font-mono truncate">
                        ID: {atom.id.substring(0, 8)}...
                    </div>
                </div>
            </div>

            {isEditing ? (
                <div className="relative min-w-[200px]">
                    {renderEditor()}
                    <div className="absolute top-1 right-1 flex gap-1 z-10">
                        <button
                            onClick={handleSave}
                            className="p-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                            title="保存 (Enter / Ctrl+Enter)"
                        >
                            <Check size={12} />
                        </button>
                        <button
                            onClick={handleCancel}
                            className="btn-danger bg-red-100"
                            title="取消 (Esc)"
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
