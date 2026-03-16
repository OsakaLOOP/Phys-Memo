import React, { useState, useEffect, useMemo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DraftId } from '../../attrstrand/types';
import RichTextRenderer from '../RichTextRenderer';
import { Edit3, Check, X } from 'lucide-react';
import { calculateDiffStats, simhash } from '../../attrstrand/utils';
import { core } from '../../attrstrand/core';

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
    const [initialContent] = useState(atom?.content || '');

    useEffect(() => {
        if (atom && !isEditing) {
            setEditValue(atom.content);
        }
    }, [atom?.content, isEditing]);

    if (!atom) return null; // Defensive check

    const isTags = (atom.field as string) === 'tags';
    const isRefs = atom.field === 'refs';

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

    const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isEditing || readOnly) return;
        const target = e.target as HTMLElement;
        if (target.tagName === 'A' || target.closest('a') || target.closest('.ref-link')) return;
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) return;
        setIsEditing(true);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
             if (isTags || isRefs) {
                 handleSave();
             } else if (e.metaKey || e.ctrlKey) {
                 handleSave();
             }
        } else if (e.key === 'Escape') {
            handleCancel();
        }
    };

    const handlePaste = async (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const pastedText = e.clipboardData.getData('text');
        // Trigger matching if pasted text is substantial (e.g., > 20 characters)
        if (pastedText && pastedText.length > 20 ) {
            try {
                const targetSimhash = await simhash(pastedText);
                const bestMatch = await core.findBestSimhashMatch(targetSimhash);

                if (bestMatch && bestMatch.sim > 0.9) { // Arbitrary threshold for notification
                    // 后期加入持久化记录 (newFrontMeta 可作为后端保存 payload)。
                    alert(`检测到粘贴长文本(${pastedText.length}字)。全库查重最佳匹配 ID: ${bestMatch.id} (相似度: ${(bestMatch.sim * 100).toFixed(1)}%)`);
                }
            } catch (err) {
                console.error("Failed to process paste simhash:", err);
            }
        }
    };

    // attr 的初始值
    const attr = (atom as any).attr || { 'user': 1 };
    const authors = Object.entries(attr);
    const n = authors.length;
    const adjustedAuthors = authors.map(([author, share]) => {
        const adjustedShare = (Number(share) + (n > 0 ? (0.1 / n) : 0)) / 1.1;
        return { author, share: adjustedShare };
    }).sort((a, b) => b.share - a.share);// 一个奇怪但有用的显示时调整.

    // 乐观计算实时 diff 用于显示.
    const displayDiff = useMemo(() => {
        if (isEditing || atom.isDirty) {
            // 新增的 initialState  用于标记后端原始数据, 计算当前 workspace 总 diff.
            return calculateDiffStats(initialContent, isEditing ? editValue : atom.content);
        } else {
            return {
                added: atom.diffAdded !== undefined ? atom.diffAdded : (atom.content?.length || 0),
                deleted: atom.diffDeleted || 0,
                retained: atom.diffRetained || 0,
            };
        }
    }, [isEditing, atom.isDirty, initialContent, editValue, atom.content, atom.diffAdded, atom.diffDeleted, atom.diffRetained]);

    const renderContent = () => {
        if (!atom.content) return <span className="text-slate-300 italic text-sm">点击编辑内容...</span>;

        if (isTags) {
            return (
                <span className="inline-flex-center badge-base bg-yellow-50 text-yellow-700 border-yellow-200">
                    <RichTextRenderer content={atom.content} className="inline-block [&>p]:inline [&>p]:m-0" />
                </span>
            );
        }

        if (isRefs) {
            return (
                <div id={`ref-${index + 1}`} className="flex gap-2 items-start text-sm text-slate-600 transition-colors duration-500 rounded p-1">
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
        if (isTags) {
             return (
                 <input
                    type="text"
                    className="
                        w-full h-full p-1 pl-2 pr-[3.5rem] text-sm font-medium rounded-lg outline-none
                        bg-[#f8fafc] border border-indigo-300 text-slate-700
                        shadow-[0_4px_12px_-2px_rgba(0,0,0,0.1),_0_0_0_2px_#e0e7ff]
                        focus:bg-white focus:border-indigo-400 focus:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.1),_0_0_0_2px_#c7d2fe]
                        transition-all
                    "
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={undefined}
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
                    onPaste={undefined}
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
                onPaste={atom.type!=='latex'?handlePaste : undefined}// latex atom 不参与比较
                autoFocus
            />
        );
    }

    return (
        <div className={`group relative ${atom.field!=='core'&&atom.field!=='doc'?'mb-2':''} transition-all ${isTags ? 'inline-block mr-2 ' : ''} ${className}`}>
            <div className="absolute right-full top-0 bottom-0 w-1 mr-2 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-indigo-200 cursor-help z-50">
                <div className="absolute left-3 top-full mt-1 bg-white shadow-lg border rounded p-2 text-xs w-48 hidden group-hover:block pointer-events-auto">
                    <div className="font-bold mb-1 text-slate-600 border-b pb-1">版权归属</div>
                    {adjustedAuthors.map(({ author, share }) => (
                        <div key={author} className="flex justify-between text-slate-500 py-0.5">
                            <span className="truncate max-w-[100px]">{author}</span>
                            <span className="font-mono">{(Number(share) * 100).toFixed(1)}%</span>
                        </div>
                    ))}

                    <div className="mt-1 pt-1 border-t text-[10px] text-slate-500 flex justify-between">
                        <span className="text-green-600 font-medium">+{displayDiff.added}字</span>
                        <span className="text-red-500 font-medium">-{displayDiff.deleted}字</span>
                        <span className="text-slate-400">留{displayDiff.retained}字</span>
                    </div>

                    <div className="mt-1 pt-1 border-t text-[10px] text-slate-400 font-mono truncate">
                        ID: {atom.id.substring(0, 8)}...
                    </div>
                </div>
            </div>

            {isEditing ? (
                isTags ? (
                    <div className="relative min-w-[200px] h-[32px] z-50 overflow-visible">
                        <div
                            className="absolute top-0 left-0 bottom-0"
                            style={{
                                width: `max(200px, calc(${editValue.length}ch + 4rem))`,
                                maxWidth: '400px',
                            }}
                        >
                            {renderEditor()}
                            <div className="absolute right-1 top-0 bottom-0 flex gap-1 items-center z-[60]">
                                <button
                                    onMouseDown={(e) => { e.preventDefault(); handleSave(); }}
                                    onClick={handleSave}
                                    className="p-1 rounded transition-colors flex items-center justify-center w-5 h-5 bg-green-100/90 text-green-600 hover:bg-green-200 shadow-sm"
                                    title="保存 (Enter / Ctrl+Enter)"
                                >
                                    <Check size={12} strokeWidth={2.5} />
                                </button>
                                <button
                                    onMouseDown={(e) => { e.preventDefault(); handleCancel(); }}
                                    onClick={handleCancel}
                                    className="p-1 rounded transition-colors flex items-center justify-center w-5 h-5 bg-red-100/90 text-red-500 hover:bg-red-200 shadow-sm"
                                    title="取消 (Esc)"
                                >
                                    <X size={12} strokeWidth={2.5} />
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="relative min-w-[200px]">
                        {renderEditor()}
                        <div className="absolute top-1 right-1 flex gap-1 z-[60]">
                            <button
                                onMouseDown={(e) => { e.preventDefault(); handleSave(); }}
                                onClick={handleSave}
                                className="p-1 rounded transition-colors flex items-center justify-center w-5 h-5 bg-green-100 text-green-700 hover:bg-green-200"
                                title={`保存 (${isRefs ? 'Enter / ' : ''}Ctrl+Enter)`}
                            >
                                <Check size={12} strokeWidth={2} />
                            </button>
                            <button
                                onMouseDown={(e) => { e.preventDefault(); handleCancel(); }}
                                onClick={handleCancel}
                                className="p-1 rounded transition-colors flex items-center justify-center w-5 h-5 btn-danger bg-red-100"
                                title="取消 (Esc)"
                            >
                                <X size={12} strokeWidth={2} />
                            </button>
                        </div>
                    </div>
                )
            ) : (
                <div
                    onClick={handleContainerClick}
                    className={`
                        rounded transition-colors relative
                        ${!readOnly ? 'cursor-pointer hover:bg-slate-50' : ''}
                        ${isTags ? '' : 'min-h-[2rem] p-2 border border-transparent hover:border-slate-200'}
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
