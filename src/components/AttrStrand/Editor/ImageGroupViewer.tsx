import React, { useEffect, useState } from 'react';
import type { BinAtomMeta } from '../../../attrstrand/types';

interface ImageGroupViewerProps {
    blobs: Record<string, Blob | ArrayBuffer>;
    meta: BinAtomMeta;
}

export const ImageGroupViewer: React.FC<ImageGroupViewerProps> = ({ blobs, meta }) => {
    const [urls, setUrls] = useState<Record<string, string>>({});

    useEffect(() => {
        const objectUrls: Record<string, string> = {};
        if (Array.isArray(blobs)) {
            // Backward compatibility for old atoms where blobs is an array
            blobs.forEach((blob, index) => {
                const id = meta.images?.[index]?.id || `img_${index}`;
                if (blob instanceof Blob) {
                    objectUrls[id] = URL.createObjectURL(blob);
                } else {
                    objectUrls[id] = URL.createObjectURL(new Blob([blob]));
                }
            });
        } else {
            for (const [id, blob] of Object.entries(blobs)) {
                if (blob instanceof Blob) {
                    objectUrls[id] = URL.createObjectURL(blob);
                } else {
                    objectUrls[id] = URL.createObjectURL(new Blob([blob]));
                }
            }
        }
        setUrls(objectUrls);

        return () => {
            Object.values(objectUrls).forEach(url => URL.revokeObjectURL(url));
        };
    }, [blobs, meta]);

    if (!blobs || Object.keys(blobs).length === 0) return null;

    const imagesMeta = meta.images || [];

    // Group images into rows based on widthRatio
    // A row breaks when the sum of widthRatios exceeds 1
    const rows: Array<typeof imagesMeta> = [];
    let currentRow: typeof imagesMeta = [];
    let currentRowWidth = 0;

    imagesMeta.forEach(img => {
        const width = img.widthRatio || 1;
        if (currentRowWidth + width > 1.01) { // 1.01 to allow minor floating point errors
            if (currentRow.length > 0) {
                rows.push(currentRow);
            }
            currentRow = [img];
            currentRowWidth = width;
        } else {
            currentRow.push(img);
            currentRowWidth += width;
        }
    });
    if (currentRow.length > 0) {
        rows.push(currentRow);
    }

    let globalImageIndex = 0;

    // LaTeX subfigure style rendering
    return (
        <div className="w-full my-4 flex flex-col items-center justify-center font-serif text-slate-800 bg-white">
            <div className="w-full flex flex-col gap-y-6">
                {rows.map((row, rowIndex) => {
                    // Pre-calculate indices for this row
                    const rowItems = row.map(imgMeta => {
                        const index = globalImageIndex++;
                        return { imgMeta, index };
                    });

                    // For rendered images, group the image and caption into two rows per item, bound together.
                    // The upper images vertically centered, lower captions top-aligned.
                    return (
                        <div key={rowIndex} className="w-full flex flex-col items-center">
                            {/* Images Row: Vertically Centered */}
                            <div className="w-full flex flex-row justify-center items-center">
                                {rowItems.map(({ imgMeta, index }) => {
                                    const url = urls[imgMeta.id] || '';
                                    const widthRatio = imgMeta.widthRatio || 1;
                                    const caption = imgMeta.caption || '';
                                    return (
                                        <div
                                            key={`img-${index}`}
                                            style={{ width: `${widthRatio * 100}%` }}
                                            className="flex flex-col items-center justify-center px-2 box-border"
                                        >
                                            <img
                                                src={url}
                                                alt={caption || `Figure sub ${index + 1}`}
                                                className="max-w-full max-h-[600px] object-contain"
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Captions Row: Top Aligned */}
                            {rowItems.some(({ imgMeta }) => imgMeta.caption) && (
                                <div className="w-full flex flex-row justify-center items-start mt-2">
                                    {rowItems.map(({ imgMeta, index }) => {
                                        const widthRatio = imgMeta.widthRatio || 1;
                                        const caption = imgMeta.caption || '';
                                        return (
                                            <div
                                                key={`cap-${index}`}
                                                style={{ width: `${widthRatio * 100}%` }}
                                                className="flex flex-col items-center justify-start px-2 box-border text-sm text-center"
                                            >
                                                {caption && (
                                                    <span>
                                                        {imagesMeta.length > 1 && `(${String.fromCharCode(97 + index)}) `}
                                                        {caption}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {meta.groupCaption && (
                <div className="mt-4 text-center font-medium w-full max-w-[90%]">
                    {meta.groupCaption}
                </div>
            )}
        </div>
    );
};
