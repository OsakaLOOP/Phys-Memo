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
        const widthRatio = img.widthRatio || 1;

        if (currentRowWidth + widthRatio > 1.01) { // 1.01 to allow minor floating point errors
            if (currentRow.length > 0) {
                rows.push(currentRow);
            }
            currentRow = [img];
            currentRowWidth = widthRatio;
        } else {
            currentRow.push(img);
            currentRowWidth += widthRatio;
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
                            {/* Combined Row: Images and Captions in columns */}
                            <div className="w-full flex flex-row justify-center items-end">
                                {rowItems.map(({ imgMeta, index }) => {
                                    const url = urls[imgMeta.id] || '';
                                    const widthRatio = imgMeta.widthRatio || 1;
                                    const caption = imgMeta.caption || '';
                                    return (
                                        <div
                                            key={`col-${index}`}
                                            style={{ maxWidth: `${widthRatio * 100}%` }}
                                            className="flex flex-col items-center justify-start box-border"
                                        >
                                            <div className="flex flex-col items-center justify-center w-fit">
                                                <img
                                                    src={url}
                                                    alt={caption || `Figure sub ${index + 1}`}
                                                    className="max-w-full max-h-[800px] object-contain"
                                                />
                                                {caption && (
                                                    <div className="mt-2 text-sm text-center w-full">
                                                        <span>
                                                            {imagesMeta.length > 1 && `(${String.fromCharCode(97 + index)}) `}
                                                            {caption}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
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
