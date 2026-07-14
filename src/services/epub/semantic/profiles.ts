// @ts-nocheck
const PROFILE_FORMAT = "weave-reader-semantic-profile/v1";
const PROFILE_VERSION = 1;
const SEMANTIC_SCHEME_MIN_ITEMS = 1;
const SEMANTIC_SCHEME_MAX_ITEMS = 12;
const SEMANTIC_ANNOTATION_STYLE_TOKENS = ["highlight", "underline", "wavy"];
const ANNOTATION_STYLE_TOKENS = new Set([
  "highlight",
  "underline",
  "strikethrough",
  "wavy"
]);
const SEMANTIC_COLOR_HEX = {
  yellow: "#FFE58A",
  blue: "#9ED8FF",
  red: "#FF9A9A",
  purple: "#C9A7FF",
  green: "#A7E8B3",
  orange: "#FFC978",
  cyan: "#8BE3E7",
  pink: "#FFB3D1",
  gray: "#C9CDD4"
};
const ANNOTATION_STYLE_LABELS = {
  highlight: "\u9ad8\u4eae",
  underline: "\u4e0b\u5212\u7ebf",
  strikethrough: "\u9a6c\u8d5b\u514b",
  wavy: "\u6ce2\u6d6a\u7ebf"
};

function schemeSemantic(
  id,
  label,
  color,
  style,
  group,
  description,
  showInStandard = false
) {
  return {
    id,
    label,
    color,
    style,
    group,
    description,
    showInStandard,
    source: "preset",
    active: true
  };
}

function scheme(id, label, semantics, standardSemanticIds) {
  return { id, label, semantics, standardSemanticIds };
}

