"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMobileCategories = listMobileCategories;
exports.listCategories = listCategories;
exports.getCategoryById = getCategoryById;
exports.getMobileSubcategories = getMobileSubcategories;
exports.getCategoryTree = getCategoryTree;
exports.getCategoryTreeAdmin = getCategoryTreeAdmin;
exports.createCategoryNode = createCategoryNode;
exports.updateCategoryNode = updateCategoryNode;
exports.deleteCategoryNode = deleteCategoryNode;
exports.getCategoryBusinessCards = getCategoryBusinessCards;
const prisma_1 = __importDefault(require("../utils/prisma"));
const params_1 = require("../utils/params");
const parsedMobileCategoryCacheTtl = Number(process.env.MOBILE_CATEGORY_CACHE_TTL_MS ?? '60000');
const MOBILE_CATEGORY_CACHE_TTL_MS = Number.isFinite(parsedMobileCategoryCacheTtl) && parsedMobileCategoryCacheTtl > 0
    ? Math.floor(parsedMobileCategoryCacheTtl)
    : 0;
const parsedCategoryTreeCacheTtl = Number(process.env.CATEGORY_TREE_CACHE_TTL_MS ?? '60000');
const CATEGORY_TREE_CACHE_TTL_MS = Number.isFinite(parsedCategoryTreeCacheTtl) && parsedCategoryTreeCacheTtl > 0
    ? Math.floor(parsedCategoryTreeCacheTtl)
    : 0;
const parsedCategoryChildrenCacheTtl = Number(process.env.CATEGORY_CHILDREN_CACHE_TTL_MS ?? '60000');
const CATEGORY_CHILDREN_CACHE_TTL_MS = Number.isFinite(parsedCategoryChildrenCacheTtl) && parsedCategoryChildrenCacheTtl > 0
    ? Math.floor(parsedCategoryChildrenCacheTtl)
    : 0;
