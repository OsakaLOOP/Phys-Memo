import React, { useState, useEffect } from 'react';
import { storage } from '../../attrstrand/storage';
import type { IConceptRoot, IPopulatedEdition } from '../../attrstrand/types';

import { Layers, Book } from 'lucide-react';

// Using a dedicated store context might be overkill for read-only cards,
// but we need to supply the right props to AtomListEditor. Wait, AtomListEditor
// now strictly depends on the global workspace store.
// Since these are read-only cards, we can't use AtomListEditor from the global store easily.
// Let's implement a simple read-only renderer here or pass atoms directly if we want.
// Actually, I'll update AtomListEditor to take atoms optionally if readOnly is true, or just render it directly here to keep it simple.


interface TopicChildCardProps {
    conceptId: string;
    legacyTitle: string;
    legacyType: string;
    legacyTypeConfig: { label: string; color: string; nodeColor: string };
    onClick: () => void;
}

export const TopicChildCard: React.FC<TopicChildCardProps> = ({
    conceptId,
    legacyTitle,
    legacyType,
    legacyTypeConfig,
    onClick
}) => {
    const [concept, setConcept] = useState<IConceptRoot | null>(null);
    const [edition, setEdition] = useState<IPopulatedEdition | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            try {
                const c = await storage.getConcept(conceptId);
                if (c) {
                    setConcept(c);
                    // Get latest head
                    const heads = Object.entries(c.currentHeads).sort((a, b) => b[1] - a[1]);
                    if (heads.length > 0) {
                        const headId = heads[0][0];
                        const e = await storage.getEdition(headId);
                        if (e) {
                            // Populate atoms
                            const coreAtoms = await storage.getAtoms(e.coreAtomIds);
                            const docAtoms = await storage.getAtoms(e.docAtomIds);
                            const tagsAtoms = await storage.getAtoms(e.tagsAtomIds);
                            const refsAtoms = await storage.getAtoms(e.refsAtomIds);
                            const relsAtoms = await storage.getAtoms(e.relsAtomIds);

                            setEdition({
                                ...e,
                                coreAtoms,
                                docAtoms,
                                tagsAtoms,
                                refsAtoms,
                                relsAtoms
                            });
                        }
                    }
                }
            } catch (err) {
                console.error("Failed to load topic child data", err);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [conceptId]);

    if (loading) {
        return <div className="p-4 bg-white rounded-lg border border-slate-200 animate-pulse h-32"></div>;
    }

    // Fallback to minimal view if no attrstrand data (shouldn't happen with correct migration)
    if (!concept || !edition) {
         return (
             <div onClick={onClick} className="bg-white border border-slate-200 rounded-lg p-4 cursor-pointer hover:shadow-md transition-all opacity-70">
                 <h4 className="font-bold text-slate-800 mb-1">{legacyTitle}</h4>
                 <div className="text-xs text-red-400">Legacy Data Only (Migration Pending)</div>
             </div>
         );
    }

    return (
        <div
            onClick={onClick}
            className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer group flex gap-4"
        >
             {/* Icon / Type */}
             <div className="flex flex-col items-center gap-2 pt-1">
                <div className={`w-8 h-8 rounded-full flex-center text-white shadow-sm ${legacyTypeConfig?.color.split(' ')[0].replace('bg-', 'bg-indigo-500')}`} style={{ backgroundColor: legacyTypeConfig?.nodeColor }}>
                   <span className="font-bold text-xs">{legacyType[0]}</span>
                </div>
             </div>

             {/* Content */}
             <div className="flex-1 min-w-0 space-y-3">
                <div className="flex-between">
                   <h4 className="font-bold text-slate-800 group-hover:text-indigo-600 transition-colors truncate text-lg">{concept.name}</h4>
                   <span className={`text-[10px] px-2 py-0.5 rounded border ${legacyTypeConfig?.color}`}>
                      {legacyTypeConfig?.label.split(' ')[0]}
                   </span>
                </div>

                {/* Core Atoms (Latex) */}
                {edition.coreAtoms.length > 0 && (
                  <div className="bg-slate-50 rounded border border-slate-100 px-3 py-2 overflow-x-auto pointer-events-none">
                     {/* For read-only topic preview, directly render the first content to avoid store dependency */}
                     <div className="text-xs">
                        {edition.coreAtoms[0].content}
                     </div>
                  </div>
                )}

                {/* Doc Atoms (Description) */}
                {edition.docAtoms.length > 0 && (
                   <div className="text-xs text-slate-500 line-clamp-3 pointer-events-none">
                       {edition.docAtoms[0].content}
                   </div>
                )}

                {/* Footer Info */}
                <div className="flex items-center gap-4 text-[10px] text-slate-400 pt-2 border-t border-slate-50">
                     <span className="flex items-center gap-1">
                        <Layers size={12} />
                        v{Object.keys(concept.currentHeads).length} Versions
                     </span>
                     <span className="flex items-center gap-1">
                        <Book size={12} />
                        {edition.refsAtoms.length} Refs
                     </span>
                     <span className="font-mono">
                        ID: {concept.id.substring(0,6)}
                     </span>
                </div>
             </div>
        </div>
    );
};