const SYSTEM_SEMANTIC_SCHEMES = [
  scheme(
    "general-reading",
    "通用阅读",
    [
      schemeSemantic("important", "重点", "yellow", "highlight", "general", "值得保留或反复阅读的内容", true),
      schemeSemantic("favorite", "摘句", "cyan", "underline", "general", "喜欢的表达、句子或段落", true),
      schemeSemantic("reflection", "感想", "purple", "highlight", "thinking", "阅读时产生的联想或个人回应", true),
      schemeSemantic("question", "疑问", "purple", "wavy", "thinking", "需要回看、查证或继续思考的内容", true),
      schemeSemantic("review", "待回看", "gray", "wavy", "thinking", "暂时标出、之后再判断是否保留的内容")
    ],
    ["important", "favorite", "reflection", "question"]
  ),
  scheme(
    "literature-humanities",
    "文学与人文",
    [
      schemeSemantic("theme", "主题/观点", "yellow", "highlight", "humanities", "作品主题或作者核心观点", true),
      schemeSemantic("character", "人物", "pink", "underline", "humanities", "人物、身份及人物关系", true),
      schemeSemantic("event", "事件/情节", "orange", "underline", "humanities", "关键事件、情节推进或历史节点", true),
      schemeSemantic("quote", "引文/史料", "cyan", "highlight", "humanities", "值得引用的文本、史料或原话", true),
      schemeSemantic("conflict", "冲突/争议", "red", "wavy", "humanities", "矛盾、争议或需要辨析的内容"),
      schemeSemantic("reflection", "感想", "purple", "highlight", "thinking", "个人感受、解释或延伸思考")
    ],
    ["theme", "character", "event", "quote"]
  ),
  scheme(
    "study-exam",
    "教材与考试",
    [
      schemeSemantic("important", "重点", "yellow", "highlight", "study", "必须掌握的核心内容", true),
      schemeSemantic("definition", "定义", "blue", "underline", "study", "术语、定义或概念说明", true),
      schemeSemantic("example", "例题/案例", "green", "highlight", "study", "帮助理解和迁移的例题或案例"),
      schemeSemantic("method", "方法/公式", "cyan", "underline", "study", "解题方法、公式或操作步骤"),
      schemeSemantic("mistake", "易错点", "red", "wavy", "exam", "容易混淆或答错的内容", true),
      schemeSemantic("exam", "必考点", "orange", "highlight", "exam", "考试和复习中高频出现的内容"),
      schemeSemantic("question", "未掌握", "purple", "wavy", "thinking", "尚未理解或需要回看的内容", true)
    ],
    ["important", "definition", "mistake", "question"]
  ),
  scheme(
    "academic-research",
    "学术研究",
    [
      schemeSemantic("research-question", "研究问题", "purple", "highlight", "research", "论文试图回答的问题", true),
      schemeSemantic("related-work", "相关工作", "gray", "underline", "research", "前人研究与理论背景"),
      schemeSemantic("method", "研究方法", "blue", "underline", "research", "研究设计、方法和分析过程", true),
      schemeSemantic("evidence", "数据/证据", "green", "highlight", "research", "实验数据、材料和论据", true),
      schemeSemantic("result", "结果/结论", "yellow", "highlight", "research", "研究发现与主要结论", true),
      schemeSemantic("limitation", "局限", "red", "wavy", "research", "研究边界、缺陷和限制"),
      schemeSemantic("citation", "引用/跟进", "cyan", "underline", "research", "值得引用或进一步查阅的来源")
    ],
    ["research-question", "method", "evidence", "result"]
  ),
  scheme(
    "math-science",
    "数学与理工",
    [
      schemeSemantic("theorem", "定理/结论", "yellow", "highlight", "science", "定理、规律与关键结论", true),
      schemeSemantic("definition", "定义", "blue", "underline", "science", "概念、符号和定义", true),
      schemeSemantic("formula", "公式", "cyan", "underline", "science", "公式、方程和计算关系", true),
      schemeSemantic("proof", "证明/推导", "purple", "highlight", "science", "证明步骤、推导过程和思路"),
      schemeSemantic("example", "例题/实验", "green", "highlight", "science", "例题、实验或直观例子"),
      schemeSemantic("mistake", "条件/易错", "red", "wavy", "science", "适用条件、边界和易错点", true),
      schemeSemantic("question", "疑问", "purple", "wavy", "thinking", "待证明、待验证或未理解的内容")
    ],
    ["theorem", "definition", "formula", "mistake"]
  ),
  scheme(
    "programming-engineering",
    "编程与工程",
    [
      schemeSemantic("concept", "核心概念", "yellow", "highlight", "engineering", "系统原理与核心概念", true),
      schemeSemantic("api-syntax", "API/语法", "blue", "underline", "engineering", "接口、语法、参数和约定", true),
      schemeSemantic("code-example", "代码示例", "green", "highlight", "engineering", "可复用的代码或工程示例", true),
      schemeSemantic("implementation", "实现原理", "purple", "underline", "engineering", "内部机制、架构和实现步骤"),
      schemeSemantic("pitfall", "陷阱/风险", "red", "wavy", "engineering", "常见错误、兼容性和安全风险", true),
      schemeSemantic("performance-security", "性能/安全", "orange", "highlight", "engineering", "性能、安全和可靠性要点"),
      schemeSemantic("question", "待验证", "purple", "wavy", "thinking", "需要实验、调试或进一步确认的内容")
    ],
    ["concept", "api-syntax", "code-example", "pitfall"]
  ),
  scheme(
    "medical-life-science",
    "医学与生命科学",
    [
      schemeSemantic("diagnosis", "诊断要点", "yellow", "highlight", "medical", "诊断标准和关键判断依据", true),
      schemeSemantic("symptom", "症状/体征", "blue", "underline", "medical", "症状、体征和临床表现", true),
      schemeSemantic("mechanism", "机制/病理", "purple", "underline", "medical", "作用机制、病理过程和生理关系"),
      schemeSemantic("evidence", "证据/检查", "green", "highlight", "medical", "检查结果、研究证据和鉴别依据"),
      schemeSemantic("treatment", "治疗", "cyan", "highlight", "medical", "治疗原则、方案和随访"),
      schemeSemantic("drug-dose", "药物/剂量", "orange", "underline", "medical", "药物名称、剂量和用法"),
      schemeSemantic("contraindication", "禁忌/风险", "red", "wavy", "medical", "禁忌、不良反应和高风险情况", true),
      schemeSemantic("question", "疑点", "purple", "wavy", "thinking", "证据不足或需要进一步确认的内容", true)
    ],
    ["diagnosis", "symptom", "contraindication", "question"]
  ),
  scheme(
    "law-policy",
    "法学与政策",
    [
      schemeSemantic("rule", "规则/法条", "yellow", "highlight", "law", "法律规则、政策条文和裁判规范", true),
      schemeSemantic("element", "构成要件", "blue", "underline", "law", "概念、主体和构成要件", true),
      schemeSemantic("case-evidence", "案例/证据", "green", "highlight", "law", "案例事实、证据和适用材料"),
      schemeSemantic("exception", "例外/风险", "red", "wavy", "law", "例外、限制和法律风险", true),
      schemeSemantic("reasoning", "论证/推理", "purple", "underline", "law", "法律论证和适用路径"),
      schemeSemantic("conclusion", "结论", "orange", "highlight", "law", "裁判结论、政策结果和主张"),
      schemeSemantic("issue", "争点", "purple", "wavy", "law", "争议焦点和待解决问题", true)
    ],
    ["rule", "element", "exception", "issue"]
  ),
  scheme(
    "tools-practice",
    "工具与实践",
    [
      schemeSemantic("term-parameter", "术语/参数", "blue", "underline", "practice", "参数、选项、术语和输入要求", true),
      schemeSemantic("steps", "步骤", "yellow", "highlight", "practice", "操作流程和执行步骤", true),
      schemeSemantic("example", "示例", "green", "highlight", "practice", "可直接参考的示例和结果", true),
      schemeSemantic("warning", "警告", "red", "wavy", "practice", "风险、限制和禁止事项", true),
      schemeSemantic("best-practice", "最佳实践", "cyan", "highlight", "practice", "推荐做法和经验规则"),
      schemeSemantic("todo", "待处理", "purple", "wavy", "practice", "需要执行、验证或继续处理的事项")
    ],
    ["term-parameter", "steps", "example", "warning"]
  )
];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function semanticEntries(profile) {
  if (Array.isArray(profile?.semantics)) return profile.semantics;
  if (Array.isArray(profile?.annotationSemantics)) {
    return profile.annotationSemantics;
  }
  return [];
}

