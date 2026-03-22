import { StateField, StateEffect, Transaction, RangeSetBuilder, EditorState } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, ViewUpdate, gutter, GutterMarker, WidgetType } from '@codemirror/view';
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

// Helper: Build decorations based on state
function buildDecorations(state: EditorState, field: ContentAtomField): DecorationSet {
    const decorations: { from: number; to: number; dec: Decoration }[] = [];
    const mappings = state.field(atomMapField);

    let nextGapStart = 0;

    for (const m of mappings) {
        if (nextGapStart < m.from) {
            const gapText = state.doc.sliceString(nextGapStart, m.from);
            const isError = gapText !== '\n';

            let pos = nextGapStart;
            while (pos < m.from) {
                const line = state.doc.lineAt(pos);
                if (line.from >= nextGapStart && line.to <= m.from) {
                    if (isError) {
                        decorations.push({ from: line.from, to: line.from, dec: Decoration.line({
                            class: 'cm-atom-gap-error group/cmline-gap'
                        })});
                    } else {
                        decorations.push({ from: line.from, to: line.from, dec: Decoration.line({
                            class: 'group/cmline-gap'
                        })});
                    }
                }
                pos = line.to + 1;
                if (pos > state.doc.length) break;
            }
        }

        if (m.from < m.to) { // 正常的块
            // 为属于这个 Atom 的每一行加上行级样式（左侧边框/背景）
            let pos = m.from;
            while (pos <= m.to) {
                const line = state.doc.lineAt(pos);
                // 仅当这行真的属于这个块时添加 class
                if (line.from >= m.from && line.to <= m.to) {
                    decorations.push({ from: line.from, to: line.from, dec: Decoration.line({
                        class: 'cm-atom-line border-l-2 border-slate-200 ml-2 pl-2'
                    })});
                }
                pos = line.to + 1;
                if (pos > state.doc.length) break;
            }
        }

        nextGapStart = m.to;
    }

    // 添加中间间隙的 + 按钮 Widget
    for (let i = 0; i < mappings.length - 1; i++) {
        const current = mappings[i];
        const next = mappings[i + 1];

        // 确保中间有间隔 (通常是 \n)
        if (next.from - current.to >= 1) {
            // 作为一个占据独立行高的 block widget 插入
            decorations.push({ from: current.to, to: current.to, dec: Decoration.widget({
                widget: new AddButtonWidget(field, i, 'middle'),
                side: 1,
                block: true
            })});
        }
    }

    // 添加顶部 + 按钮
    if (mappings.length > 0) {
        const firstLine = state.doc.lineAt(0);
        decorations.push({ from: firstLine.from, to: firstLine.from, dec: Decoration.widget({
            widget: new AddButtonWidget(field, -1, 'top'),
            side: -1
        })});
        // 第一行的 group/cmline 会在上面的块内逻辑处理，或者在这里确保有
        if (!decorations.some(d => d.from === firstLine.from && d.dec.spec.class && d.dec.spec.class.includes('group/cmline'))) {
            decorations.push({ from: firstLine.from, to: firstLine.from, dec: Decoration.line({
                class: 'group/cmline'
            })});
        }
    }

    // 结尾处的额外内容标红
    if (nextGapStart < state.doc.length) {
        const gapText = state.doc.sliceString(nextGapStart, state.doc.length);
        const isError = gapText.length > 0 && gapText !== '\n';

        let pos = nextGapStart;
        while (pos <= state.doc.length) {
            const line = state.doc.lineAt(pos);
            if (line.from >= nextGapStart) {
                if (isError) {
                     decorations.push({ from: line.from, to: line.from, dec: Decoration.line({
                         class: 'cm-atom-gap-error group/cmline'
                     })});
                } else {
                     decorations.push({ from: line.from, to: line.from, dec: Decoration.line({
                         class: 'group/cmline'
                     })});
                }
            }
            pos = line.to + 1;
            if (pos > state.doc.length) break;
        }
    }

    // 添加底部 + 按钮
    if (mappings.length > 0) {
        const lastMapping = mappings[mappings.length - 1];
        // 在最后一行的下方
        const lastLine = state.doc.lineAt(lastMapping.to);
        decorations.push({ from: lastLine.to, to: lastLine.to, dec: Decoration.widget({
            widget: new AddButtonWidget(field, mappings.length - 1, 'bottom'),
            side: 1
        })});
        if (!decorations.some(d => d.from === lastLine.from && d.dec.spec.class && d.dec.spec.class.includes('group/cmline'))) {
            decorations.push({ from: lastLine.from, to: lastLine.from, dec: Decoration.line({
                class: 'group/cmline'
            })});
        }
    } else {
        // 如果为空，在第一行显示
        decorations.push({ from: 0, to: 0, dec: Decoration.widget({
            widget: new AddButtonWidget(field, -1, 'bottom'),
            side: 1
        })});
        const line = state.doc.lineAt(0);
        if (!decorations.some(d => d.from === line.from && d.dec.spec.class && d.dec.spec.class.includes('group/cmline'))) {
            decorations.push({ from: line.from, to: line.from, dec: Decoration.line({
                class: 'group/cmline'
            })});
        }
    }

    return Decoration.set(decorations.sort((a, b) => {
        if (a.from !== b.from) {
            return a.from - b.from;
        }
        // If they are at the same position, CodeMirror requires them to be sorted by startSide.
        // A widget with side < 0 should come before a line decoration (side 0) or widget with side > 0.
        // Let's fallback to the internal startSide property of the decorations.
        const sideA = (a.dec as any).startSide ?? 0;
        const sideB = (b.dec as any).startSide ?? 0;
        return sideA - sideB;
    }).map(d => {
        return d.dec.range(d.from); // for widget and line, to is the same as from, range(pos) is sufficient
    }), true); // pass true to allow Decoration.set to sort them or handle existing sorted order, but our own sort handles the strict side rules.
}

