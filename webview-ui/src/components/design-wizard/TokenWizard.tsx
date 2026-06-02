import { ArrowLeftIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { DesignServiceClient } from "@/services/grpc-client"
import { WIZARD_STEPS } from "./data-steps"
import { TokenPreview } from "./preview/TokenPreview"
import { ColorStep } from "./steps/ColorStep"
import { RadiusStep } from "./steps/RadiusStep"
import { ReviewStep } from "./steps/ReviewStep"
import { SpacingStep } from "./steps/SpacingStep"
import { TypographyStep } from "./steps/TypographyStep"
import { VibeStep } from "./steps/VibeStep"

export type FoundationTokensDraft = {
	vibe: { description: string; tags: string[] }
	color: {
		brand: { seed: string; scale: Record<string, string> }
		neutral: { character: string; scale: Record<string, string> }
		semantic: { success: string; warning: string; error: string; info: string }
	}
	typography: {
		fontFamily: string
		fallback: string
		scaleRatio: number
		baseSize: number
		scale: Record<string, string>
	}
	spacing: { baseUnit: 4 | 8; scale: number[] }
	radius: { character: string; scale: number[] }
}

const DEFAULT_TOKENS: FoundationTokensDraft = {
	vibe: { description: "", tags: [] },
	color: {
		brand: { seed: "#3b82f6", scale: {} },
		neutral: { character: "cool", scale: {} },
		semantic: { success: "#22c55e", warning: "#eab308", error: "#ef4444", info: "#3b82f6" },
	},
	typography: {
		fontFamily: "Inter",
		fallback: "system-ui, sans-serif",
		scaleRatio: 1.25,
		baseSize: 16,
		scale: {},
	},
	spacing: { baseUnit: 4, scale: [0, 1, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64] },
	radius: { character: "soft", scale: [0, 2, 4, 8, 12, 9999] },
}

type Props = {
	onDone: () => void
}

export function TokenWizard({ onDone }: Props) {
	const [step, setStep] = useState(0)
	const [tokens, setTokens] = useState<FoundationTokensDraft>(DEFAULT_TOKENS)
	const [saving, setSaving] = useState(false)
	const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle")
	const [saveError, setSaveError] = useState("")
	const [loaded, setLoaded] = useState(false)
	const [hasExistingTokens, setHasExistingTokens] = useState(false)

	useEffect(() => {
		let cancelled = false
		DesignServiceClient.getFoundationTokens({})
			.then((response) => {
				if (cancelled) return
				if (response.tokensJson && response.tokensJson !== "null") {
					try {
						const saved = JSON.parse(response.tokensJson)
						setTokens((prev) => ({
							vibe: { ...prev.vibe, ...saved.vibe },
							color: {
								brand: { ...prev.color.brand, ...saved.color?.brand },
								neutral: { ...prev.color.neutral, ...saved.color?.neutral },
								semantic: { ...prev.color.semantic, ...saved.color?.semantic },
							},
							typography: { ...prev.typography, ...saved.typography },
							spacing: { ...prev.spacing, ...saved.spacing },
							radius: { ...prev.radius, ...saved.radius },
						}))
						setHasExistingTokens(true)
					} catch {
						// ignore parse errors, use defaults
					}
				}
			})
			.catch(() => {
				// no existing tokens, use defaults
			})
			.finally(() => {
				if (!cancelled) setLoaded(true)
			})
		return () => {
			cancelled = true
		}
	}, [])

	const handleNext = useCallback(() => {
		if (step < WIZARD_STEPS.length - 1) {
			setStep(step + 1)
		}
	}, [step])

	const handleBack = useCallback(() => {
		if (step > 0) {
			setStep(step - 1)
		}
	}, [step])

	const handleSave = useCallback(async () => {
		setSaving(true)
		setSaveStatus("idle")
		setSaveError("")
		try {
			await DesignServiceClient.updateFoundationTokens({
				tokensJson: JSON.stringify(tokens),
			})
			setSaveStatus("success")
			setTimeout(() => onDone(), 1200)
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Failed to save tokens"
			console.error("Failed to save tokens:", e)
			setSaveStatus("error")
			setSaveError(msg)
		} finally {
			setSaving(false)
		}
	}, [tokens, onDone])

	const handleEditStep = useCallback((targetStep: number) => {
		setStep(targetStep)
	}, [])

	const currentStep = WIZARD_STEPS[step]
	const isLastStep = step === WIZARD_STEPS.length - 1

	if (!loaded) {
		return (
			<div className="flex flex-col h-full items-center justify-center">
				<span className="text-sm text-muted-foreground">Loading tokens...</span>
			</div>
		)
	}

	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center gap-2 px-4 py-3 border-b border-input">
				<button className="p-1 rounded hover:bg-input-background text-foreground" onClick={onDone}>
					<ArrowLeftIcon size={16} />
				</button>
				<h2 className="text-sm font-medium text-foreground">Token Configuration</h2>
			</div>

			<div className="flex items-center gap-1 px-4 py-2 border-b border-input">
				{WIZARD_STEPS.map((s, i) => {
					const canNavigate = hasExistingTokens || i <= step
					return (
						<button
							className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
								i === step
									? "bg-button-background text-button-foreground"
									: canNavigate
										? "text-button-background hover:underline"
										: "text-muted-foreground"
							}`}
							disabled={!canNavigate}
							key={s.id}
							onClick={() => canNavigate && setStep(i)}>
							{s.title}
						</button>
					)
				})}
			</div>

			<div className="flex-1 overflow-y-auto px-4 py-4">
				<div className="mb-4">
					<h3 className="text-sm font-medium text-foreground">
						Step {step + 1}: {currentStep.title}
					</h3>
					<p className="text-xs text-muted-foreground mt-0.5">{currentStep.description}</p>
				</div>

				{step === 0 && <VibeStep onChange={setTokens} tokens={tokens} />}
				{step === 1 && <ColorStep onChange={setTokens} tokens={tokens} />}
				{step === 2 && <TypographyStep onChange={setTokens} tokens={tokens} />}
				{step === 3 && <SpacingStep onChange={setTokens} tokens={tokens} />}
				{step === 4 && <RadiusStep onChange={setTokens} tokens={tokens} />}
				{step === 5 && <ReviewStep onEditStep={handleEditStep} tokens={tokens} />}

				{/* Live preview */}
				{step < 5 && (
					<div className="mt-6 pt-4 border-t border-input">
						<h4 className="text-xs font-medium text-muted-foreground mb-2">Live Preview</h4>
						<TokenPreview tokens={tokens} />
					</div>
				)}
			</div>

			<div className="flex flex-col gap-2 px-4 py-3 border-t border-input">
				{saveStatus === "success" && (
					<div
						className="text-xs text-center py-1.5 px-3 rounded-md"
						style={{ backgroundColor: "var(--vscode-testing-iconPassed, #22c55e)", color: "white" }}>
						Tokens saved successfully
					</div>
				)}
				{saveStatus === "error" && (
					<div
						className="text-xs text-center py-1.5 px-3 rounded-md"
						style={{ backgroundColor: "var(--vscode-testing-iconFailed, #ef4444)", color: "white" }}>
						{saveError || "Failed to save tokens"}
					</div>
				)}
				<div className="flex items-center justify-between">
					<Button disabled={step === 0} onClick={handleBack} variant="secondary">
						Back
					</Button>
					{isLastStep ? (
						<Button disabled={saving || saveStatus === "success"} onClick={handleSave}>
							{saving ? "Saving..." : saveStatus === "success" ? "Saved!" : "Save Tokens"}
						</Button>
					) : (
						<Button onClick={handleNext}>Next</Button>
					)}
				</div>
			</div>
		</div>
	)
}
