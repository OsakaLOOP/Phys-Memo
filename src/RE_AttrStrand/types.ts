// 基础类型与别名

type hash =  string; // SHA256
type uuid = string; // UUID v4
type DraftId = string; // 草稿 ID, 可以是随机 UUID, 也可以是继承的hash, 由前端生成, 提交时后端验证并计算最终 Atom ID.

export type ContentAtomField = 'doc' | 'core' | 'tags' | 'refs' | 'rels' // 所有概念页展示的字段内容均 json 格式化, 作为对应域的 Atom 存储.
export type ContentAtomType = 'latex' | 'markdown' | 'inline' | 'sources' // inline -> tags/refs, sources -> uploaded md/pdf file links.
export type ContentAtomAttr = Record<string, number> // {"author1": prop1, ...}, 用于计算版权分配
export type Meta = Record<string, string | number | boolean | null> // 其他字段, 只用于编辑器渲染/ 后端 worker. 否则应当定义在顶层. 前后端 meta 必须分离, 后者api返回时剔除. 不参与hash计算
// createdAt 现已移入backmeta.
// 持续层定义. 这些接口对象一旦生成，其 Hash ID 绝对不可变.

export interface IContentAtom {
    id: hash
    field: ContentAtomField;
    type: ContentAtomType;

    content: string; // 纯文本或 json
    contentHash: hash; // 纯文本部分的 hash, 查重
    contentSimHash: hash | null; // 为基于相似度的计算预留
    
    creatorId: string;
    timestampISO: string; // 前端传递
    attr: ContentAtomAttr;
    derivedFromId: hash | null;// 溯源指针，永远只能指向真实的 Hash，不能指向 DraftId, 在 Workspace 中不能改变.

    frontMeta: Meta;
    backMeta: Meta;
}

export interface IConceptRoot {
    id: hash;
    name: string;
    topic: string;
    disciplines: string[];

    creatorId: string;
    timestampISO: string;


    currentHeads: Record<hash, number>; // 每个最新 Edition 及对应 sort.
    
    frontMeta:Meta;
    backMeta: Meta; // 为以后的更多后端计算结果预留
}


export interface IEdition {
    id: hash;
    conceptId: hash;
    saveType: 'autosave' | 'save' | 'publish'; // save: personal; publish: public

    coreAtomIds: hash[]
    docAtomIds: hash[]
    tagsAtomIds: hash[]
    refsAtomIds: hash[]
    relsAtomIds: hash[]

    creator: string;
    timestampISO: string;

    parentEditionId: hash | null; // null 指向 Concept root

    frontMeta: Meta;
    backMeta: Meta; // 同样预留

}

// 前端渲染用数据层. 接受并转换为 Workspace

export interface IPopulatedEdition extends Omit<IEdition, 'coreAtomIds' | 'docAtomIds' | 'tagsAtomIds' | 'refsAtomIds' | 'relsAtomIds'> {
    coreAtoms: Omit<IContentAtom, 'backMeta'>[];
    docAtoms: Omit<IContentAtom, 'backMeta'>[];
    tagsAtoms: Omit<IContentAtom, 'backMeta'>[];
    refsAtoms: Omit<IContentAtom, 'backMeta'>[];
    relsAtoms: Omit<IContentAtom, 'backMeta'>[];
} // 后端返回的完整填充 Edition, 用于渲染, 避免过多请求. 为了安全, 剔除后端 meta.

export interface IConceptView{

}
export interface ITopicView {
    topic: string;
    ConceptViews: Record<string, IConceptView> 
}

export type AtomDraft = Omit<IContentAtom, 'id' | 'backMeta'> & {
    id: DraftId; // 允许是hash/ UUID
};

export interface IWorkspaceDraft {
    conceptId: hash;
    baseEditionId: hash;

    lastEdited: string;
    draftCoreAtomIds: Array<DraftId>; 
    draftDocAtomIds: Array<DraftId>;
    draftTagsAtomIds: Array<DraftId>;
    draftRefsAtomIds: Array<DraftId>;
    draftRelsAtomIds: Array<DraftId>;// 若为新建, 则为随机uuid, 提交时再计算.

    draftAtomsData: Record<DraftId, AtomDraft>; // 本地草稿编辑时的 Atom 数据, 包含 contentJson 和 frontMeta, 但不包含后端 meta. key 是 Atom ID, value 是 Atom 数据.
}

// 前端提交的请求格式.

export interface AtomSubmission {
    contentPayload: string;
    field: ContentAtomField;
    type: ContentAtomType;
    derivedFromId: hash | null;
}

export interface EditionSubmission {
    conceptId: hash;
    baseEditionId: hash | null; // null 代表新建, 否则为编辑已有 Edition

    saveType: 'autosave'| 'usersave' | 'publish';
    coreAtoms: AtomSubmission[];
    docAtoms: AtomSubmission[];
    tagsAtoms: AtomSubmission[];
    refsAtoms: AtomSubmission[];
    relsAtoms: AtomSubmission[];
}

