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
    const lastSyncedSignatureRef = useRef<string>('');

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

        // 生成数据签名用于死循环拦截
        lastSyncedSignatureRef.current = initialAtomIds.map(id => `${id}:${data[id]?.content || ''}`).join('|');

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

                // 如果签名和我们最后一次主动推出去的一样，说明这是自己人干的，忽略。
                if (currentSignature === lastSyncedSignatureRef.current) {
                    return;
                }

                // 如果不同，说明这是“外部力量”（比如点击了顶部的撤销按钮，或者重新载入了一份草稿）
                // 我们必须强行用新数据覆盖当前 CM 实例的内容

                let newFullText = '';
                const newMappings: AtomMapping[] = [];
                const separator = '\n\n';
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

                // 更新签名缓存
                lastSyncedSignatureRef.current = currentSignature;

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
