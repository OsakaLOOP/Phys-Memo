import React, { useState, useEffect, useMemo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DraftId } from '../../attrstrand/types';
import RichTextRenderer from '../RichTextRenderer';
import { Edit3, Check, X } from 'lucide-react';
import { calculateDiffStats } from '../../attrstrand/utils';
import { CopyrightTooltip } from './CopyrightTooltip';

import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';

interface AtomBlockProps {
    atomId: DraftId;
    readOnly?: boolean;
    className?: string;
    index?: number;
}

export const AtomBlock: React.FC<AtomBlockProps> = ({ atomId, readOnly = false, className = '', index = 0 }) => {
    // Subscribe specifically to this atom's data
    const atom = useWorkspaceStore((state) => state.draftAtomsData[atomId]);
    const updateAtomContent = useWorkspaceStore((state) => state.updateAtomContent);
    const activeEditor = useWorkspaceStore((state) => state.activeEditor);
    const setActiveEditor = useWorkspaceStore((state) => state.setActiveEditor);

    const isTags = atom?.field === 'tags';
    const isRefs = atom?.field === 'refs';
    const isMultilineEditor = atom?.field === 'core' || atom?.field === 'doc';

    const [isEditingLocal, setIsEditingLocal] = useState(false);
    const isEditing = isMultilineEditor ? (activeEditor?.id === atomId) : isEditingLocal;

    const [editValue, setEditValue] = useState(atom?.content || '');
    const [initialContent] = useState(atom?.content || '');

    useEffect(() => {
        if (atom && !isEditing) {
            setEditValue(atom.content);
        }
    }, [atom?.content, isEditing]);

    if (!atom) return null; // Defensive check

    const handleSave = (valToSave?: string, exit: boolean = true) => {
        const finalVal = valToSave !== undefined ? valToSave : editValue;
        if (finalVal !== atom.content) {
            updateAtomContent(atomId, finalVal);
        }
        if (exit) {
            if (isMultilineEditor) {
                // Only clear if this is still the active editor
                if (useWorkspaceStore.getState().activeEditor?.id === atomId) {
                    setActiveEditor(null);
                }
            } else {
                setIsEditingLocal(false);
            }
        }
    };

    const handleCancel = () => {
        // As requested: Esc should now "exit and save" rather than cancel
        handleSave();
    };

    const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isEditing || readOnly) return;
        const target = e.target as HTMLElement;
        if (target.tagName === 'A' || target.closest('a') || target.closest('.ref-link')) return;
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) return;
        if (isMultilineEditor) {
            setActiveEditor({ field: atom.field, id: atomId });
        } else {
            setIsEditingLocal(true);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
             if (isTags || isRefs) {
                 handleSave();
             } else if (e.metaKey || e.ctrlKey) {
                 handleSave();
             }
        } else if (e.key === 'Escape') {
            handleCancel();
        }
    };

    const handleCodeMirrorKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            handleSave();
            e.preventDefault();
        } else if (e.key === 'Escape') {
            handleSave();
            e.preventDefault();
        }
    };

    const handleArrowNav = (view: EditorView, key: 'ArrowUp' | 'ArrowDown') => {
        if (!isMultilineEditor || !atom.field) return false;

        const state = view.state;
        const mainSel = state.selection.main;

        // Ensure we are dealing with a single cursor, not a selection
        if (!mainSel.empty) return false;

        const line = state.doc.lineAt(mainSel.head);

        if (key === 'ArrowUp') {
            // First line
            if (line.number === 1) {
                const currentDraftAtomLists = useWorkspaceStore.getState().draftAtomLists;
                const list = currentDraftAtomLists[atom.field] || [];
                const currentIndex = list.indexOf(atomId);
                if (currentIndex > 0) {
                    handleSave(view.state.doc.toString(), false);
                    setActiveEditor({ field: atom.field, id: list[currentIndex - 1] });
                    return true;
                }
            }
        } else if (key === 'ArrowDown') {
            // Last line
            if (line.number === state.doc.lines) {
                const currentDraftAtomLists = useWorkspaceStore.getState().draftAtomLists;
                const list = currentDraftAtomLists[atom.field] || [];
                const currentIndex = list.indexOf(atomId);
                if (currentIndex >= 0 && currentIndex < list.length - 1) {
                    handleSave(view.state.doc.toString(), false);
                    setActiveEditor({ field: atom.field, id: list[currentIndex + 1] });
                    return true;
                }
            }
        }
        return false;
    };

    // attr 的初始值
    const attr = (atom as any).attr || { 'user': 1 };
    const authors = Object.entries(attr);
    const n = authors.length;
    const adjustedAuthors = authors.map(([author, share]) => {
        const adjustedShare = (Number(share) + (n > 0 ? (0.1 / n) : 0)) / 1.1;
        return { author, share: adjustedShare };
    }).sort((a, b) => b.share - a.share);// 一个奇怪但有用的显示时调整.

    // 乐观计算实时 diff 用于显示.
    const displayDiff = useMemo(() => {
        if (isEditing || atom.isDirty) {
            // 新增的 initialState  用于标记后端原始数据, 计算当前 workspace 总 diff.
            return calculateDiffStats(initialContent, isEditing ? editValue : atom.content);
        } else {
            return {
                added: atom.diffAdded !== undefined ? atom.diffAdded : (atom.content?.length || 0),
                deleted: atom.diffDeleted || 0,
                retained: atom.diffRetained || 0,
            };
        }
    }, [isEditing, atom.isDirty, initialContent, editValue, atom.content, atom.diffAdded, atom.diffDeleted, atom.diffRetained]);

    const renderContent = () => {
        if (!atom.content) return <span className="text-slate-300 italic text-sm">点击编辑内容...</span>;

        if (isTags) {
            return (
                <span className="inline-flex-center badge-base bg-yellow-50 text-yellow-700 border-yellow-200">
                    <RichTextRenderer content={atom.content} className="inline-block [&>p]:inline [&>p]:m-0" />
                </span>
            );
        }

        if (isRefs) {
            return (
                <div id={`ref-${index + 1}`} className="flex gap-2 items-start text-sm text-slate-600 transition-colors duration-300 rounded p-1">
                    <span className="font-mono text-slate-400 select-none pt-0.5">{index + 1}.</span>
                    <div className="flex-1">
                        <RichTextRenderer content={atom.content} className="inline-block" />
                    </div>
                </div>
            );
        }

        return <RichTextRenderer content={atom.content} enableAnalysis={true} />;
    };

    const renderEditor = () => {
        if (isTags) {
             return (
                 <input
                    type="text"
                    className="
                        w-full h-full p-1 pl-2 pr-[3.5rem] text-sm font-medium rounded-lg outline-none
                        bg-[#f8fafc] border border-indigo-300 text-slate-700
                        shadow-[0_4px_12px_-2px_rgba(0,0,0,0.1),_0_0_0_2px_#e0e7ff]
                        focus:bg-white focus:border-indigo-400 focus:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.1),_0_0_0_2px_#c7d2fe]
                        transition-all
                    "
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={undefined}
                    autoFocus
                    placeholder="标签..."
                 />
             );
        }

         if (isRefs) {
             return (
                 <textarea
                    className="w-full min-h-[60px] p-2 text-sm input-bordered border-indigo-500 rounded resize-y font-mono"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    placeholder="引用..."
                 />
             );
        }

        if (isMultilineEditor) {
            return (
                <div className="w-full bg-white border-2 border-indigo-400 rounded-lg shadow-inner focus-within:outline-none overflow-hidden font-mono text-sm leading-relaxed"
                     onBlur={(e) => {
                         // Only save if focus actually left the CodeMirror container completely
                         if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                             handleSave(editValue);
                         }
                     }}
                     onKeyDown={handleCodeMirrorKeyDown}
                >
                    <CodeMirror
                        value={editValue}
                        minHeight="100px"
                        extensions={[
                            markdown({ base: markdownLanguage, codeLanguages: languages }),
                            EditorView.lineWrapping,
                            EditorView.domEventHandlers({
                                keydown: (e, view) => {
                                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                        if (handleArrowNav(view, e.key)) {
                                            e.preventDefault();
                                            return true;
                                        }
                                    }
                                    return false;
                                }
                            })
                        ]}
                        onChange={(value) => setEditValue(value)}
                        autoFocus
                        basicSetup={{
                            lineNumbers: true,
                            highlightActiveLineGutter: true,
                            foldGutter: true,
                            dropCursor: true,
                            allowMultipleSelections: true,
                            indentOnInput: true,
                            syntaxHighlighting: true,
                            bracketMatching: true,
                            closeBrackets: true,
                            autocompletion: true,
                            rectangularSelection: true,
                            crosshairCursor: true,
                            highlightActiveLine: false,
                            highlightSelectionMatches: true,
                            closeBracketsKeymap: true,
                            defaultKeymap: true,
                            searchKeymap: true,
                            historyKeymap: true,
                            foldKeymap: true,
                            completionKeymap: true,
                            lintKeymap: true,
                        }}
                    />
                </div>
            );
        }

        return null;
    }

    return (
        <div className={`group relative ${atom.field!=='core'&&atom.field!=='doc'?'mb-2':''} transition-all ${isTags ? 'inline-block mr-2 ' : ''} ${className}`}>
            <div className="absolute right-full top-0 bottom-0 w-1 mr-2 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-indigo-200 cursor-help z-50">
                <CopyrightTooltip
                    className="absolute left-3 top-full mt-1 hidden group-hover:block pointer-events-auto"
                    authors={adjustedAuthors}
                    diffAdded={displayDiff.added}
                    diffDeleted={displayDiff.deleted}
                    diffRetained={displayDiff.retained}
                    itemId={atom.id}
                />
            </div>

            {isEditing ? (
                isTags ? (
                    <div className="relative min-w-[200px] h-[32px] z-50 overflow-visible">
                        <div
                            className="absolute top-0 left-0 bottom-0"
                            style={{
                                width: `max(200px, calc(${editValue.length}ch + 4rem))`,
                                maxWidth: '400px',
                            }}
                        >
                            {renderEditor()}
                            <div className="absolute right-1 top-0 bottom-0 flex gap-1 items-center z-[60]">
                                <button
                                    onMouseDown={(e) => { e.preventDefault(); handleSave(); }}
                                    onClick={() => handleSave()}
                                    className="p-1 rounded transition-colors flex items-center justify-center w-5 h-5 bg-green-100/90 text-green-600 hover:bg-green-200 shadow-sm"
                                    title="保存 (Enter / Ctrl+Enter)"
                                >
                                    <Check size={12} strokeWidth={2.5} />
                                </button>
                                <button
                                    onMouseDown={(e) => { e.preventDefault(); handleCancel(); }}
                                    onClick={handleCancel}
                                    className="p-1 rounded transition-colors flex items-center justify-center w-5 h-5 bg-red-100/90 text-red-500 hover:bg-red-200 shadow-sm"
                                    title="取消 (Esc)"
                                >
                                    <X size={12} strokeWidth={2.5} />
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="relative min-w-[200px]">
                        {renderEditor()}
                        {!isMultilineEditor && (
                            <div className="absolute top-1 right-1 flex gap-1 z-[60]">
                                <button
                                    onMouseDown={(e) => { e.preventDefault(); handleSave(); }}
                                    onClick={() => handleSave()}
                                    className="p-1 rounded transition-colors flex items-center justify-center w-5 h-5 bg-green-100 text-green-700 hover:bg-green-200"
                                    title={`保存 (${isRefs ? 'Enter / ' : ''}Ctrl+Enter)`}
                                >
                                    <Check size={12} strokeWidth={2} />
                                </button>
                                <button
                                    onMouseDown={(e) => { e.preventDefault(); handleCancel(); }}
                                    onClick={handleCancel}
                                    className="p-1 rounded transition-colors flex items-center justify-center w-5 h-5 btn-danger bg-red-100"
                                    title="取消 (Esc)"
                                >
                                    <X size={12} strokeWidth={2} />
                                </button>
                            </div>
                        )}
                    </div>
                )
            ) : (
                <div
                    onClick={handleContainerClick}
                    className={`
                        rounded transition-colors relative
                        ${!readOnly ? 'cursor-pointer hover:bg-slate-50' : ''}
                        ${isTags ? '' : 'min-h-[2rem] p-2 border border-transparent hover:border-slate-200'}
                    `}
                >
                   {renderContent()}

                   {!readOnly && atom.field !== 'tags' && atom.field !== 'refs' && (
                       <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                           <Edit3 className="w-4 h-4 text-indigo-300" />
                       </div>
                   )}
                </div>
            )}
        </div>
    );
};
