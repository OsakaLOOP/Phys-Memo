import React, { useState, useEffect, useCallback } from 'react';
import type { IContentAtom, ContentAtomField, ContentAtomType } from '../../attrstrand/types';
import type { AtomSubmission } from '../../attrstrand/core';
import { AtomBlock } from './AtomBlock';
import { Plus, Trash2 } from 'lucide-react';

interface AtomListEditorProps {
    atoms: IContentAtom[];
    field: ContentAtomField;
    defaultAtomType: ContentAtomType;
    onUpdate: (submissions: AtomSubmission[]) => void;
    readOnly?: boolean;
    className?: string;
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
    className = ''
}) => {
    const [localAtoms, setLocalAtoms] = useState<EditableAtom[]>([]);

    useEffect(() => {
        // Initialize local state from props
        // We only update if the IDs or length have changed to avoid disrupting active edits if possible
        // But since App.tsx updates atoms on save, we must sync.
        // The loop is broken by removing the reverse useEffect.
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
            content: '',
            originalAtom: null
        };
        newAtoms.splice(index + 1, 0, newAtom); // Insert after index
        setLocalAtoms(newAtoms);
        // We do NOT trigger update immediately on add, to let user type first?
        // But if we don't, the new block is just local.
        // If we trigger, it creates a blank atom.
        // Let's trigger to persist the structure change.
        triggerUpdate(newAtoms);
    };

    return (
        <div className={`space-y-2 ${className}`}>
            {localAtoms.map((atom, index) => (
                <div key={atom.id} className="relative group/list-item">
                     {/* Add Button (Top, only for first item or empty list) */}
                     {!readOnly && index === 0 && (
                        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 opacity-0 group-hover/list-item:opacity-100 transition-opacity z-10">
                            <button
                                onClick={() => handleAdd(-1)}
                                className="bg-indigo-50 text-indigo-400 rounded-full p-1 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200"
                                title="Add block before"
                            >
                                <Plus size={12} />
                            </button>
                        </div>
                    )}

                    <div className="relative">
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
                            className={!readOnly ? "pr-8" : ""} // Make room for delete button
                        />

                        {!readOnly && (
                            <button
                                onClick={() => handleDelete(index)}
                                className="absolute top-2 right-0 opacity-0 group-hover/list-item:opacity-100 text-slate-300 hover:text-red-400 transition-colors p-1"
                                title="Delete block"
                            >
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>

                    {/* Add Button (Bottom) */}
                    {!readOnly && (
                        <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 opacity-0 group-hover/list-item:opacity-100 transition-opacity z-10">
                            <button
                                onClick={() => handleAdd(index)}
                                className="bg-indigo-50 text-indigo-400 rounded-full p-1 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200"
                                title="Add block after"
                            >
                                <Plus size={12} />
                            </button>
                        </div>
                    )}
                </div>
            ))}

            {!readOnly && localAtoms.length === 0 && (
                <div
                    onClick={() => handleAdd(-1)}
                    className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center text-slate-400 hover:border-indigo-300 hover:text-indigo-500 cursor-pointer transition-colors"
                >
                    <Plus className="mx-auto mb-1" size={20} />
                    <span className="text-sm">Add Content Block</span>
                </div>
            )}
        </div>
    );
};