function activeSemanticEntries(profile) {
  return semanticEntries(profile).filter((entry) => entry?.active !== false);
}

function getSemanticScheme(id) {
  const normalized = String(id || "").trim();
  const found = SYSTEM_SEMANTIC_SCHEMES.find(
    (candidate) => candidate.id === normalized
  );
  return found ? clone(found) : null;
}

const DEFAULT_EPUB_SEMANTIC_SCHEME_ID = "general-reading";
const DEFAULT_EPUB_SEMANTIC_SCHEME = getSemanticScheme(
  DEFAULT_EPUB_SEMANTIC_SCHEME_ID
);
const DEFAULT_EPUB_STANDARD_SEMANTIC_IDS = [
  ...DEFAULT_EPUB_SEMANTIC_SCHEME.standardSemanticIds
];
const DEFAULT_EPUB_ANNOTATION_SEMANTICS =
  DEFAULT_EPUB_SEMANTIC_SCHEME.semantics.map((entry) => ({ ...entry }));

function normalizeAnnotationStyle(style) {
  const normalized = String(style || "highlight").trim().toLowerCase();
  if (!normalized || normalized === "none") return "highlight";
  return ANNOTATION_STYLE_TOKENS.has(normalized) ? normalized : "highlight";
}

function normalizeSemanticColorToken(color) {
  const normalized = String(color || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SEMANTIC_COLOR_HEX, normalized)
    ? normalized
    : "";
}

function normalizeSemanticId(id, index = 0) {
  const normalized = String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `semantic-${index + 1}`;
}

