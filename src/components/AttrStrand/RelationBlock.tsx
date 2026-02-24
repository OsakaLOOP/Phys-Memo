import React, { useState, useEffect } from 'react';
import type { IContentAtom } from '../../attrstrand/types';
import RichTextRenderer from '../RichTextRenderer';
import { X, Check } from 'lucide-react';

interface RelationBlockProps {
    atom: IContentAtom;
    onUpdate: (newContent: string) => void;
    readOnly?: boolean;
    className?: string;
    // Map of node IDs to Node Data (or at least title/type) to resolve targetId
    // We pass a simple lookup function or map
    nodesMap: Record<string, { title: string }>;
    // Relation Config for icons/colors
    relationTypes: Record<string, { label: string; icon: string; color: string }>;
}

interface RelationData {
    targetId: string;
    type: string;
    condition: string;
}

export const RelationBlock: React.FC<RelationBlockProps> = ({
    atom,
    onUpdate,
    readOnly = false,
    className = '',
    nodesMap,
    relationTypes
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState<RelationData>({ targetId: '', type: 'DERIVES_FROM', condition: '' });

    // Parse contentJson to RelationData
    useEffect(() => {
        try {
            const parsed = JSON.parse(atom.contentJson);
            setEditData(parsed);
        } catch (e) {
            console.error("Failed to parse relation atom content", atom.contentJson);
        }
    }, [atom.contentJson]);

    const handleSave = () => {
        const json = JSON.stringify(editData);
        if (json !== atom.contentJson) {
            onUpdate(json);
        }
        setIsEditing(false);
    };

    const handleCancel = () => {
        try {
            setEditData(JSON.parse(atom.contentJson));
        } catch(e) {}
        setIsEditing(false);
    };

    const targetNode = nodesMap[editData.targetId];
    const typeConfig = relationTypes[editData.type] || { label: editData.type, icon: '?', color: 'text-slate-500' };

    // Attribution Logic (Simplified for Relation Block - usually not needed but kept for consistency if we want it later)
    // For relations, attribution is less visual, so we skip the popup unless requested.

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
                             {Object.entries(relationTypes).map(([k, v]) => (
                                 <option key={k} value={k}>{v.label}</option>
                             ))}
                        </select>
                        <select
                            value={editData.targetId}
                            onChange={(e) => setEditData({...editData, targetId: e.target.value})}
                            className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 bg-slate-50 focus:ring-1 focus:ring-indigo-300 outline-none"
                        >
                            <option value="">选择概念条目...</option>
                             {Object.entries(nodesMap).map(([id, node]) => (
                                 <option key={id} value={id}>{node.title}</option>
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
                         <button onClick={handleCancel} className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
                         <button onClick={handleSave} className="p-1 text-green-500 hover:text-green-700"><Check size={14} /></button>
                     </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`group relative pl-8 pb-0 ${className}`}>

             <div className="absolute -left-[7px] top-3 w-4 h-4 bg-white rounded-full border-2 border-slate-300 group-hover:border-indigo-400 transition-colors z-10"></div>

             <div
                className="flex flex-col sm:flex-row sm:items-start gap-3 bg-white p-3 rounded-lg border border-slate-100 hover:shadow-md transition-all hover:border-indigo-100 cursor-pointer"
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
                             {targetNode ? targetNode.title : '选择概念条目'}
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
