import { StateField, StateEffect, Transaction, RangeSetBuilder, EditorState } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, ViewUpdate, gutter, GutterMarker, WidgetType } from '@codemirror/view';
import { undoDepth, redoDepth } from '@codemirror/commands';
import type { DecorationSet } from '@codemirror/view';
import type { DraftId, ContentAtomField } from '../../../attrstrand/types';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import type { AtomDraft } from '../../../attrstrand/types';

// 基础数据

export interface EditorSnapshot {
    list: string[];
    data: Record<string, AtomDraft>;
}

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

    // 允许内部操作
    if (
        tr.isUserEvent('add_atom') ||
        tr.isUserEvent('swap_atom') ||
        tr.isUserEvent('external_sync') ||
        tr.isUserEvent('undo') ||
        tr.isUserEvent('redo')
    ) {
        return tr;
    }

    const mappings = tr.startState.field(atomMapField);
    let allowed = true;

    // 检查所有修改区间
    tr.changes.iterChanges((fromA, toA) => {
        // 判断 [fromA, toA] 是且仅只属于一个 mapping
        const isInsideOneMapping = mappings.some(m => m.from <= fromA && toA <= m.to);

        if (!isInsideOneMapping) {
            allowed = false;
        }
    });

    if (!allowed) {
        // 只屏蔽修改，不屏蔽光标
        return [tr, { changes: [] }];
    }

    return tr;
});