function normalizeSemanticEntry(entry, index = 0) {
  const fallback = DEFAULT_EPUB_ANNOTATION_SEMANTICS[index] || {};
  const source = entry && typeof entry === "object" ? entry : {};
  const id = normalizeSemanticId(source.id || fallback.id, index);
  const label = String(source.label || fallback.label || `\u8bed\u4e49 ${index + 1}`)
    .trim()
    .slice(0, 16);
  const color =
    normalizeSemanticColorToken(source.color || fallback.color) || "yellow";
  const style = normalizeAnnotationStyle(source.style || fallback.style);
  const group = String(source.group || fallback.group || "study").trim();
  const description = String(source.description || fallback.description || "")
    .trim()
    .slice(0, 80);
  const sourceKind = String(source.source || fallback.source || "custom").trim();
  return {
    id,
    label: label || fallback.label || "\u8bed\u4e49",
    color,
    style,
    group: group || "study",
    description,
    active: source.active !== false,
    showInStandard:
      source.showInStandard === true ||
      (source.showInStandard !== false &&
        DEFAULT_EPUB_STANDARD_SEMANTIC_IDS.includes(id)),
    source: sourceKind || "custom"
  };
}

function normalizeSemanticSettings(settings = {}) {
  const inputEntries = Array.isArray(settings.annotationSemantics)
    ? settings.annotationSemantics
    : DEFAULT_EPUB_ANNOTATION_SEMANTICS;
  const normalizedEntries = [];
  const usedIds = new Set();
  for (let index = 0; index < inputEntries.length; index += 1) {
    const entry = normalizeSemanticEntry(inputEntries[index], index);
    if (usedIds.has(entry.id)) continue;
    usedIds.add(entry.id);
    normalizedEntries.push(entry);
  }
  if (normalizedEntries.length === 0) {
    DEFAULT_EPUB_ANNOTATION_SEMANTICS.forEach((entry, index) => {
      const normalized = normalizeSemanticEntry(entry, index);
      if (usedIds.has(normalized.id)) return;
      usedIds.add(normalized.id);
      normalizedEntries.push(normalized);
    });
  }
  const requestedStandardIds = new Set(
    (Array.isArray(settings.standardSemanticIds)
      ? settings.standardSemanticIds
      : DEFAULT_EPUB_STANDARD_SEMANTIC_IDS
    )
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const standardSemanticIds = normalizedEntries
    .filter(
      (entry) =>
        entry.active !== false &&
        (requestedStandardIds.has(entry.id) || entry.showInStandard)
    )
    .map((entry) => entry.id)
    .slice(0, 4);
  return {
    annotationSemanticsEnabled: settings.annotationSemanticsEnabled !== false,
    semanticSchemeId:
      String(settings.semanticSchemeId || "custom").trim() || "custom",
    annotationSemantics: normalizedEntries,
    standardSemanticIds:
      standardSemanticIds.length > 0
        ? standardSemanticIds
        : normalizedEntries
            .filter((entry) => entry.active !== false)
            .slice(0, 3)
            .map((entry) => entry.id)
  };
}

function comparableSemantic(entry) {
  return {
    id: String(entry?.id || "").trim(),
    label: String(entry?.label || "").trim(),
    color: String(entry?.color || "yellow").trim().toLowerCase(),
    style: normalizeAnnotationStyle(entry?.style),
    group: String(entry?.group || "").trim(),
    description: String(entry?.description || "").trim()
  };
}

function isSemanticSchemeModified(profile) {
  const normalizedProfile = normalizeSemanticSettings(profile);
  const selected = getSemanticScheme(normalizedProfile.semanticSchemeId);
  if (!selected) return false;
  const currentSemantics = activeSemanticEntries(normalizedProfile).map(
    comparableSemantic
  );
  const originalSemantics = selected.semantics.map(comparableSemantic);
  return (
    JSON.stringify(currentSemantics) !== JSON.stringify(originalSemantics) ||
    JSON.stringify(normalizedProfile.standardSemanticIds) !==
      JSON.stringify(selected.standardSemanticIds)
  );
}

function setSemanticEntries(profile, entries) {
  const result = clone(profile || {});
  const hasStoredEntries = Array.isArray(profile?.semantics);
  const hasSettingsEntries = Array.isArray(profile?.annotationSemantics);
  if (hasStoredEntries) result.semantics = clone(entries);
  if (hasSettingsEntries || !hasStoredEntries) {
    result.annotationSemantics = clone(entries);
  }
  return result;
}

function applySemanticScheme(profile, schemeId) {
  const selected = getSemanticScheme(schemeId);
  if (!selected) return normalizeSemanticSettings(profile);
  const current = normalizeSemanticSettings(profile);
  const selectedIds = new Set(selected.semantics.map((entry) => entry.id));
  const archived = current.annotationSemantics
    .filter((entry) => !selectedIds.has(String(entry?.id || "").trim()))
    .map((entry) => ({ ...clone(entry), active: false, showInStandard: false }));
  const result = normalizeSemanticSettings({
    ...current,
    semanticSchemeId: selected.id,
    annotationSemantics: [
      ...selected.semantics.map((entry) => ({ ...clone(entry), active: true })),
      ...archived
    ],
    standardSemanticIds: [...selected.standardSemanticIds]
  });
  result.semanticSchemeId = selected.id;
  return result;
}

function addCustomSemantic(profile) {
  const current = semanticEntries(profile);
  if (activeSemanticEntries(profile).length >= SEMANTIC_SCHEME_MAX_ITEMS) {
    return clone(profile || {});
  }
  const usedIds = new Set(
    current.map((entry) => String(entry?.id || "").trim()).filter(Boolean)
  );
  let suffix = 1;
  while (usedIds.has(`custom-${suffix}`)) suffix += 1;
  const result = setSemanticEntries(profile, [
    ...clone(current),
    {
      id: `custom-${suffix}`,
      label: "新语义",
      color: "yellow",
      style: "highlight",
      group: "custom",
      description: "",
      showInStandard: false,
      source: "custom",
      active: true
    }
  ]);
  result.semanticSchemeId = getSemanticScheme(profile?.semanticSchemeId)
    ? String(profile.semanticSchemeId).trim()
    : "custom";
  return result;
}

function archiveSemantic(profile, semanticId) {
  const id = String(semanticId || "").trim();
  if (!id || activeSemanticEntries(profile).length <= SEMANTIC_SCHEME_MIN_ITEMS) {
    return clone(profile || {});
  }
  const result = setSemanticEntries(
    profile,
    semanticEntries(profile).map((entry) =>
      String(entry?.id || "").trim() === id
        ? { ...clone(entry), active: false, showInStandard: false }
        : clone(entry)
    )
  );
  result.semanticSchemeId = getSemanticScheme(profile?.semanticSchemeId)
    ? String(profile.semanticSchemeId).trim()
    : "custom";
  result.standardSemanticIds = Array.isArray(profile?.standardSemanticIds)
    ? profile.standardSemanticIds.filter((entryId) => entryId !== id)
    : [];
  return result;
}

function addCustomSemanticNormalized(profile) {
  const normalized = normalizeSemanticSettings(profile);
  if (activeSemanticEntries(normalized).length >= SEMANTIC_SCHEME_MAX_ITEMS) {
    return normalized;
  }
  const usedIds = new Set(
    normalized.annotationSemantics
      .map((entry) => String(entry?.id || "").trim())
      .filter(Boolean)
  );
  let suffix = 1;
  while (usedIds.has(`custom-${suffix}`)) suffix += 1;
  return normalizeSemanticSettings({
    ...normalized,
    semanticSchemeId: getSemanticScheme(normalized.semanticSchemeId)
      ? normalized.semanticSchemeId
      : "custom",
    annotationSemantics: [
      ...clone(normalized.annotationSemantics),
      {
        id: `custom-${suffix}`,
        label: "\u65b0\u8bed\u4e49",
        color: "yellow",
        style: "highlight",
        group: "custom",
        description: "",
        active: true,
        showInStandard: false,
        source: "custom"
      }
    ]
  });
}

function archiveSemanticNormalized(profile, semanticId) {
  const id = String(semanticId || "").trim();
  const normalized = normalizeSemanticSettings(profile);
  if (!id || activeSemanticEntries(normalized).length <= SEMANTIC_SCHEME_MIN_ITEMS) {
    return normalized;
  }
  return normalizeSemanticSettings({
    ...normalized,
    semanticSchemeId: getSemanticScheme(normalized.semanticSchemeId)
      ? normalized.semanticSchemeId
      : "custom",
    annotationSemantics: normalized.annotationSemantics.map((entry) =>
      String(entry?.id || "").trim() === id
        ? { ...clone(entry), active: false, showInStandard: false }
        : clone(entry)
    ),
    standardSemanticIds: normalized.standardSemanticIds.filter(
      (entryId) => entryId !== id
    )
  });
}

function createSemanticSaveCoordinator(cloneValue = clone) {
  const drafts = new Map();
  const pendingCounts = new Map();
  let queue = Promise.resolve();
  let version = 0;
  return {
    reset(key, value) {
      if ((pendingCounts.get(key) || 0) === 0) {
        drafts.set(key, cloneValue(value));
      }
    },
    current(key, fallback) {
      return cloneValue(drafts.has(key) ? drafts.get(key) : fallback);
    },
    async enqueue(key, value, save) {
      drafts.set(key, cloneValue(value));
      pendingCounts.set(key, (pendingCounts.get(key) || 0) + 1);
      const snapshot = cloneValue(drafts.get(key));
      const currentVersion = ++version;
      const task = queue.catch(() => {}).then(() => save(snapshot));
      queue = task;
      try {
        await task;
        return currentVersion === version;
      } finally {
        const remaining = (pendingCounts.get(key) || 1) - 1;
        if (remaining > 0) pendingCounts.set(key, remaining);
        else pendingCounts.delete(key);
      }
    }
  };
}

function mergeEntry(base, override) {
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    if (value !== undefined) result[key] = value;
  }
  result.id = String(result.id || "").trim();
  return result;
}

