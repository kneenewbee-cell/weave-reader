// @ts-nocheck
function createSemanticAnnotationAdapter(options) {
  const {
    semanticProfiles,
    normalizeCfi,
    normalizeColorToken,
    resolveSemantic,
    profileToSettings,
    cloneJson,
    now
  } = options || {};

  for (const [name, value] of Object.entries({
    semanticProfiles,
    normalizeCfi,
    normalizeColorToken,
    resolveSemantic,
    profileToSettings,
    cloneJson,
    now
  })) {
    if (typeof value == "undefined" || value === null) {
      throw new TypeError(`createSemanticAnnotationAdapter requires ${name}`);
    }
  }

  function createPortableAnnotationsPayload(bookIdentity, annotations = []) {
    return {
      format: "weave-reader-annotations/v1",
      version: 1,
      bookId: bookIdentity.bookId,
      updatedAt: now(),
      annotations: Array.isArray(annotations)
        ? annotations
            .map(
              (annotation) =>
                semanticProfiles.toStoredAnnotation(annotation) ||
                cloneJson(annotation)
            )
            .filter(Boolean)
        : []
    };
  }

  function normalizeLocalAnnotation(annotation, profile) {
    if (!annotation || typeof annotation != "object") return null;
    const presentedAnnotation = profile
      ? semanticProfiles.resolveAnnotationPresentation(annotation, profile)
      : annotation;
    const cfiRange = normalizeCfi(
      String(presentedAnnotation.cfiRange || "").trim()
    );
    const text = String(presentedAnnotation.text || "").trim();
    if (!cfiRange || !text) return null;
    const color =
      normalizeColorToken(presentedAnnotation.color) || "yellow";
    const rawStyle = String(presentedAnnotation.style || "").trim();
    const readerStyle =
      semanticProfiles.toReaderAnnotationStyle(rawStyle);
    const semantic = resolveSemantic(
      presentedAnnotation.semanticId
        ? String(presentedAnnotation.semanticId)
        : { color, style: rawStyle || "highlight" },
      profile ? profileToSettings(profile) : void 0
    );
    const semanticLabel = String(
      semantic?.label || presentedAnnotation.semanticLabel || ""
    ).trim();
    const semanticGroup = String(
      semantic?.group || presentedAnnotation.semanticGroup || ""
    ).trim();
    const semanticDescription = String(
      semantic?.description ||
        presentedAnnotation.semanticDescription ||
        ""
    ).trim();
    const semanticSource = String(
      semantic?.source || presentedAnnotation.semanticSource || ""
    ).trim();
    const createdTime =
      typeof presentedAnnotation.createdTime == "number" &&
      Number.isFinite(presentedAnnotation.createdTime)
        ? presentedAnnotation.createdTime
        : now();
    const chapterIndex =
      typeof presentedAnnotation.chapterIndex == "number" &&
      Number.isFinite(presentedAnnotation.chapterIndex)
        ? presentedAnnotation.chapterIndex
        : void 0;
    const chapterTitle = String(
      presentedAnnotation.chapterTitle || ""
    ).trim();
    const commentText = String(
      presentedAnnotation.commentText || ""
    ).trim();
    return {
      cfiRange,
      color,
      ...(readerStyle ? { style: readerStyle } : {}),
      ...(semantic?.id || presentedAnnotation.semanticId
        ? {
            semanticId: String(
              presentedAnnotation.semanticId || semantic?.id || ""
            ).trim()
          }
        : {}),
      ...(semanticLabel ? { semanticLabel } : {}),
      ...(semanticGroup ? { semanticGroup } : {}),
      ...(semanticDescription ? { semanticDescription } : {}),
      ...(semanticSource ? { semanticSource } : {}),
      text,
      ...(commentText ? { commentText } : {}),
      ...(presentedAnnotation.hasCommentDivider === true
        ? { hasCommentDivider: true }
        : {}),
      ...(chapterIndex !== void 0 ? { chapterIndex } : {}),
      ...(chapterTitle ? { chapterTitle } : {}),
      createdTime,
      ...(typeof presentedAnnotation.updatedAt == "number" &&
      Number.isFinite(presentedAnnotation.updatedAt)
        ? { updatedAt: presentedAnnotation.updatedAt }
        : {}),
      presentation: "highlight"
    };
  }

  function localAnnotationKey(annotation) {
    const normalizedAnnotation = normalizeLocalAnnotation(annotation);
    return normalizedAnnotation
      ? semanticProfiles.annotationKey(normalizedAnnotation)
      : "";
  }

  return {
    createPortableAnnotationsPayload,
    normalizeLocalAnnotation,
    localAnnotationKey
  };
}

export {
  createSemanticAnnotationAdapter
};
