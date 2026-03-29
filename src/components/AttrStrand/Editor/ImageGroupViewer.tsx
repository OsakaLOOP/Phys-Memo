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
    // A row breaks when the sum of effective width ratios exceeds 1
    const rows: Array<typeof imagesMeta> = [];
    let currentRow: typeof imagesMeta = [];
    let currentRowWidth = 0;

    imagesMeta.forEach(img => {
        // Base ratio calculation: 1 -> 50%
        const effectiveRatio = (img.widthRatio || 1) * 0.5;

        if (currentRowWidth + effectiveRatio > 1.01) { // 1.01 to allow minor floating point errors
            if (currentRow.length > 0) {
                rows.push(currentRow);
            }
            currentRow = [{ ...img, widthRatio: effectiveRatio }];
            currentRowWidth = effectiveRatio;
        } else {
            currentRow.push({ ...img, widthRatio: effectiveRatio });
            currentRowWidth += effectiveRatio;
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
                            {/* NEW CSS: justify-evenly (or justify-around/center) for distribution */}
                            <div className="w-full flex flex-row justify-evenly items-end">
                                {rowItems.map(({ imgMeta, index }) => {
                                    const url = urls[imgMeta.id] || '';
                                    const effectiveRatio = imgMeta.widthRatio || 1; // already calculated in the loop above
                                    const caption = imgMeta.caption || '';
                                    return (
                                        <div
                                            key={`col-${index}`}
                                            // Ensure width fits content.
                                            style={{ maxWidth: `${effectiveRatio * 100}%` }}
                                            className="flex flex-col items-center justify-start box-border shrink"
                                        >
                                            <div className="flex flex-col items-center justify-center w-fit max-h-[800px]">
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