function mergeProfiles(globalProfile = {}, bookProfile = null) {
  const entriesById = new Map();
  const order = [];
  const globalEntriesById = new Map();
  const bookEntries = bookProfile ? semanticEntries(bookProfile) : [];
  for (const entry of semanticEntries(globalProfile)) {
    const id = String(entry?.id || "").trim();
    if (!id || globalEntriesById.has(id)) continue;
    globalEntriesById.set(id, mergeEntry(null, entry));
  }
  if (bookProfile && bookEntries.length > 0) {
    for (const entry of bookEntries) {
      const id = String(entry?.id || "").trim();
      if (!id || entriesById.has(id)) continue;
      order.push(id);
      entriesById.set(id, mergeEntry(globalEntriesById.get(id), entry));
    }
  } else {
    for (const [id, entry] of globalEntriesById) {
      order.push(id);
      entriesById.set(id, entry);
    }
  }

  const source = bookProfile || globalProfile;
  const globalStandardIds = Array.isArray(globalProfile?.standardSemanticIds)
    ? globalProfile.standardSemanticIds
    : [];
  const standardSemanticIds =
    bookProfile && hasOwn(bookProfile, "standardSemanticIds")
      ? bookProfile.standardSemanticIds
      : globalStandardIds;
  const enabled =
    bookProfile && hasOwn(bookProfile, "annotationSemanticsEnabled")
      ? bookProfile.annotationSemanticsEnabled !== false
      : globalProfile?.annotationSemanticsEnabled !== false;

  return {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    scope: bookProfile ? "book" : "global",
    ...(bookProfile?.bookId
      ? { bookId: String(bookProfile.bookId).trim() }
      : {}),
    annotationSemanticsEnabled: enabled,
    semanticSchemeId: String(source?.semanticSchemeId || "custom").trim() || "custom",
    semantics: order.map((id) => entriesById.get(id)),
    standardSemanticIds: Array.isArray(standardSemanticIds)
      ? standardSemanticIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [],
    ...(source?.updatedAt ? { updatedAt: source.updatedAt } : {})
  };
}

