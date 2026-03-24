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
export const addAtomEffect = StateEffect.define<{ id: string, index: number, insertPos: number }>();
export const removeAtomEffect = StateEffect.define<{ id: string }>();
export const swapAtomEffect = StateEffect.define<{ indexA: number, indexB: number }>();

// 严格编辑拦截器：只允许在单个 mapping 内部的文本修改
export const strictMappingEditFilter = EditorState.transactionFilter.of((tr) => {
    // 只有当有文本内容变化时才检查
    if (!tr.docChanged) return tr;

    // 如果是我们内部系统生成的结构性操作，放行
    if (tr.isUserEvent('add_atom') || tr.isUserEvent('swap_atom') || tr.isUserEvent('external_sync')) {
        return tr;
    }

    const mappings = tr.startState.field(atomMapField);
    let allowed = true;

    // 检查所有被修改的区间
    tr.changes.iterChanges((fromA, toA) => {
        // 判断 [fromA, toA] 是否完全属于且只属于一个 mapping
        const isInsideOneMapping = mappings.some(m => m.from <= fromA && toA <= m.to);

        if (!isInsideOneMapping) {
            allowed = false;
        }
    });

    if (!allowed) {
        // 如果不允许，我们忽略本次修改（返回没有 changes 的 transaction）
        // 但保留 selection 的移动，也就是只屏蔽修改，不屏蔽光标
        return [tr, { changes: [] }];
    }

    return tr;
});

// 跨块选择自动扩展插件：
// 在选择完成时（非鼠标拖动中），如果选区跨越了多个 mapping，
// 立即将其扩展为包含所有涉及 mapping 的头部到尾部。
export const crossMappingSelectionPlugin = ViewPlugin.fromClass(class {
    isDragging = false;
    view: EditorView;

    constructor(view: EditorView) {
        this.view = view;
        // 我们通过原生的 DOM 事件来准确捕获鼠标的按下和抬起状态
        view.dom.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mouseup', this.onMouseUp);
    }

    onMouseDown = () => {
        this.isDragging = true;
    };

    onMouseUp = () => {
        this.isDragging = false;
        // 鼠标抬起时，立即检查并修复当前选区
        this.checkAndFixSelection(this.view);
    };

    update(update: ViewUpdate) {
        // 如果选区发生了改变，并且当前不在拖动中（例如键盘 Shift+方向键选择）
        if (update.selectionSet && !this.isDragging) {
            // 延迟一点执行，避免在同一个 update 循环中同步 dispatch 产生冲突
            requestAnimationFrame(() => {
                this.checkAndFixSelection(update.view);
            });
        }
    }

    checkAndFixSelection(view: EditorView) {
        const selection = view.state.selection.main;
        if (selection.empty) return;

        const mappings = view.state.field(atomMapField);
        const { from, to } = selection;

        // 找出所有被触及的 mappings（包括部分相交）
        const selectedMappings = mappings.filter(m => m.from < to && m.to > from);

        if (selectedMappings.length > 1) {
            const firstMap = selectedMappings[0];
            const lastMap = selectedMappings[selectedMappings.length - 1];

            // 目标选区应该是第一个 map 的 from 到最后一个 map 的 to
            const targetFrom = firstMap.from;
            const targetTo = lastMap.to;

            // 检查当前选区是否已经是完整的目标选区
            // 注意锚点（anchor）和头部（head）的方向要保留，以符合用户的拖动方向
            const isForward = selection.anchor <= selection.head;
            const currentTargetAnchor = isForward ? targetFrom : targetTo;
            const currentTargetHead = isForward ? targetTo : targetFrom;

            if (selection.anchor !== currentTargetAnchor || selection.head !== currentTargetHead) {
                view.dispatch({
                    selection: { anchor: currentTargetAnchor, head: currentTargetHead },
                    scrollIntoView: true,
                    annotations: Transaction.userEvent.of('fix_cross_selection')
                });
            }
        }
    }

    destroy() {
        this.view.dom.removeEventListener('mousedown', this.onMouseDown);
        window.removeEventListener('mouseup', this.onMouseUp);
    }
});


