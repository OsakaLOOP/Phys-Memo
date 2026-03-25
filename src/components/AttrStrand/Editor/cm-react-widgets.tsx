import React from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { WidgetType } from '@codemirror/view';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { ImageGroupEditor } from './ImageGroupEditor';

const BinaryAtomEditorWrapper: React.FC<{ atomId: string }> = ({ atomId }) => {
    // We subscribe to the PARALLEL state since we are inside CM.
    const atom = useWorkspaceStore(state => state.cmDraftAtomsData[atomId] || state.draftAtomsData[atomId]);

    if (!atom || atom.type !== 'bin') return null;

    return (
        <div className="my-2 ml-4 mr-2 cm-binary-atom-container pointer-events-auto select-auto" onMouseDown={(e) => e.stopPropagation()}>
            <ImageGroupEditor
                blobs={atom.blobs || []}
                meta={atom.frontMeta as any}
                onUpdateMeta={(newMeta) => {
                    useWorkspaceStore.getState().updateAtomMeta(atomId, newMeta);
                    const currentParallel = useWorkspaceStore.getState().cmDraftAtomsData;
                    const fieldList = useWorkspaceStore.getState().cmDraftAtomLists[atom.field];
                    useWorkspaceStore.getState().syncCMToParallelState(atom.field, fieldList, {
                        ...currentParallel,
                        [atomId]: { ...currentParallel[atomId], frontMeta: newMeta as any }
                    });
                }}
                onUpdateBlobs={(newBlobs) => {
                    useWorkspaceStore.getState().updateAtomBlobs(atomId, newBlobs);
                    const currentParallel = useWorkspaceStore.getState().cmDraftAtomsData;
                    const fieldList = useWorkspaceStore.getState().cmDraftAtomLists[atom.field];
                    useWorkspaceStore.getState().syncCMToParallelState(atom.field, fieldList, {
                        ...currentParallel,
                        [atomId]: { ...currentParallel[atomId], blobs: newBlobs }
                    });
                }}
            />
        </div>
    );
};

export class BinaryAtomWidget extends WidgetType {
    atomId: string;
    root: Root | null = null;
    dom: HTMLElement | null = null;

    constructor(atomId: string) {
        super();
        this.atomId = atomId;
    }

    eq(other: BinaryAtomWidget) {
        return other.atomId === this.atomId;
    }

    toDOM() {
        if (this.dom) return this.dom;

        const wrap = document.createElement("div");
        wrap.className = "cm-binary-atom-wrapper pointer-events-auto select-auto";
        // Stop codemirror from capturing mouse events in the editor
        wrap.onmousedown = (e) => e.stopPropagation();

        this.root = createRoot(wrap);
        this.root.render(<BinaryAtomEditorWrapper atomId={this.atomId} />);

        this.dom = wrap;
        return wrap;
    }

    updateDOM() {
        return false; // we manage our own react updates, but if CM asks to update, we just say we didn't (React handles internal re-renders).
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
