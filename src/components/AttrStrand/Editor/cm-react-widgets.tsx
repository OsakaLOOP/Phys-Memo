import React from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { WidgetType } from '@codemirror/view';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { ImageGroupEditor } from './ImageGroupEditor';
import { ImageGroupViewer } from './ImageGroupViewer';
import { EditorView } from '@codemirror/view';

const BinaryAtomEditorWrapper: React.FC<{ atomId: string }> = ({ atomId }) => {
    // We subscribe to the PARALLEL state since we are inside CM.
    const atom = useWorkspaceStore(state => state.cmDraftAtomsData[atomId] || state.draftAtomsData[atomId]);
    const [isFocused, setIsFocused] = React.useState(false);

    // We can't cleanly get EditorView from the widget without architectural changes.
    // Instead of intercepting CM selections, we'll let this be an interactive block that just stays focused while we click in it.
    // We handle blur to exit edit mode if we click outside.
    const containerRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const handleDocClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsFocused(false);
            }
        };
        document.addEventListener('mousedown', handleDocClick);
        return () => {
            document.removeEventListener('mousedown', handleDocClick);
        };
    }, []);

    if (!atom || atom.type !== 'bin') return null;

    // Parse meta from content JSON
    let meta: any = { images: [] };
    try {
        const parsed = JSON.parse(atom.content || '{}');
        if (parsed.images) meta = parsed;
    } catch (e) {
        // Fallback
    }

    return (
        <div
            ref={containerRef}
            className={`my-2 ml-4 mr-2 cm-binary-atom-container pointer-events-auto select-auto border-2 border-transparent transition-all ${isFocused ? 'hover:border-indigo-100' : ''} rounded-lg`}
            onMouseDown={(e) => {
                // When clicking inside the widget, prevent CodeMirror from moving its native cursor into the JSON string
                // This ensures the JSON is not accidentally editable
                e.stopPropagation();
                e.preventDefault();
                if (!isFocused) {
                    setIsFocused(true);
                }
            }}
        >
            {isFocused ? (
                <div className="cursor-auto" onMouseDown={(e) => e.stopPropagation()}>
                    <ImageGroupEditor
                        blobs={atom.blobs || {}}
                        meta={meta}
                        onUpdateMeta={(newMeta) => {
                            const newContent = JSON.stringify(newMeta);

                            // 1. Dispatch Codemirror transaction to update text document and keep undo history
                            if (containerRef.current) {
                                const view = EditorView.findFromDOM(containerRef.current);
                                if (view) {
                                    // Need to find the mapped atom to get the exact `from` / `to` position
                                    import('./cm-plugins').then(({ atomMapField }) => {
                                        import('@codemirror/state').then(({ Transaction }) => {
                                            const mappings = view.state.field(atomMapField);
                                            const m = mappings.find((mapping: any) => mapping.id === atomId);
                                            if (m) {
                                                view.dispatch({
                                                    changes: { from: m.from, to: m.to, insert: newContent },
                                                    annotations: Transaction.userEvent.of('input') // Ensure sync And Snapshot catches it.
                                                });
                                            }
                                        });
                                    });
                                }
                            }

                            // 2. Also manually update state just in case, though the text change above will trigger syncAndSnapshotPlugin
                            useWorkspaceStore.getState().updateAtomMeta(atomId, newMeta);
                            const currentParallel = useWorkspaceStore.getState().cmDraftAtomsData;
                            const fieldList = useWorkspaceStore.getState().cmDraftAtomLists[atom.field];
                            useWorkspaceStore.getState().syncCMToParallelState(atom.field, fieldList, {
                                ...currentParallel,
                                [atomId]: { ...currentParallel[atomId], content: newContent }
                            });
                        }}
                        onUpdateBlobs={(newBlobs) => {
                            useWorkspaceStore.getState().updateAtomBlobs(atomId, newBlobs);
                            const currentParallel = useWorkspaceStore.getState().cmDraftAtomsData;
                            const fieldList = useWorkspaceStore.getState().cmDraftAtomLists[atom.field];
                            useWorkspaceStore.getState().syncCMToParallelState(atom.field, fieldList, {
                                ...currentParallel,
                                [atomId]: { ...currentParallel[atomId], blobs: newBlobs } as any
                            });
                        }}
                    />
                </div>
            ) : (
                <div className="cursor-pointer relative">
                    <ImageGroupViewer blobs={atom.blobs || {}} meta={meta} />
                    {/* Add a fade to indicate it can be expanded/edited if it's very tall */}
                    <div className="absolute inset-0 hover:bg-black/5 transition-colors pointer-events-none rounded-lg" />
                </div>
            )}
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
