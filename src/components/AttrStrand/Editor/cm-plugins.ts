import { StateField, StateEffect, Transaction, RangeSetBuilder } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, ViewUpdate, WidgetType, gutter, GutterMarker } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import type { DraftId, ContentAtomField } from '../../../attrstrand/types';
import { useWorkspaceStore } from '../../../store/workspaceStore';

// === 1. Data Structures ===

export interface AtomMapping {
    id: DraftId;
    from: number;
    to: number;
}

// === 2. State Effects & Fields ===

// Effect: 外部强制更新（例如初始化或 Undo/Redo）时，派发完整的 Atom 映射列表
export const setAtomMapEffect = StateEffect.define<AtomMapping[]>();

// StateField: 核心状态机，维护每个 Atom 在文档中的精确 [from, to] 范围
export const atomMapField = StateField.define<AtomMapping[]>({
    create() {
        return [];
    },
    update(mappings, tr: Transaction) {
        // 1. 如果有外部下发的全新映射（如初始化），直接替换
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

// === 3. Sync Plugin: 监听变化，反向同步到 Zustand ===

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
                // 如果用户删除了两个块之间的所有内容，from 可能会等于 to
                // sliceDoc 会安全地返回空字符串
                const currentText = update.state.sliceDoc(m.from, m.to);

                // 只有真正发生变化时才提交 update transaction
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

// 这是一个极其简单的占位 Widget，证明我们可以在边界插入 UI
class AtomBoundaryWidget extends WidgetType {
    id: string;
    isStart: boolean;
    constructor(id: string, isStart: boolean) {
        super();
        this.id = id;
        this.isStart = isStart;
    }

    eq(other: AtomBoundaryWidget) {
        return other.id === this.id && other.isStart === this.isStart;
    }

    toDOM() {
        const wrap = document.createElement("div");
        // 暂时只加一条微弱的分割线或者完全透明，主要为了后续挂载 React UI 留坑
        wrap.className = this.isStart
            ? "cm-atom-boundary-top h-1 w-full bg-transparent hover:bg-indigo-50 transition-colors pointer-events-none"
            : "cm-atom-boundary-bottom h-1 w-full bg-transparent";
        return wrap;
    }
}

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

        // 1. 为所有的映射区间添加视觉标记
        // 在 CodeMirror 6 中，通过 RangeSetBuilder 构建的装饰器必须严格按位置升序排序！
        // 因为 m.to 和下一个元素的 m.from 可能因为换行符紧密相邻，
        // 且由于 line 装饰器和 widget 装饰器混用，必须按照 from 升序且分类处理。
        // 不过在这里我们每次添加的都是单调递增的位置。

        // CodeMirror 的错误: "RangeError: Block decorations may not be specified via plugins"
        // 意味着 block: true 的 widget 不能通过普通的 ViewPlugin 的 decorations 返回，
        // 而必须通过 StateField<DecorationSet> 提供并在 EditorState 的 extensions 中注册，
        // 或者直接作为 line 装饰器的一部分。但在普通的 ViewPlugin 中，如果要渲染 block widget，
        // 需要使用 StateField 和 provide: EditorView.decorations。
        // 为了简化和解决报错，我们将 blockDecorations 改为提供普通 line 装饰器，
        // 而放弃在 ViewPlugin 中动态生成带有 block: true 的 Widget 装饰器，改用内联 widget 或者外置。
        // 其实这里只是加一些样式和占位，我们只保留行级的高亮装饰。
        for (const m of mappings) {
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