// 复制格式化器：跨越多个 mapping 时，用 \n\n 分隔
export const copyFormatterPlugin = EditorView.domEventHandlers({
    copy: (event, view) => {
        const selection = view.state.selection.main;
        if (selection.empty || !event.clipboardData) return false; // let default handle

        const mappings = view.state.field(atomMapField);
        const { from, to } = selection;

        // 找出所有被选中的 mapping（即使只是部分选中）
        const selectedMappings = mappings.filter(m => m.from < to && m.to > from);

        if (selectedMappings.length <= 1) {
            return false; // 如果只在一个 mapping 内，走默认复制逻辑
        }

        // 处理跨越多个 mapping 的情况
        let copiedText = "";
        for (let i = 0; i < selectedMappings.length; i++) {
            const m = selectedMappings[i];

            // 提取被选中的当前 mapping 的实际文本内容
            // 要截断在选择的边界
            const partFrom = Math.max(m.from, from);
            const partTo = Math.min(m.to, to);

            const textPart = view.state.sliceDoc(partFrom, partTo);
            copiedText += textPart;

            // 在相邻的两个 mapping 之间，插入 \n\n (双换行)，而不是原文档的单一 \n
            if (i < selectedMappings.length - 1) {
                copiedText += "\n\n";
            }
        }

        event.clipboardData.setData('text/plain', copiedText);
        event.preventDefault(); // 拦截默认复制行为
        return true;
    }
});


