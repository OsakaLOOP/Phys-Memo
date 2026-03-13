import type {
    IConceptRoot, IEdition, IContentAtom, ContentAtomField, ContentAtomAttr,
    EditionSubmission, AtomSubmission, hash, IPopulatedEdition
} from './types.ts';
import { storage } from './storage.ts';
import { simhash, generateConceptHash, generateAtomHash, generateEditionHash, generateContentHash } from './utils.ts';

export class AttrStrandCore {

    // 基于相似度的版权分配计算
    private calculateSimilarity(hash1: string, hash2: string): number {
        const h1 = parseInt(hash1, 16);
        const h2 = parseInt(hash2, 16);
        let xor = h1 ^ h2;
        let distance = 0;
        for(let i=0; i<32; i++) {
            if ((xor >> i) & 1) distance++;
        }
        const sim = 1 - (distance / 32);
        return Math.max(0, sim);
    }
    // 后期将记录版本的编辑次数距离, 参与计算.

    private calculateAttribution(
        prevAttr: ContentAtomAttr,
        similarity: number,
        creatorId: string
    ): ContentAtomAttr {
        const newAttr: ContentAtomAttr = {};
        for (const [author, share] of Object.entries(prevAttr)) {
            newAttr[author] = share * similarity;
        }
        const newShare = 1 - similarity;
        newAttr[creatorId] = (newAttr[creatorId] || 0) + newShare;

        let total = Object.values(newAttr).reduce((a, b) => a + b, 0);
        if (total === 0) {
             newAttr[creatorId] = 1;
             total = 1;
        }
        for (const author of Object.keys(newAttr)) {
            newAttr[author] /= total;
        }
        return newAttr;
    }// 这里不符合前端的总比例1.1, 需要修改.

    // 提供的 api

    async getPopulatedEdition(editionId: hash): Promise<IPopulatedEdition | null> {
        console.log(`[API Call] core.getPopulatedEdition: editionId=${editionId}`);
        const edition = await storage.getEdition(editionId);
        if (!edition) return null;

        const populate = async (ids: string[]) => {
            const atoms = await storage.getAtoms(ids);
            return atoms.map(a => {
                const { backMeta, ...rest } = a;// 剔除 backmeta
                return rest;
            });
        };

        return {
            ...edition,
            coreAtoms: await populate(edition.coreAtomIds),
            docAtoms: await populate(edition.docAtomIds),
            tagsAtoms: await populate(edition.tagsAtomIds),
            refsAtoms: await populate(edition.refsAtomIds),
            relsAtoms: await populate(edition.relsAtomIds),
        };
    }