let cachedMobileSummary = null;
let cachedCategoryTree = null;
let cachedAdminCategoryTree = null;
const cachedCategoryChildren = new Map();
const parseFreshQuery = (value) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
};
const normalizeStringArray = (value) => {
    if (!Array.isArray(value))
        return [];
    return value
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
};
const buildCategoryTree = (rows) => {
    const map = new Map();
    for (const row of rows) {
        map.set(row.id, {
            id: row.id,
            name: row.name,
            icon: row.icon,
            level: row.level ?? 0,
            sort_order: row.sort_order ?? 0,
            is_active: row.is_active ?? true,
            children: [],
        });
    }
    const roots = [];
    for (const row of rows) {
        const node = map.get(row.id);
        if (!node)
            continue;
        if (row.parent_id && map.has(row.parent_id)) {
            map.get(row.parent_id).children.push(node);
        }
        else {
            roots.push(node);
        }
    }
    const sortNodes = (nodes) => {
        nodes.sort((a, b) => {
            if (a.sort_order !== b.sort_order)
                return a.sort_order - b.sort_order;
            return a.name.localeCompare(b.name);
        });
        nodes.forEach((n) => sortNodes(n.children));
    };
    sortNodes(roots);
    return roots;
};
const getMobileCategorySummary = async (options) => {
    const now = Date.now();
    const bypassCache = Boolean(options?.bypassCache) || MOBILE_CATEGORY_CACHE_TTL_MS <= 0;
    if (!bypassCache && cachedMobileSummary && cachedMobileSummary.expiresAt > now) {
        return cachedMobileSummary.data;
    }
    const categories = await prisma_1.default.category.findMany({
        where: { parent_id: null, is_active: true },
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        select: {
            id: true,
            name: true,
            icon: true,
            sort_order: true,
        },
    });
    const counts = categories.length > 0
        ? await prisma_1.default.category.groupBy({
            by: ['parent_id'],
            _count: { _all: true },
            where: { parent_id: { in: categories.map((c) => c.id) }, is_active: true },
        })
        : [];
    const countMap = new Map();
    counts.forEach((row) => {
        if (row.parent_id !== null)
            countMap.set(row.parent_id, row._count._all);
    });
    const summary = categories.map((category) => ({
        id: category.id,
        name: category.name.trim(),
        icon: category.icon ?? null,
        sort_order: category.sort_order ?? 0,
        child_count: countMap.get(category.id) ?? 0,
    }));
    if (!bypassCache && MOBILE_CATEGORY_CACHE_TTL_MS > 0) {
        cachedMobileSummary = {
            data: summary,
            expiresAt: now + MOBILE_CATEGORY_CACHE_TTL_MS,
        };
    }
    else {
        cachedMobileSummary = null;
    }
    return summary;
};
const getCategoryTreeCached = async (options) => {
    const includeInactive = Boolean(options?.includeInactive);
    const now = Date.now();
    const cacheRef = includeInactive ? cachedAdminCategoryTree : cachedCategoryTree;
    const bypassCache = Boolean(options?.bypassCache) || CATEGORY_TREE_CACHE_TTL_MS <= 0;
    if (!bypassCache && cacheRef && cacheRef.expiresAt > now) {
        return cacheRef.data;
    }
    const rows = await prisma_1.default.category.findMany({
        where: includeInactive ? undefined : { is_active: true },
        select: {
            id: true,
            name: true,
            icon: true,
            parent_id: true,
            level: true,
            sort_order: true,
            is_active: true,
        },
    });
    const tree = buildCategoryTree(rows);
    if (!bypassCache && CATEGORY_TREE_CACHE_TTL_MS > 0) {
        const payload = { data: tree, expiresAt: now + CATEGORY_TREE_CACHE_TTL_MS };
        if (includeInactive)
            cachedAdminCategoryTree = payload;
        else
            cachedCategoryTree = payload;
    }
    else {
        if (includeInactive)
            cachedAdminCategoryTree = null;
        else
            cachedCategoryTree = null;
    }
    return tree;
};
const getMobileSubcategoriesCached = async (key, factory) => {
    const now = Date.now();
    const cached = cachedCategoryChildren.get(key);
    if (cached && cached.expiresAt > now)
        return cached.data;
    const data = await factory();
    if (CATEGORY_CHILDREN_CACHE_TTL_MS > 0) {
        cachedCategoryChildren.set(key, { data, expiresAt: now + CATEGORY_CHILDREN_CACHE_TTL_MS });
    }
    else {
        cachedCategoryChildren.delete(key);
    }
    return data;
};
async function listMobileCategories(req, res) {
    const bypassCache = parseFreshQuery(req.query.fresh);
    const data = await getMobileCategorySummary({ bypassCache });
    res.json({ data });
}
async function listCategories(_req, res) {
    const categories = await prisma_1.default.category.findMany({
        where: { is_active: true },
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        select: {
            id: true,
            name: true,
            icon: true,
            parent_id: true,
            level: true,
            sort_order: true,
            is_active: true,
        },
    });
    res.json({ data: categories });
}
async function getCategoryById(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid category id' });
        return;
    }
    const category = await prisma_1.default.category.findUnique({
        where: { id },
        select: {
            id: true,
            name: true,
            icon: true,
            parent_id: true,
            level: true,
            sort_order: true,
            is_active: true,
            subcategories: true,
        },
    });
    if (!category) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json({
        data: {
            ...category,
            name: category.name.trim(),
            subcategories: normalizeStringArray(category.subcategories),
        },
    });
}
async function getMobileSubcategories(req, res) {
    const id = (0, params_1.paramInt)(req.params.categoryId);
    if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid category id' });
        return;
    }
    const page = Math.max((0, params_1.queryInt)(req.query.page, 1), 1);
    const limitRaw = (0, params_1.queryInt)(req.query.limit, 50);
    const limit = Math.min(Math.max(limitRaw, 1), 200);
    const search = (0, params_1.queryStr)(req.query.search)?.trim() ?? '';
    const searchFilter = search.length > 0 ? search.toLowerCase() : '';
    const category = await prisma_1.default.category.findUnique({
        where: { id },
        select: { id: true, name: true, subcategories: true },
    });
    if (!category) {
        res.status(404).json({ error: 'Category not found' });
        return;
    }
    const cacheKey = `${id}:${searchFilter}:${page}:${limit}`;
    const data = await getMobileSubcategoriesCached(cacheKey, async () => {
        const where = { parent_id: id, is_active: true };
        if (searchFilter) {
            where.name = { contains: searchFilter, mode: 'insensitive' };
        }
        const [children, totalChildren] = await Promise.all([
            prisma_1.default.category.findMany({
                where,
                select: { name: true },
                orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma_1.default.category.count({ where }),
        ]);
        if (totalChildren > 0) {
            return children.map((child) => child.name.trim()).filter(Boolean);
        }
        const legacy = normalizeStringArray(category.subcategories);
        const filtered = searchFilter
            ? legacy.filter((s) => s.toLowerCase().includes(searchFilter))
            : legacy;
        const start = (page - 1) * limit;
        return filtered.slice(start, start + limit);
    });
    let total = 0;
    let source = 'nodes';
    const where = { parent_id: id, is_active: true };
    if (searchFilter)
        where.name = { contains: searchFilter, mode: 'insensitive' };
    total = await prisma_1.default.category.count({ where });
    if (total === 0) {
        const legacy = normalizeStringArray(category.subcategories);
        const filtered = searchFilter
            ? legacy.filter((s) => s.toLowerCase().includes(searchFilter))
            : legacy;
        total = filtered.length;
        source = 'legacy';
    }
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const hasMore = page * limit < total;
    res.json({
        data: {
            categoryId: category.id,
            categoryName: category.name.trim(),
            subcategories: data,
        },
        meta: {
            page,
            limit,
            total,
            totalPages,
            hasMore,
            search: searchFilter || null,
            source,
        },
    });
}
async function getCategoryTree(req, res) {
    const bypassCache = parseFreshQuery(req.query.fresh);
    const tree = await getCategoryTreeCached({ includeInactive: false, bypassCache });
    res.json({ data: tree });
}
async function getCategoryTreeAdmin(req, res) {
    const bypassCache = parseFreshQuery(req.query.fresh);
    const tree = await getCategoryTreeCached({ includeInactive: true, bypassCache });
    res.json({ data: tree });
}
const ensureParentExists = async (parentId) => {
    const parent = await prisma_1.default.category.findUnique({ where: { id: parentId } });
    if (!parent)
        return null;
    return parent;
};
async function createCategoryNode(req, res) {
    const nameRaw = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!nameRaw) {
        res.status(400).json({ error: 'Category name is required' });
        return;
    }
    const parentId = typeof req.body?.parent_id === 'number' ? req.body.parent_id : undefined;
    const icon = typeof req.body?.icon === 'string' ? req.body.icon : null;
    const isActive = req.body?.is_active === false ? false : true;
    const explicitOrder = typeof req.body?.sort_order === 'number' ? req.body.sort_order : undefined;
    let level = 0;
    let resolvedParentId = null;
    if (parentId) {
        const parent = await ensureParentExists(parentId);
        if (!parent) {
            res.status(404).json({ error: 'Parent category not found' });
            return;
        }
        resolvedParentId = parent.id;
        level = (parent.level ?? 0) + 1;
    }
    const duplicate = await prisma_1.default.category.findFirst({
        where: {
            parent_id: resolvedParentId,
            name: { equals: nameRaw, mode: 'insensitive' },
        },
        select: { id: true },
    });
    if (duplicate) {
        res.status(409).json({ error: 'Category already exists' });
        return;
    }
    let sortOrder = explicitOrder ?? 0;
    if (explicitOrder === undefined) {
        const max = await prisma_1.default.category.findFirst({
            where: { parent_id: resolvedParentId },
            orderBy: { sort_order: 'desc' },
            select: { sort_order: true },
        });
        sortOrder = (max?.sort_order ?? 0) + 1;
    }
    const created = await prisma_1.default.category.create({
        data: {
            name: nameRaw,
            icon,
            parent_id: resolvedParentId,
            level,
            is_active: isActive,
            sort_order: sortOrder,
        },
        select: {
            id: true,
            name: true,
            icon: true,
            parent_id: true,
            level: true,
            sort_order: true,
            is_active: true,
        },
    });
    cachedMobileSummary = null;
    cachedCategoryTree = null;
    cachedAdminCategoryTree = null;
    cachedCategoryChildren.clear();
    res.status(201).json({ data: created });
}
const updateDescendantLevels = async (rootId, rootLevel) => {
    const queue = [{ id: rootId, level: rootLevel }];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current)
            continue;
        const children = await prisma_1.default.category.findMany({
            where: { parent_id: current.id },
            select: { id: true },
        });
        for (const child of children) {
            const childLevel = current.level + 1;
            await prisma_1.default.category.update({
                where: { id: child.id },
                data: { level: childLevel },
            });
            queue.push({ id: child.id, level: childLevel });
        }
    }
};
async function updateCategoryNode(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid category id' });
        return;
    }
    const existing = await prisma_1.default.category.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ error: 'Category not found' });
        return;
    }
    const updates = {};
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
        const name = req.body.name.trim();
        const duplicate = await prisma_1.default.category.findFirst({
            where: {
                parent_id: existing.parent_id,
                name: { equals: name, mode: 'insensitive' },
                NOT: { id },
            },
            select: { id: true },
        });
        if (duplicate) {
            res.status(409).json({ error: 'Category already exists' });
            return;
        }
        updates.name = name;
    }
    if (typeof req.body?.icon === 'string')
        updates.icon = req.body.icon;
    if (typeof req.body?.is_active === 'boolean')
        updates.is_active = req.body.is_active;
    if (typeof req.body?.sort_order === 'number')
        updates.sort_order = req.body.sort_order;
    if (typeof req.body?.parent_id === 'number' && req.body.parent_id !== existing.parent_id) {
        const parent = await ensureParentExists(req.body.parent_id);
        if (!parent) {
            res.status(404).json({ error: 'Parent category not found' });
            return;
        }
        updates.parent_id = parent.id;
        updates.level = (parent.level ?? 0) + 1;
    }
    const updated = await prisma_1.default.category.update({
        where: { id },
        data: updates,
        select: {
            id: true,
            name: true,
            icon: true,
            parent_id: true,
            level: true,
            sort_order: true,
            is_active: true,
        },
    });
    if (updates.level !== undefined) {
        await updateDescendantLevels(updated.id, updated.level);
    }
    cachedMobileSummary = null;
    cachedCategoryTree = null;
    cachedAdminCategoryTree = null;
    cachedCategoryChildren.clear();
    res.json({ data: updated });
}
const collectDescendantIds = async (rootId) => {
    const ids = [rootId];
    let queue = [rootId];
    while (queue.length > 0) {
        const children = await prisma_1.default.category.findMany({
            where: { parent_id: { in: queue } },
            select: { id: true },
        });
        queue = children.map((child) => child.id);
        ids.push(...queue);
    }
    return ids;
};
async function deleteCategoryNode(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid category id' });
        return;
    }
    const existing = await prisma_1.default.category.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ error: 'Category not found' });
        return;
    }
    const idsToDelete = await collectDescendantIds(id);
    await prisma_1.default.category.deleteMany({ where: { id: { in: idsToDelete } } });
    cachedMobileSummary = null;
    cachedCategoryTree = null;
    cachedAdminCategoryTree = null;
    cachedCategoryChildren.clear();
    res.json({ deleted: idsToDelete.length });
}
async function getCategoryBusinessCards(req, res) {
    const id = (0, params_1.paramInt)(req.params.id);
    const category = await prisma_1.default.category.findUnique({ where: { id } });
    if (!category) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const page = (0, params_1.queryInt)(req.query.page, 1);
    const limit = Math.min((0, params_1.queryInt)(req.query.limit, 20), 50);
    const cards = await prisma_1.default.businessCard.findMany({
        where: { category: category.name },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
            id: true,
            full_name: true,
            company_name: true,
            logo_url: true,
            category: true,
            location: true,
            phone: true,
            created_at: true,
        },
    });
    res.json({ data: cards, page, limit });
}
//# sourceMappingURL=categoryController.js.map