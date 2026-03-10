export interface RelationTypeConfig {
  label: string;
  icon: string;
  color: string;
}

export const RELATION_TYPES: Record<string, RelationTypeConfig> = {
  DERIVES_FROM: { label: '推导自', icon: '⇒', color: 'text-slate-500' },
  SPECIAL_CASE: { label: '特例属于', icon: '⊂', color: 'text-blue-500' },
  EMPIRICAL_FIT: { label: '经验拟合于', icon: '~', color: 'text-emerald-500' },
  CONTRADICTS: { label: '矛盾/反驳', icon: '⚠', color: 'text-red-500' },
  MODIFIES: { label: '修正了', icon: 'Δ', color: 'text-orange-500' },
  EXPLAINS: { label: '解释机制', icon: '?', color: 'text-purple-500' },
};