    async submitEdition(submission: EditionSubmission, creatorId: string, timestampISO: string): Promise<IEdition> {
        console.log(`[API Call] core.submitEdition: conceptId=${submission.conceptId}, creatorId=${creatorId}`, submission);
        // Concept Handling
        let conceptId = submission.conceptId;
        let isNewConcept = false;
        let concept: IConceptRoot | null = null;

        // 新建 Concept 的处理.
        if (!conceptId) {
            conceptId = await generateConceptHash(submission.conceptName, creatorId, timestampISO);// hash 创建
            isNewConcept = true;
        } else {
            concept = await storage.getConcept(conceptId);
            if (!concept) {
                isNewConcept = true;
            }
        }

        if (isNewConcept) {
            concept = {
                id: conceptId,
                name: submission.conceptName,
                topic: submission.conceptTopic,
                disciplines: submission.conceptDisciplines,
                creatorId,
                timestampISO,
                currentHeads: {},
                frontMeta: {},
                backMeta: { createdAt: timestampISO }
            };
            await storage.saveConcept(concept);
        } else {
            // 检查 concept meta 更新. 后续公共的 meta 将加入审核, 或者绑定到 edition.
            const concept = await storage.getConcept(conceptId);
            if (concept) {
                let updated = false;
                if (concept.name !== submission.conceptName) { concept.name = submission.conceptName; updated = true; }
                if (concept.topic !== submission.conceptTopic) { concept.topic = submission.conceptTopic; updated = true; }
                // Array compare
                if (JSON.stringify(concept.disciplines) !== JSON.stringify(submission.conceptDisciplines)) {
                    concept.disciplines = submission.conceptDisciplines;
                    updated = true;
                }
                if (updated) {
                    await storage.saveConcept(concept);
                }
            }
        }// 完成concept入库.

        // 获取 baseEdition 并计算 isFork
        let isFork = false;
        let baseEdition: IEdition | null = null;
        if (submission.baseEditionId) {
            baseEdition = await storage.getEdition(submission.baseEditionId);
            if (baseEdition) {
                if (baseEdition.creator !== creatorId) {
                    isFork = true;
                } else {
                    // 相同用户，默认非fork，除非该节点已经有后续的分支（即baseEdition不在currentHeads中）
                    isFork = !concept?.currentHeads[submission.baseEditionId];
                }
            }
        }

        const processAtoms = async (field: ContentAtomField, atoms: AtomSubmission[]) => {
            const atomIds: hash[] = [];
            for (const sub of atoms) {
                const contentHash = await generateContentHash(sub.contentPayload);
                const contentSimHash = await simhash(sub.contentPayload);

                let prevAtom: IContentAtom | null = null;
                if (sub.derivedFromId) {
                    prevAtom = await storage.getAtom(sub.derivedFromId);
                }

                // 检查内容更新.
                if (prevAtom && prevAtom.contentHash === contentHash) {
                    atomIds.push(prevAtom.id);
                    continue;
                }

                let attr: ContentAtomAttr = { [creatorId]: 1 };
                if (prevAtom) {
                    const similarity = (prevAtom.contentSimHash && contentSimHash)
                        ? this.calculateSimilarity(prevAtom.contentSimHash, contentSimHash)
                        : 0;
                    attr = this.calculateAttribution(prevAtom.attr, similarity, creatorId);
                }

                const atomId = await generateAtomHash(
                    field,
                    sub.type,
                    contentHash,
                    creatorId,
                    sub.derivedFromId || null,
                    attr
                );

                // 检查是否与历史 atom 完全一致.
                const existingAtom = await storage.getAtom(atomId);
                if (existingAtom) {
                    atomIds.push(existingAtom.id);
                } else {
                    const newAtom: IContentAtom = {
                        id: atomId,
                        field,
                        type: sub.type,
                        content: sub.contentPayload,
                        contentHash,
                        contentSimHash,
                        creatorId,
                        timestampISO,
                        attr,
                        derivedFromId: sub.derivedFromId || null,
                        frontMeta: sub.frontMeta || {},
                        backMeta: { createdAt: timestampISO }
                    };
                    await storage.saveAtom(newAtom);
                    atomIds.push(atomId);
                }
            }
            return atomIds;
        };

        const coreAtomIds = await processAtoms('core', submission.coreAtoms);
        const docAtomIds = await processAtoms('doc', submission.docAtoms);
        const tagsAtomIds = await processAtoms('tags', submission.tagsAtoms);
        const refsAtomIds = await processAtoms('refs', submission.refsAtoms);
        const relsAtomIds = await processAtoms('rels', submission.relsAtoms);

        const editionId = await generateEditionHash(
            conceptId,
            submission.baseEditionId,
            coreAtomIds,
            docAtomIds,
            tagsAtomIds,
            refsAtomIds,
            relsAtomIds,
            creatorId,
            timestampISO
        );

        // 检查内容重复, 避免提交的重复. 后续前端也要判断是否禁用按钮/提交.
        const existingEdition = await storage.getEdition(editionId);
        if (existingEdition) {
            // 排除 autosave 更新 Heads, 相反 save 则需要确保是否先前为 autosave 情形的 head 更新.
            if (submission.saveType !== 'autosave') {
                if (concept && !concept.currentHeads[editionId]) {
                    concept.currentHeads[editionId] = Date.now();
                    
                    if (!isFork && submission.baseEditionId && concept.currentHeads[submission.baseEditionId]) {
                        delete concept.currentHeads[submission.baseEditionId];
                    }
                    await storage.saveConcept(concept);
                }
            }
            return existingEdition;// 已存在完全相同的版本, 直接返回.
        }
        
        const edition: IEdition = {
            id: editionId,
            conceptId,
            saveType: submission.saveType,
            coreAtomIds,
            docAtomIds,
            tagsAtomIds,
            refsAtomIds,
            relsAtomIds,
            creator: creatorId,
            timestampISO,
            parentEditionId: submission.baseEditionId,
            frontMeta: {},
            backMeta: { createdAt: timestampISO }// 记录后端生成时间
        };

        await storage.saveEdition(edition);

        // 更新 Concept Heads
        if (submission.saveType !== 'autosave') {
             if (concept) {
                 const newHeads = { ...concept.currentHeads };
                 if (!isFork && submission.baseEditionId && newHeads[submission.baseEditionId]) {
                     delete newHeads[submission.baseEditionId];
                 }
                 newHeads[editionId] = Date.now();
                 concept.currentHeads = newHeads;
                 await storage.saveConcept(concept);
             }
        }

        return edition;
    }
}

export const core = new AttrStrandCore();
