import React, { useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { ContentAtomField, DraftId } from '../../attrstrand/types';
import { AtomBlock } from './AtomBlock';
import { RelationBlock } from './RelationBlock';
import { Plus, Trash2 } from 'lucide-react';
import { genTempId } from '../../store/workspaceStore';

interface AtomListEditorProps {
    field: ContentAtomField;
    readOnly?: boolean;
    className?: string;
}

export const AtomListEditor: React.FC<AtomListEditorProps> = ({
    field,
    readOnly = false,
    className = ''
}) => {
    // 严格限制的zustand订阅
    const atomIds = useWorkspaceStore((state) => state.draftAtomLists[field] as DraftId[] || []);

    const addAtomId = useWorkspaceStore((state) => state.addAtomId);
    const removeAtomId = useWorkspaceStore((state) => state.removeAtomId);

    const handleAdd = (index: number) => {
        if (readOnly) return;
        addAtomId(field, genTempId(), index);
    };

    const handleDelete = (index: number) => {
        if (readOnly) return;
        removeAtomId(field, index);
    };

    const isInline = field === 'tags';
    const isRelation = field === 'rels';
    const isIndexHoverField = isRelation || field === 'core' || field === 'doc'|| field === 'refs';

    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    const handlePointerOver = (e: React.PointerEvent) => {
        if (readOnly || field === 'tags') return;
        const target = e.target as HTMLElement;
        const item = target.closest('[data-index]') as HTMLElement | null;
        if (item) {
            const index = parseInt(item.getAttribute('data-index') || '', 10);
            if (!Number.isNaN(index) && hoveredIndex !== index) {
                setHoveredIndex(index);
            }
        }
    };

    const handlePointerLeave = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isIndexHoverField) return;
        const related = e.relatedTarget as Node | null;

        if (related && e.currentTarget.contains(related)) {
            return;
        }

        setHoveredIndex(null);
    };

    return (
        <div
            className={`${isInline ? 'flex flex-wrap items-start gap-2' :  'space-y-0' } ${atomIds.length > 0 ? className : ''}`}
            onPointerOver={handlePointerOver}
            onPointerLeave={handlePointerLeave}
        >
            {atomIds.map((id: string, index: number) => (
                <div
                    key={id}
                    data-index={index}
                    className={`relative group/list-item ${isInline ? 'inline-block' : ''} ${isRelation ? 'pb-0' : ''}`}
                >

                    {/* 上方+, 同时浮现 */}
                    {!readOnly && !isInline && index === 0 && (
                        <div className={`absolute left-1/2 -top-3 transform -translate-x-1/2 transition-opacity z-10 ${
                            isIndexHoverField
                                ? (hoveredIndex === 0 ? 'opacity-100' : 'opacity-0')
                                : 'opacity-0 group-hover/list-item:opacity-100'
                        }`}>
                            <button
                                onClick={() => handleAdd(-1)}
                                className="bg-indigo-50 text-indigo-400 rounded-full p-1 mb-4 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200"
                            >
                                <Plus size={12} />
                            </button>
                        </div>
                    )}

                    <div className="relative">
                        {isRelation ? (
                            <div className="relative pl-4 pt-4 pb-4 border-l-2 border-slate-200 ml-2 group-last:border-transparent min-h-[40px]">
                                 <div className="absolute -left-[8px] top-[calc(50%+8px)] -translate-y-1/2 w-4 h-4 bg-white rounded-full border-2 border-slate-300 group-hover/list-item:border-indigo-400 transition-colors z-10"></div>
                                 <RelationBlock
                                    atomId={id}
                                    readOnly={readOnly}
                                />
                            </div>
                        ) : (
                            <AtomBlock
                                atomId={id}
                                readOnly={readOnly}
                                className={!readOnly && !isInline ? "pr-8" : ""}
                                index={index}
                            />
                        )}

                        {!readOnly && (
                            <button
                                onClick={() => handleDelete(index)}
                                className={`
                                    opacity-0 group-hover/list-item:opacity-100 text-slate-300 hover:text-red-400 transition-colors p-1
                                    ${isInline ? 'absolute -top-2 -right-2 bg-white rounded-full shadow border z-20 hover:bg-red-50' : 'absolute top-2 right-0'}
                                    ${isRelation ? 'top-[calc(50%-8px)] right-2' : ''}
                                `}
                            >
                                <Trash2 size={isInline ? 10 : 14} />
                            </button>
                        )}
                    </div>

                    {/* 下方+ */}
                    {!readOnly && !isInline && (
                        <div className={`absolute -bottom-3 left-1/2 transform -translate-x-1/2 transition-opacity z-10 ${
                            isIndexHoverField
                                ? ((hoveredIndex === index || hoveredIndex === index + 1) ? 'opacity-100' : 'opacity-0')
                                : 'opacity-0 group-hover/list-item:opacity-100'
                        }`}>
                            <button
                                onClick={() => handleAdd(index)}
                                className="bg-indigo-50 text-indigo-400 rounded-full p-1 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200"
                            >
                                <Plus size={12} />
                            </button>
                        </div>
                    )}
                </div>
            ))}

            {!readOnly && (
                isInline ? (
                    <button
                         onClick={() => handleAdd(atomIds.length - 1)}
                         className={`relative flex-center border border-dashed border-slate-300 text-slate-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50 overflow-hidden transition-all duration-300 ease-in-out ${
                             atomIds.length === 0
                                 ? 'w-full h-[66px] rounded-lg mt-0'
                                 : 'w-6 h-6 rounded-full mt-0.5'
                         }`}
                    >
                        {/* Empty state content */}
                        <div
                            className={`absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-300 ease-in-out ${
                                atomIds.length === 0 ? 'opacity-100 delay-150' : 'opacity-0 pointer-events-none'
                            }`}
                        >
                            <Plus className="mx-auto mb-1" size={20} />
                            <span className="text-sm">添加标签</span>
                        </div>

                        {/* Populated state content */}
                        <div
                            className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ease-in-out ${
                                atomIds.length > 0 ? 'opacity-100 delay-150' : 'opacity-0 pointer-events-none'
                            }`}
                        >
                            <Plus size={14} />
                        </div>
                    </button>
                ) : (
                    atomIds.length === 0 && (
                        <div
                            onClick={() => handleAdd(-1)}
                            className={`border-2 border-dashed border-slate-200 rounded-lg p-4 text-center text-slate-400 hover:border-indigo-300 hover:text-indigo-500 cursor-pointer transition-colors`}
                        >
                            <Plus className="mx-auto mb-1" size={20} />
                            <span className="text-sm">添加{isRelation ? '关联条目' : '内容块'}</span>
                        </div>
                    )
                )
            )}
        </div>
    );
};
