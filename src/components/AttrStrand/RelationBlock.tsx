import React, { useState, useEffect } from 'react';
import { useWorkspaceStore, useGlobalStore } from '../../store/workspaceStore';
import type { DraftId } from '../../attrstrand/types';
import RichTextRenderer from '../RichTextRenderer';
import { X, Check } from 'lucide-react';
import { RELATION_TYPES } from '../../constants';

interface RelationBlockProps {
    atomId: DraftId;
    readOnly?: boolean;
    className?: string;
}

interface RelationData {
    targetId: string;
    type: string;
    condition: string;
}

export const RelationBlock: React.FC<RelationBlockProps> = ({
    atomId,
    readOnly = false,
    className = ''
}) => {
    // Subscribe specifically to this atom
    const atom = useWorkspaceStore((state: any) => state.draftAtomsData[atomId]);
    const updateAtomContent = useWorkspaceStore((state: any) => state.updateAtomContent);
    const conceptViews = useGlobalStore((state: any) => state.conceptViews); // Use global map for lookups

    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState<RelationData>({ targetId: '', type: 'DERIVES_FROM', condition: '' });

    // Parse content
    useEffect(() => {
        if (atom?.content) {
            try {
                const parsed = JSON.parse(atom.content);
                setEditData(parsed);
            } catch (e) {
                console.error("Failed to parse relation atom content", atom.content);
            }
        }
    }, [atom?.content]);

    if (!atom) return null;

    const handleSave = () => {
        const json = JSON.stringify(editData);
        if (json !== atom.content) {
            updateAtomContent(atomId, json);
        }
        setIsEditing(false);
    };

    const handleCancel = () => {
        try {
            if (atom.content) setEditData(JSON.parse(atom.content));
        } catch(e) {}
        setIsEditing(false);
    };

    const targetNode = conceptViews[editData.targetId];
    const typeConfig = RELATION_TYPES[editData.type as keyof typeof RELATION_TYPES] || { label: editData.type, icon: '?', color: 'text-slate-500' };

    if (isEditing) {
        return (
            <div className={`bg-white p-3 rounded-lg border border-indigo-200 shadow-sm ${className}`}>
                <div className="flex flex-col gap-2">
                     <div className="flex gap-2">
                        <select
                            value={editData.type}
                            onChange={(e) => setEditData({...editData, type: e.target.value})}
                            className="text-xs border border-slate-200 rounded px-2 py-1 bg-slate-50 focus:ring-1 focus:ring-indigo-300 outline-none"
                        >
                             {Object.entries(RELATION_TYPES).map(([k, v]) => (
                                 <option key={k} value={k}>{v.label}</option>
                             ))}
                        </select>
                        <select
                            value={editData.targetId}
                            onChange={(e) => setEditData({...editData, targetId: e.target.value})}
                            className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 bg-slate-50 focus:ring-1 focus:ring-indigo-300 outline-none"
                        >
                            <option value="">选择概念条目...</option>
                             {Object.entries(conceptViews).map(([id, node]) => (
                                 <option key={id} value={id}>{(node as any).name}</option> // using .name now instead of .title based on new type
                             ))}
                        </select>
                     </div>
                     <input
                        type="text"
                        value={editData.condition}
                        onChange={(e) => setEditData({...editData, condition: e.target.value})}
                        placeholder="条件 (e.g. if x > 0)..."
                        className="text-xs border border-slate-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-300 outline-none w-full"
                     />
                     <div className="flex justify-end gap-2 mt-1">
                         <button onClick={handleCancel} className="btn-icon"><X size={14} /></button>
                         <button onClick={handleSave} className="p-1 text-green-500 hover:text-green-700"><Check size={14} /></button>
                     </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`group relative pl-1 pb-0 ${className}`}>
            
             <div
                className="flex flex-col sm:flex-row sm:items-start gap-2 bg-white p-3 rounded-lg border border-slate-100 hover:shadow-md transition-all hover:border-indigo-100 cursor-pointer"
                onClick={() => !readOnly && setIsEditing(true)}
             >
                 {/* Type Badge */}
                <div className={`flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-md bg-slate-50 border border-slate-100 ${typeConfig.color} min-w-fit mt-0.5`}>
                     <span>{typeConfig.icon}</span>
                     <span>{typeConfig.label}</span>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between">
                         <span className="text-sm font-semibold text-slate-700 group-hover:text-indigo-600 truncate">
                             {targetNode ? targetNode.name : (editData.targetId ? '未知条目' : '点击编辑关联')}
                         </span>
                    </div>
                    {editData.condition && (
                         <div className="mt-1 text-xs text-slate-500 flex items-start gap-1">
                             <span className="text-indigo-400 italic font-serif">if</span>
                             <span className="bg-yellow-50 px-1.5 rounded text-yellow-700 border border-yellow-100/50">
                                 <RichTextRenderer content={editData.condition} className="inline-block [&>p]:inline [&>p]:m-0" />
                             </span>
                         </div>
                    )}
                </div>
             </div>
        </div>
    );
};
