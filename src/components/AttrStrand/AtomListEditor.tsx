import React, { useState, useEffect, useCallback } from 'react';
import type { IContentAtom, ContentAtomField, ContentAtomType } from '../../attrstrand/types';
import type { AtomSubmission } from '../../attrstrand/core';
import { AtomBlock } from './AtomBlock';
import { RelationBlock } from './RelationBlock'; // New import
import { Plus, Trash2 } from 'lucide-react';

interface AtomListEditorProps {
    atoms: IContentAtom[];
    field: ContentAtomField;
    defaultAtomType: ContentAtomType;
    onUpdate: (submissions: AtomSubmission[]) => void;
    readOnly?: boolean;
    className?: string;
    // Props for relation handling
    nodesMap?: Record<string, { title: string }>;
    relationTypes?: Record<string, { label: string; icon: string; color: string }>;
}

// Internal state representation
interface EditableAtom {
    id: string; // Real ID or temporary ID
    content: string;
    originalAtom: IContentAtom | null; // Null for new blocks
    isDeleted?: boolean;
}

export const AtomListEditor: React.FC<AtomListEditorProps> = ({
    atoms,
    field,
    defaultAtomType,
    onUpdate,
    readOnly = false,
    className = '',
    nodesMap,
    relationTypes
}) => {
    const [localAtoms, setLocalAtoms] = useState<EditableAtom[]>([]);

    useEffect(() => {
        // Initialize local state from props
        setLocalAtoms(atoms.map(a => ({
            id: a.id,
            content: a.contentJson,
            originalAtom: a
        })));
    }, [atoms]);

    const triggerUpdate = useCallback((newAtoms: EditableAtom[]) => {
        if (readOnly) return;

        const submissions: AtomSubmission[] = newAtoms.map(a => ({
            content: a.content,
            derivedFromId: a.originalAtom ? a.originalAtom.id : undefined,
            field: field,
            type: defaultAtomType
        }));
        onUpdate(submissions);
    }, [field, defaultAtomType, onUpdate, readOnly]);

    const handleAtomUpdate = (index: number, newContent: string) => {
        const newAtoms = [...localAtoms];
        newAtoms[index].content = newContent;
        setLocalAtoms(newAtoms);
        triggerUpdate(newAtoms);
    };

    const handleDelete = (index: number) => {
        const newAtoms = [...localAtoms];
        newAtoms.splice(index, 1);
        setLocalAtoms(newAtoms);
        triggerUpdate(newAtoms);
    };

    const handleAdd = (index: number) => {
        const newAtoms = [...localAtoms];
        const newAtom: EditableAtom = {
            id: `temp-${Date.now()}-${Math.random()}`,
            content: '', // Empty content for default
            originalAtom: null
        };
        // For relations, content should be valid JSON structure if possible, but empty string is handled
        if (field === 'rels') {
            newAtom.content = JSON.stringify({ targetId: '', type: 'DERIVES_FROM', condition: '' });
        }

        newAtoms.splice(index + 1, 0, newAtom); // Insert after index
        setLocalAtoms(newAtoms);
        triggerUpdate(newAtoms);
    };

    const isInline = field === 'tags';
    const isRelation = field === 'rels';

    return (
        <div className={`${isInline ? 'flex flex-wrap items-start gap-2' : isRelation ? 'space-y-0' : 'space-y-2'} ${className}`}>
            {localAtoms.map((atom, index) => (
                <div key={atom.id} className={`relative group/list-item ${isInline ? 'inline-block' : ''} ${isRelation ? 'pb-4' : ''}`}>
                     {/* Add Button (Top, only for first item or empty list) - Disabled for inline to keep it simple, or adjust pos */}
                     {!readOnly && !isInline && index === 0 && (
                        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 opacity-0 group-hover/list-item:opacity-100 transition-opacity z-10">
                            <button
                                onClick={() => handleAdd(-1)}
                                className="bg-indigo-50 text-indigo-400 rounded-full p-1 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200"
                                title={`在上方添加${isRelation ? '关联条目' : (isInline?'标签':'内容块')}`}
                            >
                                <Plus size={12} />
                            </button>
                        </div>
                    )}

                    <div className="relative">
                        {isRelation ? (
                            <div className="relative pl-4 border-l-2 border-slate-200 ml-2 group-last:border-transparent min-h-[40px]">
                                 {/* Dot for timeline, positioned on the border */}
                                 {/* Border is at left:0 of this div. Dot should be centered on it. */}
                                 {/* w-4 (1rem = 16px). Center = 8px. Border width = 2px. Center = 1px. */}
                                 {/* Dot left = 1px - 8px = -7px. */}
                                 <div className="absolute -left-[7px] top-3 w-4 h-4 bg-white rounded-full border-2 border-slate-300 group-hover/list-item:border-indigo-400 transition-colors z-10"></div>

                                 <RelationBlock
                                    atom={atom.originalAtom || {
                                        id: atom.id,
                                        contentJson: atom.content,
                                        attr: {},
                                        field,
                                        type: defaultAtomType,
                                        creatorId: 'system', createdAt: '', contentHash: '', contentSimHash: '', frontMeta: {}, backMeta: {}
                                    } as IContentAtom}
                                    onUpdate={(content) => handleAtomUpdate(index, content)}
                                    readOnly={readOnly}
                                    nodesMap={nodesMap || {}}
                                    relationTypes={relationTypes || {}}
                                />
                            </div>
                        ) : (
                            <AtomBlock
                                atom={atom.originalAtom || {
                                    id: atom.id,
                                    contentJson: atom.content,
                                    attr: {}, // New blocks have no history yet
                                    field,
                                    type: defaultAtomType,
                                    creatorId: 'system', createdAt: '', contentHash: '', contentSimHash: '', frontMeta: {}, backMeta: {}
                                } as IContentAtom}
                                onUpdate={(content) => handleAtomUpdate(index, content)}
                                readOnly={readOnly}
                                className={!readOnly && !isInline ? "pr-8" : ""} // Make room for delete button only in block mode
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
                                title={`删除${isRelation ? '关联条目' : (isInline?'标签':'内容块')}`}
                            >
                                <Trash2 size={isInline ? 10 : 14} />
                            </button>
                        )}
                    </div>

                    {/* Add Button (Bottom) - or Right for inline */}
                    {!readOnly && !isInline && (
                        <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 opacity-0 group-hover/list-item:opacity-100 transition-opacity z-10">
                            <button
                                onClick={() => handleAdd(index)}
                                className="bg-indigo-50 text-indigo-400 rounded-full p-1 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200"
                                title={`在下方添加${isRelation ? '关联条目' : (isInline?'标签':'内容块')}`}
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
                         onClick={() => handleAdd(localAtoms.length - 1)}
                         className="flex-center w-6 h-6 rounded-full border border-dashed border-slate-300 text-slate-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors mt-0.5"
                         title="添加标签"
                    >
                        <Plus size={14} />
                    </button>
                ) : (
                    localAtoms.length === 0 && (
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
