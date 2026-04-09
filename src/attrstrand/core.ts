import type {
    IConceptRoot, IEdition, IContentAtom, ContentAtomField, ContentAtomType, ContentAtomAttr,
    EditionSubmission, AtomSubmission, hash, IPopulatedEdition, Meta
} from './types.ts';
import { storage } from './storage.ts';
import { simhash, generateConceptHash, generateAtomHash, generateEditionHash, generateContentHash, calculateDiffStats, generateBinaryHash } from './utils.ts';

export class AttrStrandCore {

    // 基于相似度的版权分配计算 (保留作搜索匹配用)
    public calculateSimilarity(hash1: string, hash2: string): number {
        const h1 = parseInt(hash1, 16);
        const h2 = parseInt(hash2, 16);
        if (Number.isNaN(h1) || Number.isNaN(h2)) {
            return 0;
        }
        let xor = h1 ^ h2;
        let distance = 0;
        for(let i=0; i<32; i++) {
            if ((xor >> i) & 1) distance++;
        }
        const sim = 1 - (distance / 32);
        return Math.max(0, sim);
    }

    // 全库 Atom 查询
    async queryAtoms(options: {
        field?: ContentAtomField;
        type?: ContentAtomType;
        creatorId?: string;
        contentHash?: string;
        contentSimHash?: string;
        contains?: string;
    }): Promise<IContentAtom[]> {
        // ⚡ Bolt Optimization: Delegate to storage layer to leverage IndexedDB indices
        // instead of loading all atoms into memory and filtering sequentially.
        return storage.queryAtoms(options);
    }

    async findExactContentMatch(content: string, field?: ContentAtomField, type?: ContentAtomType): Promise<IContentAtom | null> {
        const targetHash = await generateContentHash(content);
        const candidates = await storage.findAtomsByContentHash(targetHash);
        const matched = candidates.find(atom => {
            if (field && atom.field !== field) return false;
            if (type && atom.type !== type) return false;
            return true;
        });
        return matched || null;
    }

    async findBestSimhashMatch(targetSimHash: string, excludeId?: string, minSimilarity = 0): Promise<{ id: string, sim: number } | null> {
        const allAtoms = await storage.getAllAtoms();
        let bestMatch: { id: string, sim: number } | null = null;

        for (const atom of allAtoms) {
            if (atom.id === excludeId) continue;
            if (!atom.contentSimHash) continue;

            const sim = this.calculateSimilarity(targetSimHash, atom.contentSimHash);
            if (sim < minSimilarity) continue;
            if (!bestMatch || sim > bestMatch.sim) {
                bestMatch = { id: atom.id, sim };
            }
        }

        return bestMatch;
    }

    // 基于 diff 的版权分配计算
    private calculateAttribution(
        prevAttr: ContentAtomAttr,
        retainedWeight: number,
        creatorId: string
    ): ContentAtomAttr {
        const newAttr: ContentAtomAttr = {};
        for (const [author, share] of Object.entries(prevAttr)) {
            newAttr[author] = share * retainedWeight;
        }
        const addedWeight = 1 - retainedWeight;
        newAttr[creatorId] = (newAttr[creatorId] || 0) + addedWeight;

        let total = Object.values(newAttr).reduce((a, b) => a + b, 0);
        if (total === 0) {
             newAttr[creatorId] = 1;
             total = 1;
        }
        for (const author of Object.keys(newAttr)) {
            newAttr[author] /= total;
        }
        return newAttr;
    }

    // 提供的 api

