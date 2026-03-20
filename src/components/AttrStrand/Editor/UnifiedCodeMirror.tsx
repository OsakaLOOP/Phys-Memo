import React, { useEffect, useRef } from 'react';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';

import type { ContentAtomField, DraftId } from '../../../attrstrand/types';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { atomMapField, blockDecorations, setAtomMapEffect, syncToZustandPlugin, blockActionGutter } from './cm-plugins';
import type { AtomMapping } from './cm-plugins';

interface UnifiedCodeMirrorProps {
    field: ContentAtomField;
    initialAtomIds: DraftId[];
}

export const UnifiedCodeMirror: React.FC<UnifiedCodeMirrorProps> = ({ field, initialAtomIds }) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    // 缓存上一次同步给外部的数据签名，防止外部数据回来时造成的死循环重全量渲染
    // 弃用，改为直接对比当前 view.state 内容

    // --- 1. 组装初始的文本与映射表 ---
    const buildInitialState = () => {
        const state = useWorkspaceStore.getState();
        const data = state.draftAtomsData;

        let fullText = '';
        const mappings: AtomMapping[] = [];

        // 核心：使用标准的 Markdown 双换行作为物理拼接符
        const separator = '\n\n';
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

        const { fullText, mappings } = buildInitialState();

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
                blockDecorations,
                blockActionGutter, // 预留的左侧操作区和拖拽手柄
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
                        position: "relative",
                        backgroundColor: "#fafafa" // 模拟轻微的高亮包裹感
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

        return () => {
            view.destroy();
            viewRef.current = null;
        };
    }, []); // 仅挂载时执行

    // --- 3. 处理外部强制更新（如撤销/其他终端同步） ---
    useEffect(() => {
        const unsubscribe = useWorkspaceStore.subscribe(
            (state) => {
                const currentIds = state.draftAtomLists[field] || [];
                const currentData = state.draftAtomsData;

                const view = viewRef.current;
                if (!view) return;

                const currentMappings = view.state.field(atomMapField);

                // --- 终极死循环拦截器 ---
                // 我们直接比对 Zustand 的数据和 CM 当前显示的真实数据。
                // 如果它们完全一致，说明 Zustand 的更新是由我们 CM 自己触发的（打字同步），
                // 或者是无意义的重渲染。我们必须立刻 return，绝对不能重置 CM 的 doc！

                let isIdentical = true;

                if (currentIds.length !== currentMappings.length) {
                    isIdentical = false;
                } else {
                    for (let i = 0; i < currentMappings.length; i++) {
                        const m = currentMappings[i];
                        if (m.id !== currentIds[i]) {
                            isIdentical = false; // ID 顺序变了
                            break;
                        }

                        // 从 CM 取出现有的文本 (带防越界)
                        const safeFrom = Math.max(0, Math.min(m.from, view.state.doc.length));
                        const safeTo = Math.max(safeFrom, Math.min(m.to, view.state.doc.length));
                        const cmText = view.state.sliceDoc(safeFrom, safeTo).trimEnd();

                        // 从 Zustand 取出预期的文本
                        const zustandText = currentData[m.id]?.content || '';

                        if (cmText !== zustandText) {
                            isIdentical = false; // 文本有差异
                            break;
                        }
                    }
                }

                // 如果两边数据一致，直接无视这次 Zustand 的更新广播
                if (isIdentical) {
                    return;
                }

                // --- 如果不一致，说明真的是从外部（如撤销栈、另一个编辑器）传来的更新 ---
                // 必须强行用 Zustand 数据重新拼接并覆盖整个 CM
                let newFullText = '';
                const newMappings: AtomMapping[] = [];
                const separator = '\n\n';
                let currentOffset = 0;

                for (let i = 0; i < currentIds.length; i++) {
                    const id = currentIds[i];
                    const content = currentData[id]?.content || '';

                    const from = currentOffset;
                    const to = currentOffset + content.length;
                    newMappings.push({ id, from, to });

                    newFullText += content;
                    if (i < currentIds.length - 1) {
                        newFullText += separator;
                        currentOffset += content.length + separator.length;
                    }
                }

                view.dispatch({
                    changes: { from: 0, to: view.state.doc.length, insert: newFullText },
                    effects: setAtomMapEffect.of(newMappings),
                    annotations: Transaction.userEvent.of('external_sync')
                });
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
