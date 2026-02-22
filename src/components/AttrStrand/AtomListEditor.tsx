import React, { useState, useEffect } from 'react';
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

    // We use a ref to track if local changes are pending update, to avoid responding to parent updates that we triggered ourselves?
    // Or simpler: Only update local state from props if the prop atoms are DIFFERENT from what our local state implies.
    // However, atoms prop changes to new objects on every save.

    // Better strategy: Initialize local state from props.
    // When user edits local state, trigger onUpdate.
    // When onUpdate completes, parent re-renders with new atoms.
    // We need to distinguish "new atoms from parent due to our save" vs "new atoms from parent due to external change".
    // Actually, simply relying on parent to drive state is safer but requires `AtomListEditor` to not have local state for *content*.
    // But we need local state for *list structure* (adding/removing items before save).

    // Solution:
    // 1. Initialize `localAtoms` from `atoms`.
    // 2. When `atoms` prop changes, check if it matches our `localAtoms` structure/content. If so, do nothing. If different (e.g. initial load, or external sync), update `localAtoms`.
    // 3. When user edits, update `localAtoms` AND call `onUpdate` immediately (or debounced).

    // To prevent loop:
    // If `useEffect` updates `localAtoms`, do NOT trigger `onUpdate`.
    // `onUpdate` should only be triggered by USER ACTIONS (handlers).

    useEffect(() => {
        // Compare incoming atoms with local state to see if update is needed
        // For simplicity, just checking IDs might be enough if we trust the flow,
        // but content might change too.
        // Let's just blindly sync for now, BUT remove the effect that calls onUpdate automatically.
        const mappedAtoms = atoms.map(a => ({
            id: a.id,
            content: a.contentJson,
            originalAtom: a
        }));

        // Only update if length differs or IDs differ (optimization)
        // For now, simple set.
        setLocalAtoms(mappedAtoms);
    }, [atoms]);

    const notifyUpdate = (currentAtoms: EditableAtom[]) => {
        if (readOnly) return;

        const submissions: AtomSubmission[] = currentAtoms.map(a => ({
            content: a.content,
            derivedFromId: a.originalAtom ? a.originalAtom.id : undefined,
            field: field,
            type: defaultAtomType
        }));
        onUpdate(submissions);
    };

    const handleAtomUpdate = (index: number, newContent: string) => {
        const newAtoms = [...localAtoms];
        newAtoms[index].content = newContent;
        setLocalAtoms(newAtoms);
        notifyUpdate(newAtoms); // Call onUpdate explicitly
    };

    const handleDelete = (index: number) => {
        const newAtoms = [...localAtoms];
        newAtoms.splice(index, 1);
        setLocalAtoms(newAtoms);
        notifyUpdate(newAtoms); // Call onUpdate explicitly
    };

    const handleAdd = (index: number) => {
        const newAtoms = [...localAtoms];
        const newAtom: EditableAtom = {
            id: `temp-${Date.now()}-${Math.random()}`,
            content: '',
            originalAtom: null
        };
        newAtoms.splice(index + 1, 0, newAtom);
        setLocalAtoms(newAtoms);
        // Do NOT notify update yet? Or yes?
        // If we add an empty block, maybe we don't save yet until they type?
        // If we save, it creates an empty atom.
        // Let's notify to keep state in sync.
        notifyUpdate(newAtoms);
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
                                attr: {},
                                field,
                                type: defaultAtomType,
                                creatorId: '', createdAt: '', contentHash: '', contentSimHash: '', frontMeta: {}, backMeta: {}
                            } as IContentAtom}
                            onUpdate={(content) => handleAtomUpdate(index, content)}
                            readOnly={readOnly}
                            className={!readOnly ? "pr-8" : ""}
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
