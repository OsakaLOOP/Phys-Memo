import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { EditorView, WidgetType } from '@codemirror/view';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { ImageGroupEditor } from './ImageGroupEditor';
import { ImageGroupViewer } from './ImageGroupViewer';

const BinaryAtomEditorWrapper: React.FC<{
    atomId: string;
    view: EditorView;
    getPos: () => number;
    jsonText: string;
}> = ({ atomId, view, getPos, jsonText }) => {
    // We subscribe to the PARALLEL state to get the blobs map.
    // However, the metadata (caption, images) comes strictly from jsonText to support CM undo/redo!
    const atom = useWorkspaceStore(state => state.cmDraftAtomsData[atomId] || state.draftAtomsData[atomId]);
    const activeEditor = useWorkspaceStore(state => state.activeEditor);

    const [isEditing, setIsEditing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    let parsedMeta: any = { images: [] };
    try {
        if (jsonText && jsonText.trim().startsWith('{')) {
            parsedMeta = JSON.parse(jsonText);
        }
    } catch (e) {
        // ignore
    }

    const isActive = activeEditor?.id === atomId;

    useEffect(() => {
        if (isActive) {
            setIsEditing(true);
            // Focus caption input on mount/active
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                }
            }, 0);
        } else {
            setIsEditing(false);
        }
    }, [isActive]);

    if (!atom || atom.type !== 'bin') return null;

    const handleUpdateMeta = (newMeta: any) => {
        const from = getPos();
        // Calculate length based on the current document string length
        // We know the current JSON length is jsonText.length, but it's safer to just replace from to from + jsonText.length
        // Wait, if jsonText is passed, from + jsonText.length should be right.
        const to = from + jsonText.length;

        const newJsonString = JSON.stringify(newMeta);

        view.dispatch({
            changes: { from, to, insert: newJsonString },
            annotations: [/* Any custom annotations if needed */]
        });
    };

    const handleUpdateBlobs = (newBlobs: Record<string, Blob | ArrayBuffer>) => {
        useWorkspaceStore.getState().updateAtomBlobs(atomId, newBlobs);
    };

    return (
        <div
            className={`my-2 ml-4 mr-2 p-2 rounded-lg transition-colors cm-binary-atom-container pointer-events-auto select-auto ${isEditing ? 'bg-indigo-50/30 ring-1 ring-indigo-200' : 'hover:bg-slate-50 cursor-pointer'}`}
            onMouseDown={(e) => {
                e.stopPropagation();
                if (!isEditing) {
                    useWorkspaceStore.getState().setActiveEditor({ field: atom.field, id: atomId });
                }
            }}
        >
            {isEditing ? (
                <ImageGroupEditor
                    blobs={atom.blobs || {}}
                    meta={parsedMeta}
                    onUpdateMeta={handleUpdateMeta}
                    onUpdateBlobs={handleUpdateBlobs}
                    inputRef={inputRef}
                />
            ) : (
                <ImageGroupViewer
                    blobs={atom.blobs || {}}
                    meta={parsedMeta}
                />
            )}
        </div>
    );
};

export class BinaryAtomWidget extends WidgetType {
    atomId: string;
    jsonText: string;
    getPos: () => number;
    view: EditorView;
    root: Root | null = null;
    dom: HTMLElement | null = null;

    constructor(atomId: string, jsonText: string, getPos: () => number, view: EditorView) {
        super();
        this.atomId = atomId;
        this.jsonText = jsonText;
        this.getPos = getPos;
        this.view = view;
    }

    eq(other: BinaryAtomWidget) {
        return other.atomId === this.atomId && other.jsonText === this.jsonText;
    }

    toDOM() {
        if (this.dom) return this.dom;

        const wrap = document.createElement("div");
        wrap.className = "cm-binary-atom-wrapper pointer-events-auto select-auto";
        // Stop codemirror from capturing mouse events in the editor
        wrap.onmousedown = (e) => e.stopPropagation();

        this.root = createRoot(wrap);
        this.root.render(
            <BinaryAtomEditorWrapper
                atomId={this.atomId}
                view={this.view}
                getPos={this.getPos}
                jsonText={this.jsonText}
            />
        );

        this.dom = wrap;
        return wrap;
    }

    updateDOM(_dom: HTMLElement, view: EditorView) {
        // We intercept updates so we don't recreate the DOM when jsonText changes slightly.
        // We just re-render React with the new props.
        if (this.root) {
            this.view = view; // update view just in case
            this.root.render(
                <BinaryAtomEditorWrapper
                    atomId={this.atomId}
                    view={this.view}
                    getPos={this.getPos}
                    jsonText={this.jsonText}
                />
            );
            return true;
        }
        return false;
    }

    destroy() {
        if (this.root) {
            const root = this.root;
            setTimeout(() => {
                root.unmount();
            }, 0);
        }
    }
}
