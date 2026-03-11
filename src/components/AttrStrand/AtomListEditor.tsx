import React from 'react';
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
    // Only subscribe to the array of IDs for this list to avoid re-rendering entire list on child text change
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

    return (
        <div className={`${isInline ? 'flex flex-wrap items-start gap-2' : isRelation ? 'space-y-0' : 'space-y-2'} ${className}`}>
            {atomIds.map((id: string, index: number) => (
                <div key={id} className={`relative group/list-item ${isInline ? 'inline-block' : ''} ${isRelation ? 'pb-0' : ''}`}>

                    {/* Add Button Top */}
                    {!readOnly && !isInline && index === 0 && (
                        <div className="absolute left-1/2 -top-3 transform -translate-x-1/2 opacity-0 group-hover/list-item:opacity-100 transition-opacity z-10">
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
                                    ${isRelation ? 'top-3 right-2' : ''}
                                `}
                            >
                                <Trash2 size={isInline ? 10 : 14} />
                            </button>
                        )}
                    </div>

                    {/* Add Button Bottom */}
                    {!readOnly && !isInline && (
                        <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 opacity-0 group-hover/list-item:opacity-100 transition-opacity z-10">
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
                         className="flex-center w-6 h-6 rounded-full border border-dashed border-slate-300 text-slate-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors mt-0.5"
                    >
                        <Plus size={14} />
                    </button>
                ) : (
                    atomIds.length === 0 && (
                        <div
                            onClick={() => handleAdd(-1)}
                            className={`border-2 border-dashed border-slate-200 rounded-lg p-4 text-center text-slate-400 hover:border-indigo-300 hover:text-indigo-500 cursor-pointer transition-colors ${isRelation ? 'ml-8' : ''}`}
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
