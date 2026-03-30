import React, { useState } from 'react';
import { Star, ThumbsUp, ThumbsDown, GitMerge, Trash2, MoreHorizontal } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { core } from '../../attrstrand/core';
import type { EditionFlagType } from '../../attrstrand/types';
import toast from 'react-hot-toast';

export const EditionFlagBar: React.FC<{
    editionId: string | null;
    currentUserId: string;
}> = ({ editionId, currentUserId }) => {
    const [showDropdown, setShowDropdown] = useState(false);
    const flags = useWorkspaceStore(state => state.baseEditionFlags);
    const setFlags = useWorkspaceStore(state => state.setEditionFlags);

    if (!editionId) return null;

    const getFlagCount = (type: EditionFlagType) => flags.filter(f => f.type === type).length;
    const isFlaggedByUser = (type: EditionFlagType) => flags.some(f => f.type === type && f.userId === currentUserId);

    const handleToggle = async (type: EditionFlagType) => {
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors text-sm font-medium ${
                    isChecked
                    ? 'text-indigo-600 bg-indigo-50'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
                title={title}
            >
                <Icon className={`w-4 h-4 ${isChecked ? 'fill-current' : ''}`} />
                <span>{count > 0 ? count : ''}</span>
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

    return (
        <div className="flex items-center bg-white rounded-full shadow-sm border border-slate-200 px-1 h-10 relative">
            <div className="flex items-center gap-1">
                {renderPublicBtn('star', Star, 'Star / 收藏')}
                <div className="w-px h-4 bg-slate-200" />
                {renderPublicBtn('upvote', ThumbsUp, 'Upvote / 赞同')}
                {renderPublicBtn('downvote', ThumbsDown, 'Downvote / 反对')}
            </div>

            <div className="w-px h-4 bg-slate-200 mx-1" />

            <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
            >
                <MoreHorizontal className="w-4 h-4" />
            </button>

            {showDropdown && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50">
                        {renderPrivateBtn('to-be-merged', GitMerge, '标记待合并 (To be merged)')}
                        {renderPrivateBtn('to-be-cleaned', Trash2, '标记待清理 (To be cleaned)')}
                    </div>
                </>
            )}
        </div>
    );
};