function toStoredAnnotation(annotation) {
  if (!annotation || typeof annotation !== "object") return null;
  const semanticId = String(annotation.semanticId || "").trim();
  if (!semanticId) return clone(annotation);

  const stored = {};
  const fields = [
    "id",
    "cfiRange",
    "text",
    "commentText",
    "hasCommentDivider",
    "chapterIndex",
    "chapterTitle",
    "chapterRootTitle",
    "chapterPath",
    "chapterHref",
    "spineIndex",
    "createdTime",
    "updatedAt"
  ];
  for (const field of fields) {
    if (hasOwn(annotation, field) && annotation[field] !== undefined) {
      stored[field] = clone(annotation[field]);
    }
  }
  stored.semanticId = semanticId;

  const ordered = {};
  if (hasOwn(stored, "id")) ordered.id = stored.id;
  if (hasOwn(stored, "cfiRange")) ordered.cfiRange = stored.cfiRange;
  ordered.semanticId = stored.semanticId;
  for (const field of fields.slice(2)) {
    if (hasOwn(stored, field)) ordered[field] = stored[field];
  }
  return ordered;
}

function annotationKey(annotation) {
  if (!annotation || typeof annotation !== "object") return "";
  const cfiRange = String(annotation.cfiRange || "").trim();
  const text = String(annotation.text || "").trim();
  if (!cfiRange || !text) return "";
  const semanticId = String(annotation.semanticId || "").trim();
  if (semanticId) {
    return [cfiRange, `semantic:${semanticId}`, text].join("::");
  }
  const color = String(annotation.color || "yellow").trim().toLowerCase();
  const style = String(annotation.style || "highlight").trim().toLowerCase();
  return [cfiRange, `legacy:${color}:${style}`, text].join("::");
}

