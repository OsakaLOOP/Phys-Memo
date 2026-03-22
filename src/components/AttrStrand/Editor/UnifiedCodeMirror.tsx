import React, { useEffect, useRef } from 'react';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, invertedEffects, undo, redo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';

import type { ContentAtomField, DraftId } from '../../../attrstrand/types';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { atomMapField, blockDecorations, setAtomMapEffect, syncToZustandPlugin, blockActionGutter } from './cm-plugins';
import type { AtomMapping } from './cm-plugins';
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

    // --- 1. 组装初始的文本与映射表 ---
    const buildInitialState = () => {
        const state = useWorkspaceStore.getState();
        const data = state.draftAtomsData;

        let fullText = '';
        const mappings: AtomMapping[] = [];

        // 核心：使用单换行作为物理拼接符
        const separator = '\n';
        let currentOffset = 0;

        for (let i = 0; i < initialAtomIds.length; i++) {
            const id = initialAtomIds[i];
            const content = data[id]?.content || '';

            // 记录此 Atom 在全文中的精确起止位置 [from, to]
            // 注意：我们只记录 content 本身的范围，把 separator 留在映射范围之外
            const from = currentOffset;
            const to = currentOffset + content.length;

            mappings.push({ id, from, to });

            // 拼接入全文
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

    // --- 2. 初始化 CodeMirror 实例 ---
    useEffect(() => {
        if (!editorRef.current) return;

        // Initialize parallel state for this field
        useWorkspaceStore.getState().initParallelState(field);

        const { fullText, mappings } = buildInitialState();

        // 处理失去焦点时正式提交 Parallel State 到 Zundo (以及其他 EditorView 相关的监听)
        const blurCommitExtension = EditorView.domEventHandlers({
            blur: (event, view) => {
                // If blur is triggered by clicking something *inside* the editor (like the add button),
                // we should NOT commit and exit. The relatedTarget points to the element getting focus.
                if (event.relatedTarget && view.dom.contains(event.relatedTarget as Node)) {
                    return false;
                }

                // Commit parallel state back to main zundo-tracked state
                useWorkspaceStore.getState().commitCMStateToZundo(field);
                return false;
            }
        });

        const startState = EditorState.create({
            doc: fullText,
            extensions: [
                blurCommitExtension,
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
                // 提供 invertedEffects 以支持自定义 Effect 的撤销/重做
                // 当通过 setAtomMapEffect 进行全量重组时，它的反转效果就是恢复回之前的旧映射表
                invertedEffects.of(tr => {
                    const inverted = [];
                    for (const e of tr.effects) {
                        if (e.is(setAtomMapEffect)) {
                            inverted.push(setAtomMapEffect.of(tr.startState.field(atomMapField)));
                        }
                    }
                    return inverted;
                }),
                blockDecorations(field),
                blockActionGutter, // 预留的左侧操作区和拖拽手柄
                // Linting 插件
                lintGutter(),
                atomBoundaryLinter(field),
                // 同步插件（负责打字时防抖更新 Zustand）
                syncToZustandPlugin(field),
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
            // Also commit when the component unmounts entirely (e.g. switching views)
            useWorkspaceStore.getState().commitCMStateToZundo(field);
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

    // --- 4. 监听重组标志进行完整解析替换 ---
    // 当在 UI 点击“新增/交换”或者全局 Undo 导致外部状态变化时，
    // cmStructuralRebuildFlag 会改变，触发 CodeMirror 进行全量重建。
    // 这将被计入 CM 的 history，且可通过 Cmd+Z 完美撤销。
    useEffect(() => {
        let lastFlag = useWorkspaceStore.getState().cmStructuralRebuildFlag[field];

        const unsubscribe = useWorkspaceStore.subscribe(
            (state) => {
                if (!viewRef.current) return;
                const currentFlag = state.cmStructuralRebuildFlag[field];

                if (currentFlag !== lastFlag) {
                    lastFlag = currentFlag;

                    const view = viewRef.current;
                    const currentList = state.cmDraftAtomLists[field] || [];
                    const currentData = state.cmDraftAtomsData;

                    let newFullText = '';
                    const newMappings: AtomMapping[] = [];
                    const separator = '\n';
                    let currentOffset = 0;

                    for (let i = 0; i < currentList.length; i++) {
                        const id = currentList[i];
                        const content = currentData[id]?.content || '';

                        const from = currentOffset;
                        const to = currentOffset + content.length;
                        newMappings.push({ id, from, to });

                        newFullText += content;
                        if (i < currentList.length - 1) {
                            newFullText += separator;
                            currentOffset += content.length + separator.length;
                        }
                    }

                    // 派发全量替换事务
                    // 注意：这里我们不使用 external_sync，而是使用 structural_rebuild
                    // 这样 syncToZustandPlugin 会正常处理它，但因为它和我们刚构建的状态一样，不会引发死循环。
                    // 并且因为我们在 invertedEffects 里注册了 setAtomMapEffect，这个 Transaction 可以被 CM 完美 Undo！
                    view.dispatch({
                        changes: { from: 0, to: view.state.doc.length, insert: newFullText },
                        effects: setAtomMapEffect.of(newMappings),
                        annotations: Transaction.userEvent.of('structural_rebuild')
                    });
                }
            }
        );

        return () => unsubscribe();
    }, [field]);

    // --- 5. 处理外部主追踪数据的强制更新（如撤销/其他终端同步） ---
    // 如果主状态发生变化（比如点击了全局的 Undo 按钮，且当前 Editor 没激活，或是切换了草稿），
    // 我们只需将其重置到 平行状态，然后 initParallelState 内部会增加 rebuild 标志，
    // 从而触发上面的 useEffect 负责重建。
    useEffect(() => {
        let lastTrackedSignature = '';

        const unsubscribe = useWorkspaceStore.subscribe(
            (state, prevState) => {
                const currentList = state.draftAtomLists[field] || [];
                const prevList = prevState.draftAtomLists[field] || [];

                if (currentList === prevList && state.draftAtomsData === prevState.draftAtomsData) {
                     return;
                }

                const trackedSignature = currentList.map((id: string) => `${id}:${state.draftAtomsData[id]?.content || ''}`).join('|');
                if (trackedSignature === lastTrackedSignature) {
                    return;
                }

                // --- 重置平行状态并触发重建标志 ---
                useWorkspaceStore.getState().initParallelState(field);
                lastTrackedSignature = trackedSignature;
            }
        );

        return () => unsubscribe();
    }, [field]);

    return (
        <div
            ref={editorRef}
            className="w-full bg-white border border-slate-200 rounded-lg shadow-sm focus-within:ring-2 focus-within:ring-indigo-200 focus-within:border-indigo-400 overflow-hidden"
        />
    );
};
