import React, { useState, useRef, useEffect } from 'react';
import { Star, ArrowBigUp, ArrowBigDown, GitMerge, Trash2, MoreHorizontal, LucideBrushCleaning } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { core } from '../../attrstrand/core';
import type { EditionFlagType } from '../../attrstrand/types';
import toast from 'react-hot-toast';
import Modal from 'react-modal';

export const EditionFlagBar: React.FC<{
    editionId: string | null;
    currentUserId: string;
}> = ({ editionId, currentUserId }) => {
    const [showDropdown, setShowDropdown] = useState(false);
    const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
    const buttonRef = useRef<HTMLButtonElement>(null);
    const flags = useWorkspaceStore(state => state.baseEditionFlags);
    const setFlags = useWorkspaceStore(state => state.setEditionFlags);

    const getFlagCount = (type: EditionFlagType) => flags.filter(f => f.type === type).length;
    const isFlaggedByUser = (type: EditionFlagType) => flags.some(f => f.type === type && f.userId === currentUserId);

    const handleToggle = async (type: EditionFlagType) => {
        if (!editionId) return;
        try {
            const res = await core.toggleEditionFlag(editionId, currentUserId, type);
            if (res.success && res.flags) {
                setFlags(res.flags);
            } else {
                toast.error(res.message || '操作失败');
            }
        } catch (error) {
            toast.error('操作失败');
        }
    };

    const renderPublicBtn = (type: EditionFlagType, Icon: any, title: string) => {
        const isChecked = isFlaggedByUser(type);
        const count = getFlagCount(type);
        return (
            <button
                onClick={() => handleToggle(type)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-sm font-medium ${
                    isChecked
                    ? 'text-indigo-600 bg-indigo-50'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
                title={title}
            >
                <Icon className={`w-4 h-4 ${isChecked ? 'fill-current' : ''}`} />
                {count > 0 && <span className="text-xs">{count}</span>}
            </button>
        );
    };

    const renderPrivateBtn = (type: EditionFlagType, Icon: any, title: string) => {
        const isChecked = isFlaggedByUser(type);
        return (
            <button
                onClick={() => {
                    handleToggle(type);
                    setShowDropdown(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left"
            >
                <Icon className={`w-4 h-4 ${isChecked ? 'fill-indigo-600 text-indigo-600' : 'text-slate-400'}`} />
                <span className={isChecked ? 'text-indigo-600 font-medium' : ''}>{title}</span>
                {isChecked && <span className="ml-auto text-xs text-indigo-500 bg-indigo-50 px-1.5 rounded">已选</span>}
            </button>
        );
    };

    const timeoutRef = useRef<number | null>(null);

    const updateDropdownPos = () => {
        if (buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            // Position modal relative to viewport, bottom right aligned to button
            setDropdownPos({
                top: rect.bottom,
                left: rect.right, // We will use right edge mapping inside modal inline style
            });
        }
    };

    const handleMouseEnter = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (!showDropdown) {
            updateDropdownPos();
            setShowDropdown(true);
        }
    };

    const handleMouseLeave = () => {
        timeoutRef.current = window.setTimeout(() => {
            setShowDropdown(false);
        }, 200); // 0.2s delay
    };

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    // Also update position on resize or scroll if modal is open
    useEffect(() => {
        if (!showDropdown) return;
        const handler = () => updateDropdownPos();
        window.addEventListener('resize', handler);
        window.addEventListener('scroll', handler, true);
        return () => {
            window.removeEventListener('resize', handler);
            window.removeEventListener('scroll', handler, true);
        };
    }, [showDropdown]);

    if (!editionId) return null;

    return (
        <div className="flex items-center bg-white rounded-full shadow-sm border border-slate-200 px-1 h-8 relative">
            <div className="flex items-center gap-0.5">
                {renderPublicBtn('star', Star, 'Star / 收藏')}
                {renderPublicBtn('upvote', ArrowBigUp, 'Vote Up / 赞同')}
                {renderPublicBtn('downvote', ArrowBigDown, 'Vote Down / 反反对')}
            </div>

            <button
                ref={buttonRef}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors outline-none"
            >
                <MoreHorizontal className="w-4 h-4" />
            </button>

            <Modal
                isOpen={showDropdown}
                onRequestClose={() => setShowDropdown(false)}
                className="absolute outline-none bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50 overflow-hidden w-48"
                overlayClassName="fixed inset-0 z-40 bg-transparent pointer-events-none"
                style={{
                    content: {
                        top: `${dropdownPos.top}px`,
                        left: `${dropdownPos.left}px`,
                        transform: 'translateX(-100%)', // Align right edge with button right edge
                        pointerEvents: 'auto',
                    }
                }}
            >
                <div
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    className="flex flex-col w-full h-full"
                >
                    {renderPrivateBtn('to-be-merged', GitMerge, '标记待合并')}
                    {renderPrivateBtn('to-be-cleaned', LucideBrushCleaning, '标记待清理')}
                </div>
            </Modal>
        </div>
    );
};
