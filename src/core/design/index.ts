export {
	type AvailabilityReport,
	BackendError,
	type BackendEvent,
	type BackendFeature,
	type BackendId,
	type BackendSession,
	type CodingBackend,
	NoBackendError,
	type SessionMode,
	StructuredOutputError,
	type StructuredRequest,
	type StructuredResult,
} from "./agent/backend"
export {
	type AgentBridge,
	type AgentTask,
	type AgentTaskKind,
	BackendBridge,
	NullBridge,
} from "./agent/bridge"
export {
	type Activity,
	type ActivityKind,
	AgentConversation,
	type ConversationDeps,
	type ConversationState,
	type PendingApproval,
	type RunOutcome,
	type RunRequest,
} from "./agent/conversation"
export { setBundledBackendDirectory } from "./agent/opencode/binary"
export { type AppWritePolicy, classify, type PermissionRuling, rulePermission } from "./agent/permissions"
export { BACKEND_IDS, disposeBackends, getBackend, probeBackends } from "./agent/registry"
export type { TranscriptEntry, TranscriptState } from "./agent/transcript"
export {
	ASSET_TYPES,
	ASSETS_DIR,
	type AssetEntry,
	type AssetIndex,
	type AssetKind,
	type AssetOrigin,
	assetIndexPath,
	assetsDirectory,
	assetUrl,
	describeAsset,
	describeInline,
	type ExpansionResult,
	expandReferences,
	findAsset,
	findTagReferences,
	fitWarning,
	isViewable,
	LARGE_ASSET_BYTES,
	type ReindexResult,
	readAssetIndex,
	reindexAssets,
	retagAsset,
	summariseForRules,
	validateTag,
	writeAssetIndex,
} from "./assets"
export { CARET_ID_RULES, INLINE_EDITING_RULES } from "./authoring/design-rules"
export {
	listFlows,
	mutateFlowDefinition,
	readFlowDefinition,
	resolveFlowFile,
	validateFlowDefinition,
	writeFlowDefinition,
} from "./flow-meta"
export {
	buildTokens,
	candidateFontUrl,
	countRecognisedTags,
	type FoundationCandidate,
	fullLibrary,
	INTERVIEW_QUESTIONS,
	type InterviewQuestion,
	LIBRARY_TAGS,
	narrowCandidates,
	PALETTE_RECIPES,
	type PaletteRecipe,
	resolveCandidate,
	SHAPE_PRESETS,
	type ShapePreset,
	TYPEFACE_PAIRINGS,
	type TypefacePairing,
	tagsFromAnswers,
} from "./foundation-library"
export { type FontOption, searchGoogleFonts } from "./google-fonts"
export { type DesignHost, type NotifyLevel, nullDesignHost } from "./host"
export { listPages, readPageMeta, validatePageMeta, writePageMeta } from "./page-meta"
export { RenderingShell } from "./rendering-shell"
export type { DesignInboundMessage, DesignOutboundMessage } from "./rendering-shell/messages"
export { caretDirectoryExists, ensureCaretDirectoryExists, ensureCaretGitignore } from "./scaffold"
export {
	bridgeFor,
	conversationFor,
	hostFor,
	type ProjectServices,
	registerProjectServices,
	setProjectBridge,
	setProjectConversation,
	unregisterProjectServices,
} from "./services"
export { DesignSession, type DesignSessionOptions } from "./session"
export { createSyncWatcher, runSyncInteractive } from "./sync/SyncWatcher"
export {
	type CompleteSyncOutcome,
	clearPendingSync,
	completeSync,
	detectSyncAddressed,
	type PendingSync,
	readPendingSync,
	registerPendingSync,
	rollbackSync,
} from "./sync/sync-completion"
export { runSync, type SyncOptions, type SyncResult, type SyncStatus } from "./sync/sync-orchestrator"
export { readSyncState, writeSyncState } from "./sync/sync-state"
export { generateTokenScale, type TokenScaleType } from "./token-scales"
export { readComponentTokens, readFoundationTokens, validateFoundationTokens, writeFoundationTokens } from "./tokens"
export type {
	ColorScale,
	ColorTokens,
	DesignContext,
	FlowDefinition,
	FlowStep,
	FoundationTokens,
	PageMeta,
	RadiusTokens,
	SpacingTokens,
	SyncState,
	TypographyTokens,
	VibeDescriptor,
} from "./types"
