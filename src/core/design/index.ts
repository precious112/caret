export {
	type AvailabilityReport,
	BackendError,
	type BackendEvent,
	type BackendFeature,
	type BackendId,
	type BackendSession,
	type CodingBackend,
	type ModelGroup,
	type ModelOption,
	NoBackendError,
	type PermissionModel,
	type ReasoningEffort,
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
export { EditLaneBridge, type EditStatus } from "./agent/edit-lane"
export { setBundledBackendDirectory } from "./agent/opencode/binary"
export { type AppWritePolicy, classify, type PermissionRuling, rulePermission } from "./agent/permissions"
export { BACKEND_IDS, disposeBackends, getBackend, probeBackends } from "./agent/registry"
export type { TranscriptEntry, TranscriptState } from "./agent/transcript"
// Imported from the lane's own modules rather than through the asset-library
// barrel, which stays free of node-only code so the generators remain portable.
export { probeVision, solidPng, type VisionVerdict } from "./agent/vision"
export {
	ASPECTS,
	ASSET_RECIPES,
	type AssetPurpose,
	type AssetRecipe,
	allGenerators,
	allRunnableRecipes,
	canNarrow,
	composeVariants,
	DEFAULT_PALETTE,
	defaultAspect,
	derivePalette,
	describeVariant,
	FREE_LANES,
	findAssetRecipe,
	findGenerator,
	foundationWords,
	GENERATION_QUESTIONS,
	GENERATORS,
	type GeneratedVariant,
	type GenerationAnswers,
	type GenerationChoice,
	type GenerationQuestion,
	type Generator,
	type GeneratorPalette,
	isComplete,
	lanesWithRaster,
	narrowForAnswers,
	narrowRecipes,
	proposeTag,
	RASTER_RECIPES,
	type RecipeKind,
	type RecipeLane,
	type RecipeRequest,
	RUNNABLE_LANES,
	runGenerator,
	SLOP_TELLS,
	tagsFromFoundation,
} from "./asset-library"
export { NO_RASTER_REASON, type RasterSources, resolveRasterConfig } from "./asset-library/raster/config"
export {
	composePrompt,
	type GeminiBackend,
	type GeminiConfig,
	GeminiImages,
	type GeminiModel,
	type ImageRequest,
	type ImageResult,
} from "./asset-library/raster/gemini"
export {
	ASSET_TYPES,
	ASSETS_DIR,
	type AssetEntry,
	type AssetIndex,
	type AssetKind,
	type AssetOrigin,
	addGeneratedAsset,
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
	posterPath,
	postersDirectory,
	type ReindexResult,
	readAssetIndex,
	reindexAssets,
	retagAsset,
	setPoster,
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
	findPairing,
	findPreset,
	findRecipe,
	fullLibrary,
	googleFontsUrl,
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
export {
	buildFoundation,
	type CommittedFoundation,
	type ConductorInput,
	clearWizardScratch,
	type Decisions,
	deterministicOptions,
	type FinalizedFoundation,
	type FoundationProposal,
	finalizeProposal,
	INTERVIEW_STEPS,
	IncompleteInterviewError,
	type InterviewStep,
	nextWizardTurn,
	normalizeHex,
	ProposalError,
	QUESTION_CAP,
	readWizardScratch,
	type SpecimenParams,
	type StepId,
	type StepOption,
	type StoredQA,
	stepAt,
	tagsFromDescription,
	validateQuestion,
	type WidgetKind,
	type WizardAnswer,
	type WizardOption,
	type WizardQuestion,
	type WizardScratch,
	type WizardTurn,
	WizardTurnError,
	writeWizardScratch,
} from "./interview"
export { listPages, readPageMeta, validatePageMeta, writePageMeta } from "./page-meta"
export { RenderingShell } from "./rendering-shell"
export { writeThemeCss } from "./rendering-shell/entry-template"
export type { DesignInboundMessage, DesignOutboundMessage } from "./rendering-shell/messages"
export { foundationThemeCss, THEME_CSS_FILENAME } from "./rendering-shell/theme-css"
export { caretDirectoryExists, ensureCaretDirectoryExists, ensureCaretGitignore } from "./scaffold"
export {
	bridgeFor,
	conversationFor,
	editLaneFor,
	hostFor,
	type ProjectServices,
	registerProjectServices,
	setProjectBridge,
	setProjectConversation,
	setProjectEditLane,
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
