import React, { useState, useEffect } from 'react';
import { IContentAtom, ContentAtomField, ContentAtomType } from '../../attrstrand/types';
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
        setLocalAtoms(atoms.map(a => ({
            id: a.id,
            content: a.contentJson,
            originalAtom: a
        })));
    }, [atoms]);

    // Propagate changes to parent
    useEffect(() => {
        if (readOnly) return;

        const submissions: AtomSubmission[] = localAtoms.map(a => ({
            content: a.content,
            // If it has an original atom, it's derived from it.
            // If content matches original, core logic handles reuse.
            // If content changed, core logic handles new atom + attribution.
            // If it's a new block (originalAtom null), derivedFromId is undefined (fresh content).
            derivedFromId: a.originalAtom ? a.originalAtom.id : undefined,
            field: field,
            type: defaultAtomType // Assuming all atoms in this list share type (e.g. all markdown notes)
        }));
        // We debounce this or just rely on parent to handle it?
        // Parent might save on explicit action.
        // For now, we just call onUpdate whenever local state changes.
        // But preventing infinite loop if parent re-renders `atoms` prop?
        // We only call onUpdate. We don't want parent to pass back new atoms immediately unless saved.
        // So this is fine.
        onUpdate(submissions);
    }, [localAtoms, field, defaultAtomType, readOnly]); // Warning: onUpdate dependency?

    const handleAtomUpdate = (index: number, newContent: string) => {
        const newAtoms = [...localAtoms];
        newAtoms[index].content = newContent;
        setLocalAtoms(newAtoms);
    };

    const handleDelete = (index: number) => {
        const newAtoms = [...localAtoms];
        newAtoms.splice(index, 1);
        setLocalAtoms(newAtoms);
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
                                creatorId: '', createdAt: '', contentHash: '', contentSimHash: '', frontMeta: {}, backMeta: {}
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
