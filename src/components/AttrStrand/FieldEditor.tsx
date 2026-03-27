import React, { useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { ContentAtomField } from '../../attrstrand/types';
import RichTextRenderer from '../RichTextRenderer';
import { UnifiedCodeMirror } from './Editor/UnifiedCodeMirror';
import { Check, Edit3, Plus, AlertTriangle } from 'lucide-react';
import { ErrorBoundary } from '../ErrorBoundary';
import { CopyrightTooltip } from './CopyrightTooltip';
import { genTempId } from '../../store/workspaceStore';
import { ImageGroupViewer } from './Editor/ImageGroupViewer';

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
    const addAtomId = useWorkspaceStore(state => state.addAtomId);

    // 获取当前 field 的 lint 错误
    const fieldLintErrors = useWorkspaceStore(state => state.fieldLintErrors[field] || false);

    // 悬停状态
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    
    // 弹窗状态
    const [showErrorDialog, setShowErrorDialog] = useState(false);

    const handlePointerOver = (e: React.PointerEvent) => {
        const target = e.target as HTMLElement;
        const item = target.closest('[data-index]') as HTMLElement | null;
        if (item) {
            const index = parseInt(item.getAttribute('data-index') || '', 10);
            if (!Number.isNaN(index) && hoveredIndex !== index) {
                setHoveredIndex(index);
            }
        } else {
            setHoveredIndex(null);
        }
    };

    const handlePointerLeave = (e: React.PointerEvent<HTMLDivElement>) => {
        const related = e.relatedTarget as Node | null;
        if (related && related instanceof Node && e.currentTarget.contains(related)) {
            return;
        }
        setHoveredIndex(null);
    };

    const handleContainerClick = (e: React.MouseEvent) => {
        if (readOnly || isEditing) return;

        // 避免点击内部链接或按钮时误触发编辑
        const target = e.target as HTMLElement;
        if (target.closest('a') || target.closest('button') || target.closest('.ref-link') || target.closest('.editor-img-container')) {
            return;
        }

        // 我们只把焦点给这个 field，不需要特定 id
        // 可以传第一个 atom 的 id 作为象征，在 cm 里其实是一整片
        const firstId = atomIds.length > 0 ? atomIds[0] : `temp_${crypto.randomUUID()}`;
        setActiveEditor({ field, id: firstId });
    };

    const handleAdd = (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        const newId = genTempId();
        addAtomId(field, newId, index);
        setActiveEditor({ field, id: newId });
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (readOnly) return;
        if (e.dataTransfer?.types.includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    };

    const handleDrop = (e: React.DragEvent, targetIndex: number) => {
        if (readOnly || isEditing) return;
        if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;

        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) return;

        e.preventDefault();
        e.stopPropagation();

        const blobs: Record<string, Blob | ArrayBuffer> = {};
        const imagesMeta = [];
        for (let i = 0; i < files.length; i++) {
            const uuid = genTempId();
            blobs[uuid] = files[i];
            imagesMeta.push({ id: uuid, widthRatio: 1, caption: '' });
        }

        const newId = genTempId();
        addAtomId(field, newId, targetIndex);

        const state = useWorkspaceStore.getState();
        state.updateAtomBlobs(newId, blobs);
        state.updateAtomMeta(newId, {
            images: imagesMeta
        });

        // Let it stay in read-only or open editor, here we open editor
        setActiveEditor({ field, id: newId });
    };

    const handleCompleteEdit = () => {
        // 如果有 lint 错误，显示警告弹窗，阻止编辑完成
        if (fieldLintErrors) {
            setShowErrorDialog(true);
            return;
        }
        // 无错误，直接完成编辑
        setActiveEditor(null);
    };

    if (isEditing) {
        return (
            <div className={`relative w-full ${className}`}>
                <ErrorBoundary>
                    <UnifiedCodeMirror field={field} initialAtomIds={atomIds} />
                </ErrorBoundary>

                {/* 右上角操作按钮：完成编辑 */}
                <div className="absolute top-2 right-2 flex gap-1 z-10">
                    <button
                        onClick={handleCompleteEdit}
                        className={`p-1 rounded text-sm font-medium transition-colors shadow-sm ${
                            fieldLintErrors
                                ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                                : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                        }`}
                    >
                        <Check size={16}/> 
                    </button>
                </div>

                {/* 错误警告弹窗 */}
                {showErrorDialog && (
                    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4">
                            {/* 弹窗头部 */}
                            <div className="flex items-center gap-3 p-4 border-b border-slate-200">
                                <AlertTriangle size={20} className="text-orange-500 flex-shrink-0" />
                                <h2 className="text-lg font-semibold text-slate-900">编辑验证失败</h2>
                            </div>

                            {/* 弹窗内容 */}
                            <div className="p-4">
                                <p className="text-slate-700">
                                    检测到编辑错误：段落间存在问题（未正确使用双换行符分隔或包含非法字符）。请检查并修复后再提交。
                                </p>
                            </div>

                            {/* 弹窗底部操作 */}
                            <div className="flex gap-2 p-4 border-t border-slate-200 justify-end">
                                <button
                                    onClick={() => setShowErrorDialog(false)}
                                    className="px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded font-medium transition-colors"
                                >
                                    继续编辑
                                </button>
                                <button
                                    onClick={() => {
                                        setShowErrorDialog(false);
                                        setActiveEditor(null);
                                    }}
                                    className="px-4 py-2 text-slate-700 bg-orange-100 hover:bg-orange-200 rounded font-medium transition-colors"
                                >
                                    放弃更改
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // --- 只读视图 ---
    return (
        <div
            onClick={handleContainerClick}
            onPointerOver={handlePointerOver}
            onPointerLeave={handlePointerLeave}
            className={`
                group/field relative w-full rounded-lg transition-all
                ${!readOnly ? 'cursor-text hover:bg-slate-50 ring-1 ring-transparent hover:ring-slate-200' : ''}
                ${className}
            `}
        >
            {/* 只读时的编辑提示图标 */}
            {!readOnly && (
                <div className="absolute top-2 right-2 opacity-0 group-hover/field:opacity-100 transition-opacity pointer-events-none text-slate-400">
                    <Edit3 size={16} />
                </div>
            )}

            <div
                className="p-4 flex flex-col min-h-[100px]"
                onDragOver={handleDragOver}
                onDrop={(e) => {
                    if (atomIds.length === 0) handleDrop(e, -1);
                }}
            >
                {atomIds.length === 0 ? (
                    <div className="text-slate-400 text-sm italic py-2 pointer-events-none">
                        暂无内容，或拖拽图片到此处...
                    </div>
                ) : (
                    atomIds.map((id, index) => {
                        const atom = atomsData[id];
                        const content = atom?.content || '';
                        const attr = atom?.attr || null;

                        return (
                            <div 
                                key={id} 
                                className="relative group/block"
                                data-index={index}
                            >
                                {/* 块顶部插入按钮 */}
                                {!readOnly && index === 0 && (
                                    <div className={`absolute -top-[14px] left-0 w-full flex justify-center opacity-0 ${(hoveredIndex === index) && 'opacity-100'} transition-opacity z-10 pointer-events-none`}>
                                        <button
                                            onClick={(e) => handleAdd(e, -1)}
                                            className="pointer-events-auto bg-indigo-50 text-indigo-400 rounded-full p-1 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200 bg-opacity-90 backdrop-blur-sm"
                                        >
                                            <Plus size={12} />
                                        </button>
                                    </div>
                                )}

                                {/* 块内容与左侧边框 */}
                                <div className="py-2">
                                    {atom?.type === 'bin' ? (
                                        <div className="pl-0 group-hover/block:bg-slate-50/50 transition-colors max-h-[800px] overflow-hidden relative">
                                            {(() => {
                                                let meta = {};
                                                try {
                                                    meta = JSON.parse(atom.content || '{}');
                                                } catch (e) {
                                                    // Fallback
                                                }
                                                return <ImageGroupViewer
                                                    blobs={atom.blobs || {}}
                                                    meta={meta}
                                                />;
                                            })()}
                                            {/* Add a fade to indicate it can be expanded/edited if it's very tall */}
                                            <div className="absolute inset-0 hover:bg-black/5 transition-colors pointer-events-none rounded-lg" />
                                        </div>
                                    ) : (
                                        <div className="pl-3 border-l-[3px] border-slate-200 group-hover/block:border-indigo-300 transition-colors">
                                            <RichTextRenderer content={content} enableAnalysis={true} />
                                        </div>
                                    )}
                                </div>

                                {/* 块版权信息浮窗 (非编辑状态悬浮) */}
                                {attr && Object.keys(attr).length > 0 && (
                                    <div className="absolute left-3 top-full mt-1 opacity-0 group-hover/block:opacity-100 transition-opacity pointer-events-none z-20">
                                        <CopyrightTooltip
                                            authors={Object.entries(attr).map(([author, share]) => ({ author, share: Number(share) }))}
                                            diffAdded={atom?.diffAdded || 0}
                                            diffDeleted={atom?.diffDeleted || 0}
                                            diffRetained={atom?.diffRetained || 0}
                                            itemId={id}
                                        />
                                    </div>
                                )}

                                {/* 块底部插入按钮 */}
                                {!readOnly && (
                                    <div
                                        className={`absolute -bottom-[14px] left-0 w-full flex justify-center opacity-0 ${((hoveredIndex === index) || hoveredIndex === index + 1) && 'opacity-100'} transition-opacity z-10`}
                                        onDragOver={handleDragOver}
                                        onDrop={(e) => handleDrop(e, index)}
                                    >
                                        <div className="absolute inset-x-0 h-4 bg-transparent -top-2" />
                                        <button
                                            onClick={(e) => handleAdd(e, index)}
                                            className="relative pointer-events-auto bg-indigo-50 text-indigo-400 rounded-full p-1 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm border border-indigo-200 bg-opacity-90 backdrop-blur-sm"
                                        >
                                            <Plus size={12} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};
