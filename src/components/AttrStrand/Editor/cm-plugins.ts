import { StateField, StateEffect, Transaction, RangeSetBuilder } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, ViewUpdate, gutter, GutterMarker } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import type { DraftId, ContentAtomField } from '../../../attrstrand/types';
import { useWorkspaceStore } from '../../../store/workspaceStore';

// 基础数据

export interface AtomMapping {
    id: DraftId;
    from: number;
    to: number;
}

// 状态机和 Effect
export const setAtomMapEffect = StateEffect.define<AtomMapping[]>();

// 维护[from, to] 
export const atomMapField = StateField.define<AtomMapping[]>({
    create() {
        return [];
    },
    update(mappings, tr: Transaction) {
        // 1. 如果有外部下发的全新映射, 直接替换
        for (const e of tr.effects) {
            if (e.is(setAtomMapEffect)) {
                return e.value;
            }
        }

        // 2. 如果文档发生了修改，利用 CM 的 changes.map 自动调整所有 from/to 边界
        if (tr.docChanged) {
            return mappings.map(m => {
                // mapPos 自动处理插入/删除带来的偏移量
                // assoc: -1 (from 倾向于左侧), assoc: 1 (to 倾向于右侧)
                const newFrom = tr.changes.mapPos(m.from, -1);
                const newTo = tr.changes.mapPos(m.to, 1);
                return { ...m, from: newFrom, to: newTo };
            });
        }

        return mappings;
    }
});

// 监听变化，反向同步到 Zustand

export const syncToZustandPlugin = (field: ContentAtomField) => ViewPlugin.fromClass(class {
    updateTimeout: number | null = null;

    constructor() {
        // Initialization if needed
    }

    update(update: ViewUpdate) {
        if (!update.docChanged) return;

        // 如果是外部强制同步（通过 dispatch 触发的），忽略它，避免死循环
        if (update.transactions.some(tr => tr.annotation(Transaction.userEvent) === 'external_sync')) {
            return;
        }

        // 防抖：用户连续打字时不立刻全量同步，停顿 500ms 后同步
        if (this.updateTimeout) {
            window.clearTimeout(this.updateTimeout);
        }

        this.updateTimeout = window.setTimeout(() => {
            const mappings = update.state.field(atomMapField);

            const state = useWorkspaceStore.getState();
            const transactions: Parameters<typeof state.applyAtomTransactions>[1] = [];

            const currentData = state.draftAtomsData;

            // 遍历映射表，精准切出每个 Atom 的当前文本，与 Zustand 对比
            for (const m of mappings) {
                const currentText = update.state.sliceDoc(m.from, m.to);

                if (currentData[m.id]?.content !== currentText) {
                    transactions.push({
                        action: 'update',
                        id: m.id,
                        content: currentText
                    });
                }
            }

            if (transactions.length > 0) {
                state.applyAtomTransactions(field, transactions);
            }
        }, 500);
    }

    destroy() {
        if (this.updateTimeout) {
            window.clearTimeout(this.updateTimeout);
        }
    }
});

// === 4. Visual Decorations: 渲染 Atom 块边界样式 ===

export const blockDecorations = ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
        // 当文档内容变化、或者视口滚动时重新计算可见区域的装饰器
        if (update.docChanged || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view);
        }
    }

    buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const mappings = view.state.field(atomMapField);

        // 遍历所有行，检查属于块内还是块间的空隙，
        // 并给块间空隙标记特殊样式（非标准 \n\n 间距则标红警示）
        let nextGapStart = 0;

        for (const m of mappings) {
            if (nextGapStart < m.from) {
                const gapText = view.state.doc.sliceString(nextGapStart, m.from);
                const isError = gapText !== '\n\n';

                let pos = nextGapStart;
                while (pos < m.from) {
                    const line = view.state.doc.lineAt(pos);
                    if (line.from >= nextGapStart && line.to <= m.from) {
                        if (isError) {
                            builder.add(line.from, line.from, Decoration.line({
                                class: 'cm-atom-gap-error'
                            }));
                        }
                    }
                    pos = line.to + 1;
                    if (pos > view.state.doc.length) break;
                }
            }

            if (m.from < m.to) { // 正常的块
                // 为属于这个 Atom 的每一行加上行级样式（左侧边框/背景）
                let pos = m.from;
                while (pos <= m.to) {
                    const line = view.state.doc.lineAt(pos);
                    // 仅当这行真的属于这个块时添加 class
                    if (line.from >= m.from && line.to <= m.to) {
                        builder.add(line.from, line.from, Decoration.line({
                            class: 'cm-atom-line border-l-2 border-slate-200 ml-2 pl-2'
                        }));
                    }
                    pos = line.to + 1;
                    if (pos > view.state.doc.length) break;
                }
            }

            nextGapStart = m.to;
        }

        // 结尾处的额外内容标红
        if (nextGapStart < view.state.doc.length) {
            const gapText = view.state.doc.sliceString(nextGapStart, view.state.doc.length);
            const isError = gapText.length > 0 && gapText !== '\n';

            let pos = nextGapStart;
            while (pos <= view.state.doc.length) {
                const line = view.state.doc.lineAt(pos);
                if (line.from >= nextGapStart) {
                    if (isError) {
                         builder.add(line.from, line.from, Decoration.line({
                             class: 'cm-atom-gap-error'
                         }));
                    }
                }
                pos = line.to + 1;
                if (pos > view.state.doc.length) break;
            }
        }

        return builder.finish();
    }
}, {
    decorations: v => v.decorations
});


// === 5. Gutter 占位 (预留未来拖拽和操作区域) ===

// 这是一个空白的 Marker
class EmptyDragMarker extends GutterMarker {
    toDOM() {
        const span = document.createElement('span');
        // 这里预留了一个 16px 的空间，未来可以塞进拖拽图标 (⋮⋮) 或是数字序号
        span.className = 'cm-drag-handle opacity-0 hover:opacity-100 cursor-grab px-1 text-slate-400 select-none transition-opacity';
        span.textContent = '⋮⋮';
        return span;
    }
}
const dragMarker = new EmptyDragMarker();

export const blockActionGutter = gutter({
    class: 'cm-block-action-gutter bg-transparent border-r-0 w-6',
    markers(view) {
        const mappings = view.state.field(atomMapField);
        const builder = new RangeSetBuilder<GutterMarker>();

        // 我们只在每个 Atom 的【第一行】显示这个操作手柄
        for (const m of mappings) {
             if (m.from < m.to) {
                 const firstLine = view.state.doc.lineAt(m.from);
                 builder.add(firstLine.from, firstLine.from, dragMarker);
             }
        }

        return builder.finish();
    },
    // 未来在这里添加 domEventHandlers: { mousedown: (view, line, event) => { ... } } 实现拖拽
});
