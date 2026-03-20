import React from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { ContentAtomField } from '../../attrstrand/types';
import RichTextRenderer from '../RichTextRenderer';
import { UnifiedCodeMirror } from './Editor/UnifiedCodeMirror';
import { Edit3 } from 'lucide-react';

interface FieldEditorProps {
    field: ContentAtomField;
    readOnly?: boolean;
    className?: string;
}

export const FieldEditor: React.FC<FieldEditorProps> = ({ field, readOnly = false, className = '' }) => {
    // 监听是否处于编辑态
    const isEditing = useWorkspaceStore(state => state.activeEditor?.field === field);
    const setActiveEditor = useWorkspaceStore(state => state.setActiveEditor);

    // 获取当前 field 的所有 atom IDs
    const atomIds = useWorkspaceStore(state => state.draftAtomLists[field] || []);
    const atomsData = useWorkspaceStore(state => state.draftAtomsData);

    const handleContainerClick = () => {
        if (readOnly || isEditing) return;

        // 我们只把焦点给这个 field，不需要特定 id
        // 可以传第一个 atom 的 id 作为象征，在 cm 里其实是一整片
        const firstId = atomIds.length > 0 ? atomIds[0] : `temp_${crypto.randomUUID()}`;
        setActiveEditor({ field, id: firstId });
    };

    if (isEditing) {
        return (
            <div className={`relative w-full ${className}`}>
                <UnifiedCodeMirror field={field} initialAtomIds={atomIds} />

                {/* 右上角操作按钮：完成编辑 */}
                <div className="absolute top-2 right-2 flex gap-1 z-10">
                    <button
                        onClick={() => setActiveEditor(null)}
                        className="px-3 py-1 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded text-sm font-medium transition-colors shadow-sm"
                    >
                        完成
                    </button>
                </div>
            </div>
        );
    }

    // --- 只读视图 ---
    return (
        <div
            onClick={handleContainerClick}
            className={`
                group relative w-full rounded-lg transition-all
                ${!readOnly ? 'cursor-text hover:bg-slate-50 ring-1 ring-transparent hover:ring-slate-200' : ''}
                ${className}
            `}
        >
            {/* 只读时的编辑提示图标 */}
            {!readOnly && (
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-slate-400">
                    <Edit3 size={16} />
                </div>
            )}

            <div className="p-4 flex flex-col gap-4">
                {atomIds.length === 0 ? (
                    <div className="text-slate-400 text-sm italic py-2">
                        暂无内容...
                    </div>
                ) : (
                    atomIds.map((id) => {
                        const content = atomsData[id]?.content || '';
                        return (
                            <div key={id} className="relative">
                                {/* 模拟 AtomBlock 的视觉，但不包含复杂的编辑器嵌套 */}
                                <div className="pl-3 border-l-[3px] border-slate-200 hover:border-indigo-300 transition-colors">
                                    <RichTextRenderer content={content} enableAnalysis={true} />
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};
