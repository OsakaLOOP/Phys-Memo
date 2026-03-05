type hash =  string; // SHA256

export type ContentAtomField = 'doc' | 'core' | 'tags' | 'refs' | 'rels' // 所有概念页展示的字段内容均 json 格式化, 作为对应域的 Atom 存储.
export type ContentAtomType = 'latex' | 'markdown' | 'inline' | 'sources' // inline -> tags/refs, sources -> uploaded md/pdf file links.
export type ContentAtomAttr = Record<string, number> // {"author1": prop1, ...}, 用于计算版权分配
export type Meta = Record<string, string | number | boolean | null> // 其他字段, 只用于编辑器渲染/ 后端 worker. 否则应当定义在顶层. 前后端 meta 必须分离, 后者api返回时剔除.


export interface IContentAtom {
    id: hash
    field: ContentAtomField;
    type: ContentAtomType;

    contentJson: string;
    contentHash: hash; // 纯文本部分的 hash, 查重
    contentSimHash: hash | null; // 为相似度查重预留
    
    creatorId: string;
    createdAt: string;
    attr: ContentAtomAttr;
    derivedFromId: string | null;

    frontMeta: Meta;
    backMeta: Meta;
}



export interface IEditionWorkspace {
    conceptId: hash;
    editionId: hash;
}

export interface IConceptRoot {
    id: hash;
    name: string;
    topic: string;
    disciplines: string[];

    creatorId: string;
    createdAt: string;
    currentHeads: Record<hash, number>; // 每个最新 Edition 对应 sort.
    
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
    createdAt: string;
    parentEditionId: hash | null; // null 指向 Concept root

    frontMeta: Meta;
    backMeta: Meta; // 同样预留

}

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