    async getPopulatedEdition(editionId: hash, currentUserId?: string): Promise<IPopulatedEdition | null> {
        const edition = await storage.getEdition(editionId);
        if (!edition) return null;

        const populate = async (ids: string[]) => {
            const atoms = await storage.getAtoms(ids);
            return atoms.map(a => {
                const { backMeta, ...rest } = a;// 剔除 backmeta
                return rest;
            });
        };

        // ⚡ Bolt: Optimize sequential data fetching by using Promise.all to fetch all atom types concurrently
        const [coreAtoms, docAtoms, tagsAtoms, refsAtoms, relsAtoms] = await Promise.all([
            populate(edition.coreAtomIds),
            populate(edition.docAtomIds),
            populate(edition.tagsAtomIds),
            populate(edition.refsAtomIds),
            populate(edition.relsAtomIds)
        ]);

        const allAtoms = [...coreAtoms, ...docAtoms, ...tagsAtoms, ...refsAtoms, ...relsAtoms];

        let editionDiffAdded = 0;
        let editionDiffDeleted = 0;
        let editionDiffRetained = 0;
        const editionAttr: ContentAtomAttr = {};

        for (const atom of allAtoms) {
            editionDiffAdded += atom.diffAdded || 0;
            editionDiffDeleted += atom.diffDeleted || 0;
            editionDiffRetained += atom.diffRetained || 0;

            const atomTotalWeight = (atom.diffAdded || 0) + (atom.diffRetained || 0);
            if (atomTotalWeight > 0 && atom.attr) {
                for (const [author, share] of Object.entries(atom.attr)) {
                    editionAttr[author] = (editionAttr[author] || 0) + (share * atomTotalWeight);
                }
            }
        }

        const totalEditionWeight = editionDiffAdded + editionDiffRetained;
        if (totalEditionWeight > 0) {
            for (const author of Object.keys(editionAttr)) {
                editionAttr[author] /= totalEditionWeight;
            }
        } else if (allAtoms.length > 0 && edition.creator) {
            editionAttr[edition.creator] = 1;
        }

        // 过滤 frontMeta.flags
        if (edition.frontMeta && Array.isArray(edition.frontMeta.flags)) {
            const publicFlags = ['star', 'upvote', 'downvote'];
            edition.frontMeta.flags = edition.frontMeta.flags.filter((flag: import('./types').IEditionFlag) => {
                if (publicFlags.includes(flag.type)) return true;
                return flag.userId === currentUserId;
            });
        }

        return {
            ...edition,
            coreAtoms,
            docAtoms,
            tagsAtoms,
            refsAtoms,
            relsAtoms,
            editionAttr,
            editionDiffAdded,
            editionDiffDeleted,
            editionDiffRetained
        };
    }

    async toggleEditionFlag(editionId: hash, userId: string, flagType: import('./types').EditionFlagType): Promise<{ success: boolean, flags?: import('./types').IEditionFlag[], message?: string }> {
        try {
            const edition = await storage.getEdition(editionId);
            if (!edition) {
                return { success: false, message: 'Edition not found' };
            }

            if (!edition.frontMeta) {
                edition.frontMeta = {};
            }

            let flags: import('./types').IEditionFlag[] = Array.isArray(edition.frontMeta.flags) ? edition.frontMeta.flags : [];

            // 检查当前用户是否已经标记过该类型
            const existingIndex = flags.findIndex(f => f.userId === userId && f.type === flagType);

            if (existingIndex >= 0) {
                // 如果已存在，则取消标记
                flags.splice(existingIndex, 1);
            } else {
                // 如果不存在，则添加标记
                flags.push({
                    userId,
                    type: flagType,
                    timestampISO: new Date().toISOString()
                });
            }

            await storage.updateEditionFlags(editionId, flags);

            const publicFlags = ['star', 'upvote', 'downvote'];
            const filteredFlags = flags.filter((flag: import('./types').IEditionFlag) => {
                if (publicFlags.includes(flag.type)) return true;
                return flag.userId === userId;
            });

            return { success: true, flags: filteredFlags, message: 'Flag updated successfully' };
        } catch (error) {
            console.error('Failed to toggle edition flag:', error);
            return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    async submitEdition(submission: EditionSubmission, creatorId: string, timestampISO: string): Promise<{ success: boolean, edition?: IEdition, message?: string }> {
        try {
            let conceptId = submission.conceptId;
            let isNewConcept = false;
            let concept: IConceptRoot | null = null;
            let conceptUpdated = false;

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
                conceptUpdated = true;
            } else if (concept) {
                // 检查 concept meta 更新. 后续公共的 meta 将加入审核, 或者绑定到 edition.
                if (concept.name !== submission.conceptName) { concept.name = submission.conceptName; conceptUpdated = true; }
                if (concept.topic !== submission.conceptTopic) { concept.topic = submission.conceptTopic; conceptUpdated = true; }
                if (JSON.stringify(concept.disciplines) !== JSON.stringify(submission.conceptDisciplines)) {
                    concept.disciplines = submission.conceptDisciplines;
                    conceptUpdated = true;
                }
            }

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

            const atomsToSave: IContentAtom[] = [];

            const processAtoms = async (field: ContentAtomField, atoms: AtomSubmission[]) => {
                const atomIds: hash[] = [];
                for (const sub of atoms) {
                    let contentHash: string;
                    if (sub.type === 'bin' && sub.blobs) {
                        contentHash = await generateBinaryHash(sub.contentPayload, sub.blobs);
                    } else {
                        contentHash = await generateContentHash(sub.contentPayload);
                    }
                    const contentSimHash = sub.type === 'bin' ? null : await simhash(sub.contentPayload);

                    let prevAtom: IContentAtom | null = null;
                    if (sub.derivedFromId) {
                        prevAtom = await storage.getAtom(sub.derivedFromId);
                    }

                    // 检查内容更新.
                    if (prevAtom && prevAtom.contentHash === contentHash) {
                        atomIds.push(prevAtom.id);
                        continue;
                    }
                    // 基于 diff 的变动记录
                    let attr: ContentAtomAttr = { [creatorId]: 1 };
                    let diffAdded: number | undefined;
                    let diffDeleted: number | undefined;
                    let diffRetained: number | undefined;

                    if (prevAtom) {
                        const diffStats = calculateDiffStats(prevAtom.content, sub.contentPayload);
                        diffAdded = diffStats.added;
                        diffDeleted = diffStats.deleted;
                        diffRetained = diffStats.retained;

                        const totalWeight = diffAdded + diffRetained;
                        const retainedWeight = totalWeight > 0 ? diffRetained / totalWeight : 0;

                        attr = this.calculateAttribution(prevAtom.attr, retainedWeight, creatorId);
                    } else {
                        diffAdded = sub.contentPayload.length;
                        diffDeleted = 0;
                        diffRetained = 0;
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
                            blobs: sub.blobs,
                            contentHash,
                            contentSimHash,
                            diffAdded,
                            diffDeleted,
                            diffRetained,
                            creatorId,
                            timestampISO,
                            attr,
                            derivedFromId: sub.derivedFromId || null,
                            frontMeta: sub.frontMeta || {},
                            backMeta: { createdAt: timestampISO }
                        };
                        atomsToSave.push(newAtom);
                        atomIds.push(atomId);
                    }
                }
                return atomIds;
            };

            // ⚡ Bolt: Optimize sequential data processing by using Promise.all to process all atom types concurrently
            const [coreAtomIds, docAtomIds, tagsAtomIds, refsAtomIds, relsAtomIds] = await Promise.all([
                processAtoms('core', submission.coreAtoms),
                processAtoms('doc', submission.docAtoms),
                processAtoms('tags', submission.tagsAtoms),
                processAtoms('refs', submission.refsAtoms),
                processAtoms('rels', submission.relsAtoms)
            ]);

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
                        conceptUpdated = true;
                    }
                }