function resolveAnnotationPresentation(annotation, profile) {
  if (!annotation || typeof annotation !== "object") return annotation;
  const semanticId = String(annotation.semanticId || "").trim();
  if (!semanticId) return clone(annotation);
  const entry = semanticEntries(profile).find(
    (candidate) => String(candidate?.id || "").trim() === semanticId
  );
  if (!entry) return clone(annotation);

  const resolved = {
    ...clone(annotation),
    color: entry.color || annotation.color || "yellow",
    style: entry.style || annotation.style || "highlight"
  };
  if (entry.label) resolved.semanticLabel = entry.label;
  if (entry.group) resolved.semanticGroup = entry.group;
  if (entry.description) resolved.semanticDescription = entry.description;
  if (entry.source) resolved.semanticSource = entry.source;
  return resolved;
}

function toReaderAnnotationStyle(style) {
  const normalized = String(style || "").trim().toLowerCase();
  return ["underline", "strikethrough", "wavy"].includes(normalized)
    ? normalized
    : undefined;
}

function profileToSettings(profile) {
  return {
    annotationSemanticsEnabled: profile?.annotationSemanticsEnabled !== false,
    semanticSchemeId:
      String(profile?.semanticSchemeId || "custom").trim() || "custom",
    annotationSemantics: clone(semanticEntries(profile)),
    standardSemanticIds: clone(profile?.standardSemanticIds || [])
  };
}

export {
  ANNOTATION_STYLE_LABELS,
  ANNOTATION_STYLE_TOKENS,
  DEFAULT_EPUB_ANNOTATION_SEMANTICS,
  DEFAULT_EPUB_SEMANTIC_SCHEME,
  DEFAULT_EPUB_SEMANTIC_SCHEME_ID,
  DEFAULT_EPUB_STANDARD_SEMANTIC_IDS,
  PROFILE_FORMAT,
  PROFILE_VERSION,
  SEMANTIC_ANNOTATION_STYLE_TOKENS,
  SEMANTIC_COLOR_HEX,
  SEMANTIC_SCHEME_MAX_ITEMS,
  SEMANTIC_SCHEME_MIN_ITEMS,
  SYSTEM_SEMANTIC_SCHEMES,
  activeSemanticEntries,
  addCustomSemanticNormalized as addCustomSemantic,
  annotationKey,
  applySemanticScheme,
  archiveSemanticNormalized as archiveSemantic,
  createSemanticSaveCoordinator,
  getSemanticScheme,
  isSemanticSchemeModified,
  mergeProfiles,
  normalizeAnnotationStyle,
  normalizeSemanticSettings,
  profileToSettings,
  resolveAnnotationPresentation,
  semanticEntries,
  toReaderAnnotationStyle,
  toStoredAnnotation
};
