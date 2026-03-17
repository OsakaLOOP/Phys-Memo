import React from 'react';

interface CopyrightTooltipProps {
    authors: { author: string; share: number }[];
    diffAdded: number;
    diffDeleted: number;
    diffRetained: number;
    itemId: string; // Could be atom ID or edition ID
    className?: string;
    style?: React.CSSProperties;
    isLoading?: boolean;
}

export const CopyrightTooltip: React.FC<CopyrightTooltipProps> = ({
    authors,
    diffAdded,
    diffDeleted,
    diffRetained,
    itemId,
    className = '',
    style,
    isLoading = false
}) => {
    return (
        <div
            className={`bg-white shadow-lg border rounded p-2 text-xs w-48 ${className}`}
            style={style}
        >
            <div className="font-bold mb-1 text-slate-600 border-b pb-1">版权归属</div>
            {isLoading ? (
                <div className="text-slate-400 italic py-2">计算中...</div>
            ) : (
                <>
                    {authors.map(({ author, share }) => (
                        <div key={author} className="flex justify-between text-slate-500 py-0.5">
                            <span className="truncate max-w-[100px]">{author}</span>
                            <span className="font-mono">{(Number(share) * 100).toFixed(1)}%</span>
                        </div>
                    ))}

                    <div className="mt-1 pt-1 border-t text-[10px] text-slate-500 flex justify-between">
                        <span className="text-green-600 font-medium">+{diffAdded}字</span>
                        <span className="text-red-500 font-medium">-{diffDeleted}字</span>
                        <span className="text-slate-400">留{diffRetained}字</span>
                    </div>

                    <div className="mt-1 pt-1 border-t text-[10px] text-slate-400 font-mono truncate">
                        ID: {itemId.substring(0, 8)}...
                    </div>
                </>
            )}
        </div>
    );
};