// 维护[from, to] 
export const atomMapField = StateField.define<AtomMapping[]>({
    create() {
        return [];
    },
    update(mappings, tr: Transaction) {
        let nextMappings = [...mappings];
        const newAddedIds = new Set<string>();

        // 1. 处理结构性操作 Effects
        for (const e of tr.effects) {
            if (e.is(setAtomMapEffect)) {
                nextMappings = e.value; // 全量覆盖
            }
            else if (e.is(addAtomEffect)) 
            {
                const { id, index, insertPos } = e.value;
                const newMapping: AtomMapping = { id, from: insertPos, to: insertPos };
                if (index === -1) {
                    nextMappings.unshift(newMapping);
                } else if (index >= 0) {
                    nextMappings.splice(index + 1, 0, newMapping);
                } else {
                    nextMappings.push(newMapping);
                }
                console.log(newMapping)
                newAddedIds.add(id);
            }
            else if (e.is(removeAtomEffect))
            {
                const { id } = e.value;
                nextMappings = nextMappings.filter(m => m.id !== id);
            }
            else if (e.is(swapAtomEffect))
            {
                const { indexA, indexB } = e.value;
                if (indexA >= 0 && indexB >= 0 && indexA < nextMappings.length && indexB < nextMappings.length) {
                    const temp = nextMappings[indexA];
                    nextMappings[indexA] = nextMappings[indexB];
                    nextMappings[indexB] = temp;
                }
            }
        }

        // 2. 如果文档发生了修改，利用 CM 的 changes.map 自动调整所有 from/to 边界
        if (tr.docChanged) {
            const isStructuralAdd = tr.isUserEvent('add_atom');

            nextMappings = nextMappings.map(m => {
                if (newAddedIds.has(m.id)) {
                    return m;
                }

                // 对于已有的块：
                // 结构性插入 (\n) 时，反转 assoc 方向，使得块被推开以避免边界粘连。
                const fromAssoc = isStructuralAdd ? 1 : -1;
                const toAssoc = isStructuralAdd ? -1 : 1;

                const newFrom = tr.changes.mapPos(m.from, fromAssoc);
                const newTo = tr.changes.mapPos(m.to, toAssoc);

                return { ...m, from: newFrom, to: newTo };
            });
            console.log(nextMappings)
        }

        return nextMappings;
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

            // Sync to the parallel state
            const newList = mappings.map(m => m.id);
            const newAtomsData = { ...state.cmDraftAtomsData };
            const fallbackData = state.draftAtomsData; // Fallback to zundo-tracked data if not in parallel

            let type: import('../../../attrstrand/types').ContentAtomType = 'markdown';
            if (field === 'core') type = 'latex';
            if (field === 'tags' || field === 'rels') type = 'inline';
            if (field === 'refs') type = 'sources';

            for (const m of mappings) {
                const currentText = update.state.sliceDoc(m.from, m.to);
                const existingAtom = newAtomsData[m.id] || fallbackData[m.id];

                if (existingAtom) {
                    if (existingAtom.content !== currentText) {
                        newAtomsData[m.id] = { ...existingAtom, content: currentText, isDirty: true };
                    } else if (!newAtomsData[m.id]) {
                         // Carry over from fallback to parallel state
                         newAtomsData[m.id] = existingAtom;
                    }
                } else {
                    // It's a brand new atom from CM UI
                    newAtomsData[m.id] = {
                        id: m.id,
                        field,
                        type,
                        content: currentText,
                        creatorId: 'user',
                        derivedFromId: null,
                        frontMeta: {},
                        isDirty: true
                    };
                }
            }

            // Sync the parallel state
            state.syncCMToParallelState(field, newList, newAtomsData);

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
            wrap.className = "cm-add-btn-wrapper relative w-full flex justify-center items-center h-[28px] pointer-events-auto z-10 opacity-0 hover:opacity-100 transition-opacity duration-200 gap-2";
            btn.className = "pointer-events-auto bg-indigo-50 text-indigo-400 rounded-full p-1 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200 bg-opacity-90 backdrop-blur-sm cursor-pointer";

            const swapBtn = document.createElement("button");
            swapBtn.className = "pointer-events-auto bg-indigo-50 text-indigo-400 rounded-full p-1 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200 bg-opacity-90 backdrop-blur-sm cursor-pointer";
            swapBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-up-down"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>`;

            swapBtn.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();

                const view = EditorView.findFromDOM(wrap);
                if (!view) return;

                const mappings = view.state.field(atomMapField);
                if (this.index >= 0 && this.index < mappings.length - 1) {
                    const currentMap = mappings[this.index];
                    const nextMap = mappings[this.index + 1];

                    const textA = view.state.sliceDoc(currentMap.from, currentMap.to);
                    const textB = view.state.sliceDoc(nextMap.from, nextMap.to);

                    const changes = [
                        { from: nextMap.from, to: nextMap.to, insert: textA },
                        { from: currentMap.from, to: currentMap.to, insert: textB }
                    ];

                    view.dispatch({
                        changes,
                        effects: swapAtomEffect.of({ indexA: this.index, indexB: this.index + 1 }),
                        annotations: Transaction.userEvent.of('swap_atom')
                    });
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

            const newId = `temp_${crypto.randomUUID().replace(/-/g, '')}`;
            const view = EditorView.findFromDOM(wrap);
            if (!view) return;

            const mappings = view.state.field(atomMapField);
            let insertPos = 0;
            let insertText = '\n';

            if (this.position === 'top') {
                insertPos = 0;
            } else if (this.position === 'middle') {
                if (this.index >= 0 && this.index < mappings.length) {
                    insertPos = mappings[this.index].to + 1; // skip \n
                }
            } else if (this.position === 'bottom') {
                insertPos = view.state.doc.length;
                if (view.state.doc.length > 0 && view.state.sliceDoc(view.state.doc.length - 1) !== '\n') {
                    insertText = '\n\n'; // ensure gap
                }
            }

            let atomFrom = insertPos;
            if (this.position === 'bottom' && insertText === '\n\n') {
                 atomFrom = insertPos + 1;
            }

            view.dispatch({
                changes: { from: insertPos, to: insertPos, insert: insertText },
                effects: addAtomEffect.of({ id: newId, index: this.index, insertPos: atomFrom }),
                annotations: Transaction.userEvent.of('add_atom')
            });

            const state = useWorkspaceStore.getState();
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