// 跨块选择自动扩展插件
export const crossMappingSelectionPlugin = ViewPlugin.fromClass(class {
    isDragging = false;
    view: EditorView;

    constructor(view: EditorView) {
        this.view = view;
        // 原生 DOM 事件
        view.dom.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mouseup', this.onMouseUp);
    }

    onMouseDown = () => {
        this.isDragging = true;
    };

    onMouseUp = () => {
        this.isDragging = false;
        // 检查并修复当前选区
        this.checkAndFixSelection(this.view);
    };

    update(update: ViewUpdate) {
        // 键盘选择
        if (update.selectionSet && !this.isDragging) {
            // 避免在同一个 update 循环中同步 dispatch 产生冲突
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

        // 找出所有涉及 mappings（包括部分）
        const selectedMappings = mappings.filter(m => m.from < to && m.to > from);

        if (selectedMappings.length > 1) {
            const firstMap = selectedMappings[0];
            const lastMap = selectedMappings[selectedMappings.length - 1];

            // 目标选区
            const targetFrom = firstMap.from;
            const targetTo = lastMap.to;

            // 检查当前选区完整
            // 注意锚点（anchor）和头部（head）的方向
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


// 复制格式化插件
export const copyFormatterPlugin = EditorView.domEventHandlers({
    copy: (event, view) => {
        const selection = view.state.selection.main;
        if (selection.empty || !event.clipboardData) return false; // let default handle

        const mappings = view.state.field(atomMapField);
        const { from, to } = selection;

        const selectedMappings = mappings.filter(m => m.from < to && m.to > from);

        if (selectedMappings.length <= 1) {
            return false; // 如果只在一个 mapping 内，走默认复制逻辑
        }

        // 跨 mapping 情况
        let copiedText = "";
        for (let i = 0; i < selectedMappings.length; i++) {
            const m = selectedMappings[i];

            const partFrom = Math.max(m.from, from);
            const partTo = Math.min(m.to, to);

            const textPart = view.state.sliceDoc(partFrom, partTo);
            copiedText += textPart;

            // 插入 \n\n (双换行)
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
        let skipMapPos = false;

        // 处理结构性操作 Effects
        for (const e of tr.effects) {
            if (e.is(setAtomMapEffect)) {
                nextMappings = e.value; // 全量覆盖
                skipMapPos = true;
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
                //legacy
                if (!skipMapPos) {
                    const { indexA, indexB } = e.value;
                    if (indexA >= 0 && indexB >= 0 && indexA < nextMappings.length && indexB < nextMappings.length) {
                        const temp = nextMappings[indexA];
                        nextMappings[indexA] = nextMappings[indexB];
                        nextMappings[indexB] = temp;
                    }
                }
            }
        }

        // changes.map 自动调整所有 from/to 边界
        if (tr.docChanged && !skipMapPos && !tr.isUserEvent('swap_atom')) {
            // 在重做（Redo）时，userEvent 可能是 'redo'，但 newAddedIds.size 会 > 0（因为 addAtomEffect 会被重播）。
            // 只要是本次交易中包含新块插入，我们就把它视为一次结构性添加。
            const isStructuralAdd = tr.isUserEvent('add_atom') || newAddedIds.size > 0;

            nextMappings = nextMappings.map(m => {
                if (newAddedIds.has(m.id)) {
                    return m;
                }

                // 对于已有的块：
                // 结构性插入 (\n) 时，反转 assoc 方向，使得块被推开以避免边界粘连。
                const fromAssoc = isStructuralAdd ? 1 : -1;
                const toAssoc = isStructuralAdd ? -1 : 1;

                const newFrom = tr.changes.mapPos(m.from, fromAssoc);
                let newTo = tr.changes.mapPos(m.to, toAssoc);

                // 针对空块上方插入换行符
                if (newFrom > newTo) {
                    newTo = newFrom;
                }

                return { ...m, from: newFrom, to: newTo };
            });
            console.log(nextMappings)
        }

        return nextMappings;
    }
});

// 监听变化，反向同步到 Zustand (仅更新 UI 显示并记录内部 Snapshot)

export const syncAndSnapshotPlugin = (field: ContentAtomField, onSnapshot: (snapshot: EditorSnapshot) => void) => ViewPlugin.fromClass(class {
    updateTimeout: number | null = null;

    constructor() {
        // Initialization if needed
    }

    update(update: ViewUpdate) {
        if (!update.docChanged) return;

        // 忽略外部 dispatch 同步, 避免死循环
        if (update.transactions.some(tr => tr.annotation(Transaction.userEvent) === 'external_sync')) {
            return;
        }

        // 更新 UI 状态
        const state = useWorkspaceStore.getState();
        const currentUndoDepth = undoDepth(update.state);
        const currentRedoDepth = redoDepth(update.state);

        if (state.cmUndoDepth !== currentUndoDepth || state.cmRedoDepth !== currentRedoDepth) {
            state.setCMHistoryDepth(currentUndoDepth, currentRedoDepth);
        }

        const isStructuralChange = update.transactions.some(tr =>
            tr.isUserEvent('add_atom') || tr.isUserEvent('swap_atom') || tr.isUserEvent('remove_atom')
        );

        const generateAndEmitSnapshot = () => {
            const mappings = update.view.state.field(atomMapField);
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
                const currentText = update.view.state.sliceDoc(m.from, m.to);
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

            // Sync the parallel state for UI display
            state.syncCMToParallelState(field, newList, newAtomsData);

            // Record snapshot for undo replay later
            // We only need to save the subset of data that matters for this field
            const snapshotData: Record<string, AtomDraft> = {};
            for (const id of newList) {
                if (newAtomsData[id]) {
                    snapshotData[id] = newAtomsData[id];
                }
            }

            onSnapshot({ list: newList, data: snapshotData });
        };

        // 结构性改变，立即执行；纯文本编辑，防抖执行
        if (isStructuralChange) {
            if (this.updateTimeout) {
                window.clearTimeout(this.updateTimeout);
            }
            generateAndEmitSnapshot();
        } else {
            if (this.updateTimeout) {
                window.clearTimeout(this.updateTimeout);
            }

            this.updateTimeout = window.setTimeout(generateAndEmitSnapshot, 500);
        }
    }

    destroy() {
        if (this.updateTimeout) {
            window.clearTimeout(this.updateTimeout);
        }
    }
});

// 渲染 Atom 块边界样式

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
                    const gapText = view.state.sliceDoc(currentMap.to, nextMap.from);

                    // 计算新的绝对映射
                    const newMappings = [...mappings];

                    // 新的 currentMap (原本是 nextMap 的内容)
                    const newCurrentTo = currentMap.from + textB.length;
                    newMappings[this.index] = {
                        id: nextMap.id,
                        from: currentMap.from,
                        to: newCurrentTo
                    };

                    // 新的 nextMap (原本是 currentMap 的内容)
                    const newNextFrom = newCurrentTo + gapText.length;
                    const newNextTo = newNextFrom + textA.length;
                    newMappings[this.index + 1] = {
                        id: currentMap.id,
                        from: newNextFrom,
                        to: newNextTo
                    };

                    // 修改后续所有块的偏移量
                    // 原本这两个块及中间间隙占据的长度: (nextMap.to - currentMap.from)
                    // 互换后由于只是交换，总长度肯定是一样的，但是这仅仅是在本例中。
                    // 实际上文本长度差异导致的 offset 变化：
                    // 注意：因为只交换 A 和 B，A+B+gap 的总长必定等于 B+A+gap，
                    // 所以后续 mapping 的位置不受影响！

                    const changes = [
                        { from: nextMap.from, to: nextMap.to, insert: textA },
                        { from: currentMap.from, to: currentMap.to, insert: textB }
                    ];

                    view.dispatch({
                        changes,
                        effects: [
                            setAtomMapEffect.of(newMappings),
                            swapAtomEffect.of({ indexA: this.index, indexB: this.index + 1 })
                        ],
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
