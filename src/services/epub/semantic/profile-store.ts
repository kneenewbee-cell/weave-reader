// @ts-nocheck
function createSemanticProfileStore(options) {
  const {
    semanticProfiles,
    normalizeSettings,
    normalizePath,
    portableDataRoot,
    portableBookPath,
    safeBookId,
    readJson,
    writeJson,
    now
  } = options || {};

  if (!semanticProfiles) {
    throw new TypeError("createSemanticProfileStore requires semanticProfiles");
  }
  for (const [name, value] of Object.entries({
    normalizeSettings,
    normalizePath,
    portableDataRoot,
    portableBookPath,
    safeBookId,
    readJson,
    writeJson,
    now
  })) {
    if (typeof value != "function") {
      throw new TypeError(`createSemanticProfileStore requires ${name}`);
    }
  }

  function globalProfilePath() {
    return normalizePath(
      `${portableDataRoot()}/semantic-profiles/default.json`
    );
  }

  function bookProfilePath(bookId) {
    return portableBookPath(bookId, "semantic-profile.json");
  }

  function profilePayload(scope, bookId, settings) {
    const normalized = normalizeSettings(settings);
    const payload = {
      format: semanticProfiles.PROFILE_FORMAT,
      version: semanticProfiles.PROFILE_VERSION,
      scope: scope === "book" ? "book" : "global",
      annotationSemanticsEnabled:
        normalized.annotationSemanticsEnabled,
      semanticSchemeId: normalized.semanticSchemeId,
      semantics: normalized.annotationSemantics.map((semantic) => ({
        ...semantic
      })),
      standardSemanticIds: [...normalized.standardSemanticIds],
      updatedAt: now()
    };
    return scope === "book" && bookId
      ? { ...payload, bookId: safeBookId(bookId) }
      : payload;
  }

  function profileToSettings(profile) {
    return normalizeSettings(
      semanticProfiles.profileToSettings(profile || {})
    );
  }

  async function readGlobalProfile(app, fallbackSettings) {
    const storedProfile = await readJson(app, globalProfilePath());
    if (storedProfile?.format === semanticProfiles.PROFILE_FORMAT) {
      return profilePayload(
        "global",
        "",
        profileToSettings(storedProfile)
      );
    }
    const fallbackProfile = profilePayload(
      "global",
      "",
      fallbackSettings || {}
    );
    await writeJson(app, globalProfilePath(), fallbackProfile);
    return fallbackProfile;
  }

  async function readBookProfile(app, bookId) {
    const safeId = safeBookId(bookId);
    const storedProfile = await readJson(app, bookProfilePath(safeId));
    return storedProfile?.format === semanticProfiles.PROFILE_FORMAT
      ? { ...storedProfile, scope: "book", bookId: safeId }
      : null;
  }

  async function writeGlobalProfile(app, settings) {
    const profile = profilePayload("global", "", settings);
    await writeJson(app, globalProfilePath(), profile);
    return profile;
  }

  async function writeBookProfile(app, bookId, settings) {
    const safeId = safeBookId(bookId);
    const profile = profilePayload("book", safeId, settings);
    await writeJson(app, bookProfilePath(safeId), profile);
    return profile;
  }

  async function deleteBookProfile(app, bookId) {
    const path = bookProfilePath(safeBookId(bookId));
    const adapter = app.vault.adapter;
    return (await adapter.exists(path))
      ? (await adapter.remove(path), true)
      : false;
  }

  async function loadEffectiveProfile(app, bookId, fallbackSettings) {
    const safeId = safeBookId(bookId);
    const [globalProfile, bookProfile] = await Promise.all([
      readGlobalProfile(app, fallbackSettings),
      readBookProfile(app, safeId)
    ]);
    const effectiveProfile = semanticProfiles.mergeProfiles(
      globalProfile,
      bookProfile
    );
    const settings = profileToSettings(effectiveProfile);
    return {
      bookId: safeId,
      globalProfile,
      bookProfile,
      effectiveProfile,
      settings
    };
  }

  return {
    globalProfilePath,
    bookProfilePath,
    profilePayload,
    profileToSettings,
    readGlobalProfile,
    readBookProfile,
    writeGlobalProfile,
    writeBookProfile,
    deleteBookProfile,
    loadEffectiveProfile
  };
}

export {
  createSemanticProfileStore
};
