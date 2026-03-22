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
                        position: "relative",
                        backgroundColor: "#fafafa" // 模拟轻微的高亮包裹感
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
    }, []); // 仅挂载时执行

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

    // --- 4. 处理外部强制更新（如撤销/其他终端同步） ---
    // 监听 Zustand 数据的变化。如果是用户在当前 CM 打字导致的更新，我们之前在插件里同步过了，这里要拦截。
    useEffect(() => {
        const unsubscribe = useWorkspaceStore.subscribe(
            (state) => {
                const current = {
                    ids: state.draftAtomLists[field] || [],
                    data: state.draftAtomsData
                };

                if (!viewRef.current) return;

                // 计算当前外部数据的签名
                const currentSignature = current.ids.map((id: string) => `${id}:${current.data[id]?.content || ''}`).join('|');

                // 实时提取当前 CodeMirror 实例中的数据签名，直接与 Zustand 的新签名比对
                const view = viewRef.current;
                const mappings = view.state.field(atomMapField);
                // 必须保证当前的映射数量和顺序与我们要同步的 ids 一致（或者仅对比内容，但严格来说数量顺序也代表状态）
                const currentCMSignature = mappings.map(m => {
                    // sliceDoc 获取当前块内的最新文本
                    const text = view.state.sliceDoc(m.from, m.to);
                    return `${m.id}:${text}`;
                }).join('|');

                // 如果签名完全一样，说明 CM 已经是最新状态，跳过更新，防止光标重置
                if (currentSignature === currentCMSignature) {
                    return;
                }

                // 如果不同，说明这是“外部力量”（比如点击了顶部的撤销按钮，或者重新载入了一份草稿）
                // 我们必须强行用新数据覆盖当前 CM 实例的内容

                let newFullText = '';
                const newMappings: AtomMapping[] = [];
                const separator = '\n';
                let currentOffset = 0;

                for (let i = 0; i < current.ids.length; i++) {
                    const id = current.ids[i];
                    const content = current.data[id]?.content || '';

                    const from = currentOffset;
                    const to = currentOffset + content.length;
                    newMappings.push({ id, from, to });

                    newFullText += content;
                    if (i < current.ids.length - 1) {
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