                // If only concept was updated (e.g. metadata or heads), we should save it
                if (conceptUpdated && concept) {
                     await storage.submitEditionTransaction({ concept, edition: existingEdition, atoms: [] });
                }

                return { success: true, edition: existingEdition, message: "已存在完全相同的版本，无需重复提交。" };
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

            // 更新 Concept Heads
            if (submission.saveType !== 'autosave') {
                if (concept) {
                    const newHeads = { ...concept.currentHeads };
                    if (!isFork && submission.baseEditionId && newHeads[submission.baseEditionId]) {
                        delete newHeads[submission.baseEditionId];
                    }
                    newHeads[editionId] = Date.now();
                    concept.currentHeads = newHeads;
                    conceptUpdated = true;
                }
            }

            // Write all changes atomically
            await storage.submitEditionTransaction({
                concept: conceptUpdated && concept ? concept : undefined,
                edition,
                atoms: atomsToSave
            });

            return { success: true, edition, message: "保存成功" };
        } catch (error) {
            console.error("Failed to submit edition:", error);
            return { success: false, message: error instanceof Error ? error.message : "保存失败，发生未知错误" };
        }
    }

    // 备用函数: 接受文件 api 和其他必要的 atom 元数据，将二进制流存入 atom，type 为 'bin'
    async saveBinaryAtom(
        blobs: Record<string, Blob | ArrayBuffer>,
        fileName: string,
        field: ContentAtomField,
        creatorId: string,
        timestampISO: string,
        frontMeta: Meta = {}
    ): Promise<IContentAtom> {
        // 仅根据文件内容计算 hash
        const contentPayload = fileName; // content 仅保存文件名
        const contentHash = await generateBinaryHash(contentPayload, blobs);
        const contentSimHash = null;

        const attr: ContentAtomAttr = { [creatorId]: 1 };

        const atomId = await generateAtomHash(
            field,
            'bin',
            contentHash,
            creatorId,
            null,
            attr
        );

        const newAtom: IContentAtom = {
            id: atomId,
            field,
            type: 'bin',
            content: contentPayload,
            blobs: blobs,
            contentHash,
            contentSimHash,
            diffAdded: 0,
            diffDeleted: 0,
            diffRetained: 0,
            creatorId,
            timestampISO,
            attr,
            derivedFromId: null,
            frontMeta,
            backMeta: { createdAt: timestampISO }
        };

        await storage.saveAtom(newAtom);

        return newAtom;
    }
}

export const core = new AttrStrandCore();
