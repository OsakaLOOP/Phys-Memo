import React, { useEffect, useState } from 'react';
import type { BinAtomMeta } from '../../../attrstrand/types';

interface ImageGroupViewerProps {
    blobs: (Blob | ArrayBuffer)[];
    meta: BinAtomMeta;
}

export const ImageGroupViewer: React.FC<ImageGroupViewerProps> = ({ blobs, meta }) => {
    const [urls, setUrls] = useState<string[]>([]);

    useEffect(() => {
        const objectUrls = blobs.map(blob => {
            if (blob instanceof Blob) {
                return URL.createObjectURL(blob);
            } else {
                return URL.createObjectURL(new Blob([blob]));
            }
        });
        setUrls(objectUrls);

        return () => {
            objectUrls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [blobs]);

    if (!blobs || blobs.length === 0) return null;

    const imagesMeta = meta.images || [];

    // LaTeX subfigure style rendering
    return (
        <div className="w-full my-4 flex flex-col items-center justify-center font-serif text-slate-800">
            <div className="w-full flex flex-row flex-wrap justify-center items-end gap-y-6">
                {urls.map((url, index) => {
                    // Fallback to 1 if not specified
                    const widthRatio = imagesMeta[index]?.widthRatio || 1;
                    const caption = imagesMeta[index]?.caption || '';

                    return (
                        <div
                            key={index}
                            style={{ width: `${widthRatio * 100}%` }}
                            className="flex flex-col items-center justify-end px-2 box-border"
                        >
                            <img
                                src={url}
                                alt={caption || `Figure sub ${index + 1}`}
                                className="max-w-full h-auto object-contain"
                            />
                            {caption && (
                                <div className="mt-2 text-sm text-center">
                                    {imagesMeta.length > 1 && `(${String.fromCharCode(97 + index)}) `}
                                    {caption}
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
