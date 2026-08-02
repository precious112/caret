/**
 * The asset layer.
 *
 * Host-free by construction, like the rest of `src/core/design/` — the Electron
 * side supplies the UI and the serving, and everything here works against a
 * project path alone so it stays unit-testable.
 */

export { type Dimensions, probeDimensions, probeSvg } from "./probe"
export { describeInline, type ExpansionResult, expandReferences, fitWarning, summariseForRules } from "./references"
export {
	ASSETS_DIR,
	assetIndexPath,
	assetsDirectory,
	assetUrl,
	describeAsset,
	findAsset,
	LARGE_ASSET_BYTES,
	type ReindexResult,
	readAssetIndex,
	reindexAssets,
	retagAsset,
	writeAssetIndex,
} from "./store"
export { deriveTag, findTagReferences, MAX_TAG_LENGTH, uniqueTag, validateTag } from "./tags"
export {
	ASSET_TYPES,
	type AssetEntry,
	type AssetIndex,
	type AssetKind,
	type AssetOrigin,
	EMPTY_ASSET_INDEX,
	isViewable,
} from "./types"