export const blockDecorations = (field: ContentAtomField) => StateField.define<DecorationSet>({
    create(state) {
        return buildDecorations(state, field);
    },
    update(value, tr) {
        // Because mappings are recalculated based on doc structure,
        // we can just re-build on doc changes.
        if (tr.docChanged || tr.selection) { // re-evaluating on any transaction to be safe with mapping changes
            return buildDecorations(tr.state, field);
        }
        return value;
    },
    provide: f => EditorView.decorations.from(f)
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

class AddButtonWidget extends WidgetType {
    field: ContentAtomField;
    index: number;
    position: 'middle' | 'top' | 'bottom';

    constructor(field: ContentAtomField, index: number, position: 'middle' | 'top' | 'bottom' = 'middle') {
        super();
        this.field = field;
        this.index = index;
        this.position = position;
    }

    eq(other: AddButtonWidget) {
        return other.field === this.field && other.index === this.index && other.position === this.position;
    }

    toDOM() {
        const wrap = document.createElement("div");
        const btn = document.createElement("button");

        if (this.position === 'middle') {
            // 中间间隙：占据一整行，flex 布局，内容居中
            wrap.className = "cm-add-btn-wrapper relative w-full flex justify-center items-center h-[28px] pointer-events-none z-10 opacity-0 hover:opacity-100 transition-opacity duration-200 gap-2";
            btn.className = "pointer-events-auto bg-indigo-50 text-indigo-400 rounded-full p-1 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200 bg-opacity-90 backdrop-blur-sm cursor-pointer";

            const swapBtn = document.createElement("button");
            swapBtn.className = "pointer-events-auto bg-indigo-50 text-indigo-400 rounded-full p-1 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200 bg-opacity-90 backdrop-blur-sm cursor-pointer";
            swapBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-up-down"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>`;

            swapBtn.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();

                const state = useWorkspaceStore.getState();
                const list = [...(state.draftAtomLists[this.field] || [])];

                if (this.index >= 0 && this.index < list.length - 1) {
                    const temp = list[this.index];
                    list[this.index] = list[this.index + 1];
                    list[this.index + 1] = temp;
                    state.applyAtomTransactions(this.field, [], list);
                }
            };

            wrap.appendChild(btn);
            wrap.appendChild(swapBtn);

            // 确保其父级也有这个 class，以支持之前的 group-hover 逻辑，虽然这里也加了 hover:opacity-100
            wrap.classList.add('group-hover/cmline-gap:opacity-100');

        } else {
            // 顶部/底部：block widget，relative定位，按钮绝对偏移
            wrap.className = "cm-add-btn-wrapper relative w-full flex justify-center h-0 overflow-visible pointer-events-none z-10 opacity-0 group-hover/cmline:opacity-100 transition-opacity duration-200";
            btn.className = "absolute pointer-events-auto bg-indigo-50 text-indigo-400 rounded-full p-1 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200 bg-opacity-90 backdrop-blur-sm cursor-pointer";

            // 调整位置保持与内容一定距离，不改变垂直排版
            if (this.position === 'top') {
                btn.style.top = "-24px";
            } else if (this.position === 'bottom') {
                btn.style.bottom = "-24px";
            }

            wrap.appendChild(btn);
        }

        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;

        btn.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Generate a new temporary ID
            const newId = `temp_${crypto.randomUUID().replace(/-/g, '')}`;

            // Ensure we update workspace state synchronously via WorkspaceStore
            const state = useWorkspaceStore.getState();
            state.addAtomId(this.field, newId, this.index);
            state.setActiveEditor({ field: this.field, id: newId });
        };


        return wrap;
    }
}


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
