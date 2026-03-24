import React, { useEffect, useRef } from 'react';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, invertedEffects, undo, redo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';

import type { ContentAtomField, DraftId } from '../../../attrstrand/types';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { atomMapField, blockDecorations, setAtomMapEffect, addAtomEffect, removeAtomEffect, swapAtomEffect, syncToZustandPlugin, blockActionGutter, strictMappingEditFilter, copyFormatterPlugin, crossMappingSelectionPlugin } from './cm-plugins';
import type { AtomMapping } from './cm-plugins';
import { lintGutter } from '@codemirror/lint';
import { atomBoundaryLinter } from './cm-lint';

interface UnifiedCodeMirrorProps {
    field: ContentAtomField;
    initialAtomIds: DraftId[];
}

interface EditorSnapshot {
    list: string[];
    data: Record<string, { id: string; content: string;  }>;
}

export const UnifiedCodeMirror: React.FC<UnifiedCodeMirrorProps> = ({ field, initialAtomIds }) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const activeEditor = useWorkspaceStore(state => state.activeEditor);
    const viewRef = useRef<EditorView | null>(null);
    const sessionSnapshots = useRef<EditorSnapshot[]>([]);

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

    // --- 4. 处理外部主追踪数据的强制更新（如撤销/其他终端同步） ---
    // 监听 Zustand 主追踪数据 (draftAtomLists / draftAtomsData) 的变化。
    // 如果主状态发生变化（比如点击了全局的 Undo 按钮，且当前 Editor 没激活，或是切换了草稿），
    // 并且这和 CM 当前的平行状态有本质不同，我们需要用这个新数据强制刷新 CodeMirror。
    useEffect(() => {
        let lastTrackedSignature = '';

        const unsubscribe = useWorkspaceStore.subscribe(
            (state, prevState) => {
                if (!viewRef.current) return;

                // 我们只关心 tracked (Zundo tracked) 的状态发生了变化
                const currentList = state.draftAtomLists[field] || [];
                const prevList = prevState.draftAtomLists[field] || [];

                // 如果列表引用和数据对象引用都没有变化，说明可能是 activeEditor 或者平行状态改变，忽略
                if (currentList === prevList && state.draftAtomsData === prevState.draftAtomsData) {
                     return;
                }

                // 计算当前 tracked 外部数据的签名
                const trackedSignature = currentList.map((id: string) => `${id}:${state.draftAtomsData[id]?.content || ''}`).join('|');

                // 如果签名没有任何变化（比如只是其他 field 发生了变化，或者空更新），跳过
                if (trackedSignature === lastTrackedSignature) {
                    return;
                }

                // 提取当前 CodeMirror 实例中的数据签名
                const view = viewRef.current;
                const mappings = view.state.field(atomMapField);
                const currentCMSignature = mappings.map(m => {
                    const text = view.state.sliceDoc(m.from, m.to);
                    return `${m.id}:${text}`;
                }).join('|');

                // 只有当 tracked 状态确实变了，且和当前 CM 里的状态不一样时，才执行覆盖
                // (如果相等，可能是我们自己刚刚 commit 回主状态的，没必要重置)
                if (trackedSignature === currentCMSignature) {
                    lastTrackedSignature = trackedSignature;
                    return;
                }

                // 如果不同，说明这是“外部力量”（比如点击了顶部的全局撤销按钮）
                // 我们必须强行用新数据覆盖当前 CM 实例的内容，并且重置平行状态。

                // --- 重置平行状态 ---
                useWorkspaceStore.getState().initParallelState(field);

                let newFullText = '';
                const newMappings: AtomMapping[] = [];
                const separator = '\n';
                let currentOffset = 0;

                for (let i = 0; i < currentList.length; i++) {
                    const id = currentList[i];
                    const content = state.draftAtomsData[id]?.content || '';

                    const from = currentOffset;
                    const to = currentOffset + content.length;
                    newMappings.push({ id, from, to });

                    newFullText += content;
                    if (i < currentList.length - 1) {
                        newFullText += separator;
                        currentOffset += content.length + separator.length;
                    }
                }

                // 派发带有 'external_sync' 标记的全量替换事务，这样内部的 syncPlugin 就不会再反向推回 Zustand
                viewRef.current.dispatch({
                    changes: { from: 0, to: viewRef.current.state.doc.length, insert: newFullText },
                    effects: setAtomMapEffect.of(newMappings),
                    annotations: Transaction.userEvent.of('external_sync')
                });

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
