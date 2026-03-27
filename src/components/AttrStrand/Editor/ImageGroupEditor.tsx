import React, { useState, useEffect, useRef } from 'react';
import { GripHorizontal } from 'lucide-react';
import type { BinAtomMeta } from '../../../attrstrand/types';

interface ImageGroupEditorProps {
    blobs: Record<string, Blob | ArrayBuffer>;
    meta: BinAtomMeta;
    onUpdateMeta: (newMeta: BinAtomMeta) => void;
    onUpdateBlobs: (newBlobs: Record<string, Blob | ArrayBuffer>) => void;
    inputRef?: React.RefObject<HTMLInputElement | null>;
}

export const ImageGroupEditor: React.FC<ImageGroupEditorProps> = ({ blobs, meta, onUpdateMeta, onUpdateBlobs, inputRef }) => {
    const [urls, setUrls] = useState<string[]>([]);

    // Convert array buffers/blobs to object URLs for preview based on meta.images
    useEffect(() => {
        const objectUrls = (meta.images || []).map(img => {
            const blob = blobs && blobs[img.id];
            if (!blob) return '';
            if (blob instanceof Blob) {
                return URL.createObjectURL(blob);
            } else {
                return URL.createObjectURL(new Blob([blob]));
            }
        });
        setUrls(objectUrls);

        return () => {
            objectUrls.forEach(url => {
                if (url) URL.revokeObjectURL(url);
            });
        };
    }, [blobs, meta.images]);

    const handleGroupCaptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onUpdateMeta({ ...meta, groupCaption: e.target.value });
    };

    const handleImageCaptionChange = (index: number, newCaption: string) => {
        const newImages = [...(meta.images || [])];
        if (!newImages[index]) {
            newImages[index] = { id: crypto.randomUUID().replace(/-/g, ''), widthRatio: 1, caption: '' };
        } else {
            newImages[index] = { ...newImages[index], caption: newCaption };
        }
        onUpdateMeta({ ...meta, images: newImages });
    };

    const handleWidthChange = (index: number, newRatio: number) => {
        // Clamp between 0.1 and 1.0, precision 0.1
        const clampedRatio = Math.max(0.1, Math.min(1.0, Math.round(newRatio * 10) / 10));
        const newImages = [...(meta.images || [])];
        if (!newImages[index]) {
            newImages[index] = { id: `img_${index}`, widthRatio: 1, caption: '' };
        }
        newImages[index].widthRatio = clampedRatio;
        onUpdateMeta({ ...meta, images: newImages });
    };

    // Resizing logic for right edge
    const [resizingIndex, setResizingIndex] = useState<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (resizingIndex !== null && containerRef.current) {
                // This mouse tracking is a bit fragile if scroll happens, a more robust way:
                // Find the image's own left edge:
                const imgElements = containerRef.current.querySelectorAll('.editor-img-container');
                if (imgElements[resizingIndex]) {
                    const rect = imgElements[resizingIndex].getBoundingClientRect();
                    const widthPixels = e.clientX - rect.left;
                    const calculatedRatio = widthPixels / 300; // 300px base width for 1.0 ratio in editor
                    handleWidthChange(resizingIndex, calculatedRatio);
                }
            }
        };

        const handleMouseUp = () => {
            setResizingIndex(null);
        };

        if (resizingIndex !== null) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizingIndex, meta]);

    // Simple Drag & Drop Reordering logic
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    const onDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        // Hide preview to use native drag appearance
    };

    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const onDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        if (draggedIndex === null || draggedIndex === dropIndex) return;

        // Reorder meta.images (blobs map doesn't change)
        const newImages = [...(meta.images || [])];
        const [draggedMeta] = newImages.splice(draggedIndex, 1);
        newImages.splice(dropIndex, 0, draggedMeta);
        onUpdateMeta({ ...meta, images: newImages });
        setDraggedIndex(null);
    };

    return (
        <div className="w-full flex flex-col gap-4">
            {/* Header: Group Caption */}
            <div className="flex flex-col">
                <label className="text-xs font-semibold text-slate-500 mb-1">图片组标题 (Group Caption)</label>
                <input
                    ref={inputRef}
                    type="text"
                    value={meta.groupCaption || ''}
                    onChange={handleGroupCaptionChange}
                    placeholder="输入图组总标题..."
                    className="w-full p-2 border border-slate-300 rounded text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 transition-shadow"
                />
            </div>

            {/* Scrollable Horizontal Images Container */}
            <div
                ref={containerRef}
                className="flex flex-row overflow-x-auto gap-4 pb-4 items-end whitespace-nowrap scrollbar-thin scrollbar-thumb-indigo-200 scrollbar-track-transparent"
                style={{ minHeight: '200px' }}
            >
                {urls.map((url, index) => {
                    const imgMeta = meta.images?.[index] || { widthRatio: 1, caption: '' };
                    const widthRatio = imgMeta.widthRatio;
                    // base width 300px = ratio 1.0
                    const pxWidth = Math.max(80, widthRatio * 300);

                    return (
                        <div
                            key={index}
                            draggable
                            onDragStart={(e) => onDragStart(e, index)}
                            onDragOver={(e) => onDragOver(e)}
                            onDrop={(e) => onDrop(e, index)}
                            className={`editor-img-container relative flex flex-col items-center bg-white border rounded shadow-sm flex-none transition-opacity ${draggedIndex === index ? 'opacity-50' : 'opacity-100'}`}
                            style={{ width: pxWidth, minWidth: '80px' }}
                        >
                            {/* Drag Handle Top */}
                            <div className="absolute top-0 left-0 right-0 h-6 bg-slate-100 flex items-center justify-center cursor-grab active:cursor-grabbing rounded-t opacity-0 hover:opacity-100 transition-opacity">
                                <GripHorizontal size={14} className="text-slate-400" />
                            </div>

                            {/* Image Preview */}
                            <div className="w-full flex-1 flex items-center justify-center p-2 mt-4 pointer-events-none">
                                <img src={url} alt={`Preview ${index}`} className="max-w-full max-h-[150px] object-contain select-none" />
                            </div>

                            {/* Resizer Handle Right Edge */}
                            <div
                                className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-indigo-300/50 flex items-center justify-center group/resizer"
                                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setResizingIndex(index); }}
                            >
                                <div className="w-0.5 h-8 bg-indigo-300 group-hover/resizer:bg-indigo-500 rounded-full"></div>
                                {/* Ratio Tooltip */}
                                <div className="absolute top-1/2 -translate-y-1/2 left-4 bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded shadow whitespace-nowrap opacity-0 group-hover/resizer:opacity-100 pointer-events-none z-10 transition-opacity">
                                    {(widthRatio * 100).toFixed(0)}%
                                </div>
                            </div>

                            {/* Delete Button */}
                            <div className="absolute top-1 right-1 opacity-0 group-hover/resizer:opacity-100 hover:!opacity-100 transition-opacity z-20">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const newImages = [...(meta.images || [])];
                                        const imgToRemove = newImages[index];
                                        newImages.splice(index, 1);
                                        // We don't necessarily need to delete from blobs, but we could
                                        const newBlobs = { ...blobs };
                                        if (imgToRemove && newBlobs[imgToRemove.id]) {
                                            delete newBlobs[imgToRemove.id];
                                        }
                                        onUpdateBlobs(newBlobs);
                                        onUpdateMeta({ ...meta, images: newImages });
                                    }}
                                    className="p-1 bg-red-100 text-red-500 rounded hover:bg-red-200"
                                    title="删除图片"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                                </button>
                            </div>

                            {/* Caption Input */}
                            <input
                                type="text"
                                value={imgMeta.caption || ''}
                                onChange={(e) => handleImageCaptionChange(index, e.target.value)}
                                placeholder="子图注..."
                                className="w-full text-xs text-center border-t border-slate-100 p-1 outline-none focus:bg-indigo-50"
                                onMouseDown={(e) => e.stopPropagation()} // prevent drag on text select
                            />
                        </div>
                    );
                })}

                {/* Append Area */}
                <div
                    className="flex-none w-[100px] h-[150px] border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center text-slate-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors mb-[28px]"
                    onDragOver={(e) => {
                        if (e.dataTransfer?.types.includes('Files')) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'copy';
                        }
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
                        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                        if (files.length === 0) return;

                        const newBlobs = { ...blobs };
                        const newImages = [...(meta.images || [])];
                        for (let i = 0; i < files.length; i++) {
                            const newId = crypto.randomUUID().replace(/-/g, '');
                            newBlobs[newId] = files[i];
                            newImages.push({ id: newId, widthRatio: 1, caption: '' });
                        }
                        onUpdateBlobs(newBlobs);
                        onUpdateMeta({ ...meta, images: newImages });
                    }}
                >
                    <div className="flex flex-col items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-2"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                        <span className="text-xs text-center px-2">拖入图片<br/>添加至末尾</span>
                    </div>
                </div>
            </div>
            <div className="text-xs text-slate-400 mt-[-10px]">
                提示: 左右拖动图片右边缘可调整相对宽度；拖动图片顶部区域可排序；将新图片拖入末尾虚线框可添加新图.
            </div>
        </div>
    );
};
