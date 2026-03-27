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
        // Calculate effective width ratio based on height limits to avoid horizontal whitespace
        // Max container height is bounded to 800px. Standard container width is assumed ~800px.
        // If image natural height requires scaling it down, we shrink the effective horizontal width ratio to tightly match bounds.
        let effectiveWidthRatio = img.widthRatio || 1;
        if (img.naturalWidth && img.naturalHeight) {
            // maxRatio = 800(max height) / (800(assumed width) * (naturalHeight / naturalWidth))
            // Which simplifies to naturalWidth / naturalHeight
            const maxRatio = img.naturalWidth / img.naturalHeight;
            if (maxRatio < effectiveWidthRatio) {
                effectiveWidthRatio = maxRatio;
            }
        }

        // Save the computed effective ratio for rendering
        const processedImg = { ...img, effectiveWidthRatio };

        if (currentRowWidth + effectiveWidthRatio > 1.01) { // 1.01 to allow minor floating point errors
            if (currentRow.length > 0) {
                rows.push(currentRow);
            }
            currentRow = [processedImg];
            currentRowWidth = effectiveWidthRatio;
        } else {
            currentRow.push(processedImg);
            currentRowWidth += effectiveWidthRatio;
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
                                    const effectiveWidthRatio = (imgMeta as any).effectiveWidthRatio || widthRatio;
                                    return (
                                        <div
                                            key={`img-${index}`}
                                            style={{ width: `${effectiveWidthRatio * 100}%` }}
                                            className="flex flex-col items-center justify-center box-border"
                                        >
                                            <img
                                                src={url}
                                                alt={caption || `Figure sub ${index + 1}`}
                                                className="max-w-full max-h-[800px] object-contain"
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
                                        const effectiveWidthRatio = (imgMeta as any).effectiveWidthRatio || widthRatio;
                                        return (
                                            <div
                                                key={`cap-${index}`}
                                                style={{ width: `${effectiveWidthRatio * 100}%` }}
                                                className="flex flex-col items-center justify-start box-border text-sm text-center"
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
