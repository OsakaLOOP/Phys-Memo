// 基础类型与别名

export type hash = string; // SHA256
export type uuid = string; // UUID v4 / Temp ID (can be hash length to be consistent)
export type DraftId = string; // 草稿 ID, 可以是随机的 256 位 uuid, 也可以是继承的 hash, 由前端生成, 提交时后端验证并计算最终 Atom ID.

export type ContentAtomField = 'doc' | 'core' | 'tags' | 'refs' | 'rels' // 所有概念页展示的字段内容均 json 格式化, 作为对应域的 Atom 存储.
export type ContentAtomType = 'latex' | 'markdown' | 'inline' | 'sources' | 'bin' // inline -> tags/refs, sources -> uploaded md/pdf file links, bin -> binary blob.
export type ContentAtomAttr = Record<string, number> // {"author1": prop1, ...}, 用于计算版权分配
export type Meta = Record<string, string | number | boolean | null> // 其他字段, 只用于编辑器渲染/ 后端 worker. 否则应当定义在顶层. 前后端 meta 必须分离, 后者api返回时剔除. 不参与hash计算
// createdAt 现已移入backmeta.
// 持续层定义. 这些接口对象一旦生成，其 Hash ID 绝对不可变.

export interface BinAtomMeta {
    groupCaption?: string;
    images: Array<{
        id: string;
        caption?: string;
        widthRatio: number;
    }>;
}

export interface IContentAtom {
    id: hash
    field: ContentAtomField;
    type: ContentAtomType;

    content: string; // 纯文本或 json
    blobs?: Record<string, Blob | ArrayBuffer>; // 仅当 type 为 'bin' 时存在的二进制流
    contentHash: hash; // 纯文本部分或二进制流的 hash, 查重
    contentSimHash: hash | null; // 为基于相似度的计算预留
    
    diffAdded?: number;
    diffDeleted?: number;
    diffRetained?: number;

    creatorId: string;
    timestampISO: string; // 前端传递
    attr: ContentAtomAttr;
    derivedFromId: hash | null;// 溯源指针，永远只能指向真实的 Hash，不能指向 DraftId, 在 Workspace 中不能改变.

    frontMeta: Meta;
    backMeta: Meta; // 包含 createdAt, 等
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

// 学科数据类型
export interface DisciplineData {
    name: string; // unique key (e.g. '流体力学')
    abbr: string; // e.g. '流体' (1-3 chars)
    color: string; // hex
    hue: number; // for graph
}

// 前端渲染用数据层. 接受并转换为 Workspace

export interface IPopulatedEdition extends Omit<IEdition, 'coreAtomIds' | 'docAtomIds' | 'tagsAtomIds' | 'refsAtomIds' | 'relsAtomIds'> {
    coreAtoms: Omit<IContentAtom, 'backMeta'>[];
    docAtoms: Omit<IContentAtom, 'backMeta'>[];
    tagsAtoms: Omit<IContentAtom, 'backMeta'>[];
    refsAtoms: Omit<IContentAtom, 'backMeta'>[];
    relsAtoms: Omit<IContentAtom, 'backMeta'>[];

    // 动态计算的 Edition 级别汇总信息
    editionAttr?: ContentAtomAttr;
    editionDiffAdded?: number;
    editionDiffDeleted?: number;
    editionDiffRetained?: number;
} // 后端返回的完整填充 Edition, 用于渲染, 避免过多请求. 为了安全, 剔除后端 meta.

export interface IConceptView {
    id: string;
    name: string;
    topic: string;
    disciplines: string[];
    // 可能还需要包含一点摘要用于列表渲染
}

export interface ITopicView {
    topic: string;
    ConceptViews: Record<string, IConceptView>
}

// Draft/Workspace 类型定义

export type AtomDraft = Omit<IContentAtom, 'id' | 'backMeta' | 'contentHash' | 'contentSimHash' | 'timestampISO' | 'attr' | 'diffAdded' | 'diffDeleted' | 'diffRetained'> & {
    id: DraftId; // 允许是 256 位随机串或旧 hash
    isDirty: boolean; // 是否发生修改
    diffAdded?: number;
    diffDeleted?: number;
    diffRetained?: number;
    attr?: ContentAtomAttr; // 保证在加载已有 Edition 时能在渲染中使用后端结算后的 attr
};

export interface IWorkspaceDraft {
    conceptId: hash;
    baseEditionId: hash | null; // null for brand new concept

    conceptName: string;
    conceptTopic: string;
    conceptDisciplines: string[];

    lastEdited: string;
    cmSessionId: string | null;

    draftAtomLists: Record<ContentAtomField, Array<DraftId>>;

    draftAtomsData: Record<DraftId, AtomDraft>; // 本地草稿编辑时的 Atom 数据. key 是 Atom ID, value 是 Atom 数据.
}

// 前端提交的请求格式.

export interface AtomSubmission {
    contentPayload: string; // 即 atom.content
    field: ContentAtomField;
    type: ContentAtomType;
    derivedFromId: hash | null; // 一定要是真实的 hash 或者 null
    frontMeta: Meta;
    blobs?: Record<string, Blob | ArrayBuffer>;
}

export interface EditionSubmission {
    conceptId: hash | null;  //若为新建 Concept，可传入空字符串或 null
    conceptName: string;
    conceptTopic: string;
    conceptDisciplines: string[];

    baseEditionId: hash | null; // null 代表新建, 否则为编辑已有 Edition
    saveType: 'autosave'| 'save' | 'publish'; 
    coreAtoms: AtomSubmission[];
    docAtoms: AtomSubmission[];
    tagsAtoms: AtomSubmission[];
    refsAtoms: AtomSubmission[];
    relsAtoms: AtomSubmission[];
}
