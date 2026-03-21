import React, { useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { ContentAtomField } from '../../attrstrand/types';
import RichTextRenderer from '../RichTextRenderer';
import { UnifiedCodeMirror } from './Editor/UnifiedCodeMirror';
import { Check, Edit3, Plus } from 'lucide-react';
import { ErrorBoundary } from '../ErrorBoundary';
import { CopyrightTooltip } from './CopyrightTooltip';
import { genTempId } from '../../store/workspaceStore';

interface FieldEditorProps {
    field: ContentAtomField;
    readOnly?: boolean;
    className?: string;
}

export const FieldEditor: React.FC<FieldEditorProps> = ({ field, readOnly = false, className = '' }) => {
    // 监听是否处于编辑态
    const isEditing = useWorkspaceStore(state => state.activeEditor?.field === field);
    const setActiveEditor = useWorkspaceStore(state => state.setActiveEditor);

    // 获取当前 field 的所有 atom IDs
    const atomIds = useWorkspaceStore(state => state.draftAtomLists[field] || []);
    const atomsData = useWorkspaceStore(state => state.draftAtomsData);
    const addAtomId = useWorkspaceStore(state => state.addAtomId);

    // 悬停状态
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    const handlePointerOver = (e: React.PointerEvent) => {
        const target = e.target as HTMLElement;
        const item = target.closest('[data-index]') as HTMLElement | null;
        if (item) {
            const index = parseInt(item.getAttribute('data-index') || '', 10);
            if (!Number.isNaN(index) && hoveredIndex !== index) {
                setHoveredIndex(index);
            }
        } else {
            setHoveredIndex(null);
        }
    };

    const handlePointerLeave = (e: React.PointerEvent<HTMLDivElement>) => {
        const related = e.relatedTarget as Node | null;
        if (related && related instanceof Node && e.currentTarget.contains(related)) {
            return;
        }
        setHoveredIndex(null);
    };

    const handleContainerClick = (e: React.MouseEvent) => {
        if (readOnly || isEditing) return;

        // 避免点击内部链接或按钮时误触发编辑
        const target = e.target as HTMLElement;
        if (target.closest('a') || target.closest('button') || target.closest('.ref-link')) {
            return;
        }

        // 我们只把焦点给这个 field，不需要特定 id
        // 可以传第一个 atom 的 id 作为象征，在 cm 里其实是一整片
        const firstId = atomIds.length > 0 ? atomIds[0] : `temp_${crypto.randomUUID()}`;
        setActiveEditor({ field, id: firstId });
    };

    const handleAdd = (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        const newId = genTempId();
        addAtomId(field, newId, index);
        setActiveEditor({ field, id: newId });
    };

    if (isEditing) {
        return (
            <div className={`relative w-full ${className}`}>
                <ErrorBoundary>
                    <UnifiedCodeMirror field={field} initialAtomIds={atomIds} />
                </ErrorBoundary>

                {/* 右上角操作按钮：完成编辑 */}
                <div className="absolute top-2 right-2 flex gap-1 z-10">
                    <button
                        onClick={() => setActiveEditor(null)}
                        className="p-1 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded text-sm font-medium transition-colors shadow-sm"
                    >
                        <Check size={16}/> 
                    </button>
                </div>
            </div>
        );
    }

    // --- 只读视图 ---
    return (
        <div
            onClick={handleContainerClick}
            onPointerOver={handlePointerOver}
            onPointerLeave={handlePointerLeave}
            className={`
                group/field relative w-full rounded-lg transition-all
                ${!readOnly ? 'cursor-text hover:bg-slate-50 ring-1 ring-transparent hover:ring-slate-200' : ''}
                ${className}
            `}
        >
            {/* 只读时的编辑提示图标 */}
            {!readOnly && (
                <div className="absolute top-2 right-2 opacity-0 group-hover/field:opacity-100 transition-opacity pointer-events-none text-slate-400">
                    <Edit3 size={16} />
                </div>
            )}

            <div className="p-4 flex flex-col">
                {atomIds.length === 0 ? (
                    <div className="text-slate-400 text-sm italic py-2">
                        暂无内容...
                    </div>
                ) : (
                    atomIds.map((id, index) => {
                        const atom = atomsData[id];
                        const content = atom?.content || '';
                        const attr = atom?.attr || null;

                        return (
                            <div 
                                key={id} 
                                className="relative group/block"
                                data-index={index}
                            >
                                {/* 块顶部插入按钮 */}
                                {!readOnly && index === 0 && (
                                    <div className={`absolute -top-[14px] left-0 w-full flex justify-center opacity-0 ${(hoveredIndex === index) && 'opacity-100'} transition-opacity z-10 pointer-events-none`}>
                                        <button
                                            onClick={(e) => handleAdd(e, -1)}
                                            className="pointer-events-auto bg-indigo-50 text-indigo-400 rounded-full p-1 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200 bg-opacity-90 backdrop-blur-sm"
                                        >
                                            <Plus size={12} />
                                        </button>
                                    </div>
                                )}

                                {/* 块内容与左侧边框 */}
                                <div className="py-2">
                                    <div className="pl-3 border-l-[3px] border-slate-200 group-hover/block:border-indigo-300 transition-colors">
                                        <RichTextRenderer content={content} enableAnalysis={true} />
                                    </div>
                                </div>

                                {/* 块版权信息浮窗 (非编辑状态悬浮) */}
                                {attr && Object.keys(attr).length > 0 && (
                                    <div className="absolute left-3 top-full mt-1 opacity-0 group-hover/block:opacity-100 transition-opacity pointer-events-none z-20">
                                        <CopyrightTooltip
                                            authors={Object.entries(attr).map(([author, share]) => ({ author, share: Number(share) }))}
                                            diffAdded={atom?.diffAdded || 0}
                                            diffDeleted={atom?.diffDeleted || 0}
                                            diffRetained={atom?.diffRetained || 0}
                                            itemId={id}
                                        />
                                    </div>
                                )}

                                {/* 块底部插入按钮 */}
                                {!readOnly && (
                                    <div className={`absolute -bottom-[14px] left-0 w-full flex justify-center opacity-0 ${((hoveredIndex === index) || hoveredIndex === index + 1) && 'opacity-100'} transition-opacity z-10 pointer-events-none`}>
                                        <button
                                            onClick={(e) => handleAdd(e, index)}
                                            className="pointer-events-auto bg-indigo-50 text-indigo-400 rounded-full p-1 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200 bg-opacity-90 backdrop-blur-sm"
                                        >
                                            <Plus size={12} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};
