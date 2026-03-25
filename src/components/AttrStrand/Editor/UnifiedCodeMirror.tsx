import React, { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, invertedEffects, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';

import type { ContentAtomField, DraftId } from '../../../attrstrand/types';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { atomMapField, blockDecorations, setAtomMapEffect, addAtomEffect, removeAtomEffect, swapAtomEffect, syncAndSnapshotPlugin, blockActionGutter, strictMappingEditFilter, copyFormatterPlugin, crossMappingSelectionPlugin } from './cm-plugins';
import type { AtomMapping, EditorSnapshot } from './cm-plugins';
import { lintGutter } from '@codemirror/lint';
import { atomBoundaryLinter } from './cm-lint';

interface UnifiedCodeMirrorProps {
    field: ContentAtomField;
    initialAtomIds: DraftId[];
}


export const UnifiedCodeMirror: React.FC<UnifiedCodeMirrorProps> = ({ field, initialAtomIds }) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const activeEditor = useWorkspaceStore(state => state.activeEditor);
    const viewRef = useRef<EditorView | null>(null);
    const sessionSnapshots = useRef<EditorSnapshot[]>([]);

    // Define a custom cleanup function to commit snapshots
    const commitSnapshots = () => {
        if (sessionSnapshots.current.length > 0) {
            useWorkspaceStore.getState().applyCMSnapshotsToZundo(field, sessionSnapshots.current);
            sessionSnapshots.current = []; // Clear after applying
        }
    };

    // 初始化文本, 映射表
    const buildInitialState = () => {
        const state = useWorkspaceStore.getState();
        const data = state.draftAtomsData;

        let fullText = '';
        const mappings: AtomMapping[] = [];

        // 使用单换行拼接
        const separator = '\n';
        let currentOffset = 0;

        for (let i = 0; i < initialAtomIds.length; i++) {
            const id = initialAtomIds[i];
            const content = data[id]?.content || '';

            // 记录此 Atom 在原始全文中的精确起止位置 [from, to]
            // 注意：只记录 content 本身的范围，separator 留在映射范围之外
            const from = currentOffset;
            const to = currentOffset + content.length;

            mappings.push({ id, from, to });

            // 拼接分割后全文
            fullText += content;
            if (i < initialAtomIds.length - 1) {
                fullText += separator;
                currentOffset += content.length + separator.length;
            } else {
                currentOffset += content.length;
            }
        }

        return { fullText, mappings };
    };

    // 初始化 CodeMirror 实例
    useEffect(() => {
        if (!editorRef.current) return;

        // 初始化平行状态
        useWorkspaceStore.getState().initParallelState(field);
        const { fullText, mappings } = buildInitialState();

        sessionSnapshots.current = [];

        const startState = EditorState.create({
            doc: fullText,
            extensions: [
                lineNumbers(),
                highlightActiveLineGutter(),
                history(),
                bracketMatching(),
                syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
                markdown({ base: markdownLanguage, codeLanguages: languages }),
                EditorView.lineWrapping,
                keymap.of([
                    ...defaultKeymap,
                    ...historyKeymap,
                    indentWithTab
                ]),
                // 核心状态机与装饰器
                atomMapField,
                strictMappingEditFilter,
                copyFormatterPlugin,
                crossMappingSelectionPlugin,
                // 提供 invertedEffects 以支持自定义 Effect 的撤销/重做
                invertedEffects.of(tr => {
                    const inverted = [];
                    for (const e of tr.effects) {
                        if (e.is(setAtomMapEffect) || e.is(addAtomEffect) || e.is(removeAtomEffect) || e.is(swapAtomEffect)) {
                            // 任何导致 mapping 数组发生结构性改变的操作，
                            // 其最完美的撤销/重做手段就是直接利用 `setAtomMapEffect` 将数组恢复至当时的切片快照。
                            // 这样既能防止由于单向 Effect (如 removeAtomEffect) 丢失重做信息导致的粘连错误，
                            // 又能在撤销执行时触发 `skipMapPos` 以免被错乱的 mapPos 破坏绝对位置。
                            inverted.push(setAtomMapEffect.of(tr.startState.field(atomMapField)));
                            break; // 只要发生结构改变，只记录一次全量快照即可
                        }
                    }
                    return inverted;
                }),
                blockDecorations(field),
                blockActionGutter, // 预留的左侧操作区和拖拽手柄
                // Linting 插件
                lintGutter(),
                atomBoundaryLinter(field),
                // 同步插件（负责打字时防抖更新 UI，并记录内部 Snapshot）
                syncAndSnapshotPlugin(field, (snapshot) => {
                    sessionSnapshots.current.push(snapshot);
                }),
                // 初始化时注入当前的映射表
                atomMapField.init(() => mappings),

                // 暂时简单的焦点处理
                EditorView.theme({
                    "&": {
                        fontSize: "14px",
                        outline: "none !important"
                    },
                    ".cm-content": {
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        padding: "1rem 0"
                    },
                    ".cm-atom-line": {
                        position: "relative"
                    },
                    ".cm-atom-gap-error": {
                        background: "repeating-linear-gradient(45deg, rgba(255,0,0,0.05), rgba(255,0,0,0.05) 2px, rgba(255,0,0,0) 2px, rgba(255,0,0,0) 13.86px)",
                        borderLeft: "2px solid rgba(255,0,0,0.3)",
                        marginLeft: "8px",
                        paddingLeft: "8px"
                    },
                    ".cm-block-action-gutter": {
                        width: '0px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        userSelect: 'none'
                    },
                    ".cm-line": {
                        paddingLeft: "4px"
                    },
                    ".cm-content > .cm-line:first-of-type": {
                        paddingTop: "16px"}
                })
            ]
        });

        const view = new EditorView({
            state: startState,
            parent: editorRef.current
        });

        viewRef.current = view;

        // 如果有初始焦点，立即滚动并聚焦
        if (activeEditor?.field === field && activeEditor?.id) {
            const mappings = view.state.field(atomMapField);
            const target = mappings.find(m => m.id === activeEditor.id);
            if (target) {
                view.dispatch({
                    selection: { anchor: target.from },
                    scrollIntoView: true
                });
                view.focus();
            }
        }

        return () => {
            commitSnapshots();
            view.destroy();
            viewRef.current = null;
        };
    }, [field]); // 挂载时执行, field 变化时重新执行（虽然通常不变化）

    // --- 2.5 监听全局 Undo/Redo 事件 ---
    useEffect(() => {
        if (!viewRef.current) return;
        const view = viewRef.current;

        const handleUndo = (e: Event) => {
            if (activeEditor?.field === field) {
                const isShift = (e as CustomEvent).detail?.shift;
                if (isShift) {
                    // Loop undo until depth is 0
                    let limit = 500; // prevent infinite loops just in case
                    while (undoDepth(view.state) > 0 && limit-- > 0) {
                        undo({ state: view.state, dispatch: view.dispatch });
                    }
                } else {
                    undo({ state: view.state, dispatch: view.dispatch });
                }
            }
        };
        const handleRedo = (e: Event) => {
            if (activeEditor?.field === field) {
                const isShift = (e as CustomEvent).detail?.shift;
                if (isShift) {
                    let limit = 500;
                    while (redoDepth(view.state) > 0 && limit-- > 0) {
                        redo({ state: view.state, dispatch: view.dispatch });
                    }
                } else {
                    redo({ state: view.state, dispatch: view.dispatch });
                }
            }
        };

        document.addEventListener('editor-undo', handleUndo);
        document.addEventListener('editor-redo', handleRedo);

        return () => {
            document.removeEventListener('editor-undo', handleUndo);
            document.removeEventListener('editor-redo', handleRedo);
        };
    }, [activeEditor?.field, field]);

    // --- 3. 监听初始焦点的变化 ---
    useEffect(() => {
        if (!viewRef.current || !activeEditor || activeEditor.field !== field) return;
        const view = viewRef.current;
        const mappings = view.state.field(atomMapField);
        const target = mappings.find(m => m.id === activeEditor.id);

        if (target) {
            // Check if cursor is already within the target atom
            const mainSelection = view.state.selection.main;
            const isWithinTarget = mainSelection.from >= target.from && mainSelection.to <= target.to;
            if (!isWithinTarget) {
                view.dispatch({
                    selection: { anchor: target.from },
                    scrollIntoView: true
                });
                if (!view.hasFocus) {
                    view.focus();
                }
            }
        }
    }, [activeEditor?.id, field]);


    return (
        <div
            ref={editorRef}
            className="w-full bg-white border border-slate-200 rounded-lg shadow-sm focus-within:ring-2 focus-within:ring-indigo-200 focus-within:border-indigo-400 overflow-hidden"
        />
    );
};
