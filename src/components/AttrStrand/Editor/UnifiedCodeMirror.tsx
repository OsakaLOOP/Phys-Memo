import React, { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, invertedEffects, undo, redo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';

import type { ContentAtomField, DraftId } from '../../../attrstrand/types';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { atomMapField, blockDecorations, setAtomMapEffect, addAtomEffect, removeAtomEffect, swapAtomEffect, syncAndSnapshotPlugin, blockActionGutter, strictMappingEditFilter, copyFormatterPlugin } from './cm-plugins';
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

    // Attach to the complete action (which unmounts or blurs depending on parent logic)
    // Actually, we'll expose this via a ref or let the parent component trigger it.
    // However, the simplest way is to listen to the activeEditor change or just commit on unmount.
    // The requirement is: "在 UI 层实现明确的完成编辑按钮。点击时提交最终状态"。
    // If the component unmounts when the user clicks 'Check' (because activeEditor becomes null),
    // we can safely commit snapshots in the unmount effect!
    useEffect(() => {
        return () => {
             // Because activeEditor controls whether UnifiedCodeMirror is mounted in FieldEditor,
             // when the user clicks "Check", this component will unmount.
             commitSnapshots();
        };
    }, []);

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
                // 提供 invertedEffects 以支持自定义 Effect 的撤销/重做
                invertedEffects.of(tr => {
                    const inverted = [];
                    for (const e of tr.effects) {
                        if (e.is(setAtomMapEffect)) {
                            inverted.push(setAtomMapEffect.of(tr.startState.field(atomMapField)));
                        } else if (e.is(addAtomEffect)) {
                            inverted.push(removeAtomEffect.of({ id: e.value.id }));
                        } else if (e.is(swapAtomEffect)) {
                            // 交换的逆操作还是交换同样的两个 index
                            inverted.push(swapAtomEffect.of({ indexA: e.value.indexA, indexB: e.value.indexB }));
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
                        width: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        userSelect: 'none'
                    },
                    ".cm-line": {
                        paddingLeft: "4px"
                    }
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
            view.destroy();
            viewRef.current = null;
        };
    }, [field]); // 挂载时执行, field 变化时重新执行（虽然通常不变化）

    // --- 2.5 监听全局 Undo/Redo 事件 ---
    useEffect(() => {
        if (!viewRef.current) return;
        const view = viewRef.current;

        const handleUndo = () => {
            if (activeEditor?.field === field) {
                undo({ state: view.state, dispatch: view.dispatch });
            }
        };
        const handleRedo = () => {
            if (activeEditor?.field === field) {
                redo({ state: view.state, dispatch: view.dispatch });
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
