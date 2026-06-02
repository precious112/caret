import { useCallback, useState } from "react"
import { DesignServiceClient } from "@/services/grpc-client"
import { NEUTRAL_CHARACTERS, type NeutralCharacter } from "../data-steps"
import type { FoundationTokensDraft } from "../TokenWizard"

type Props = {
	tokens: FoundationTokensDraft
	onChange: (tokens: FoundationTokensDraft) => void
}

export function ColorStep({ tokens, onChange }: Props) {
	const [generating, setGenerating] = useState(false)

	const handleBrandColorChange = useCallback(
		async (seed: string) => {
			onChange({
				...tokens,
				color: { ...tokens.color, brand: { ...tokens.color.brand, seed } },
			})

			setGenerating(true)
			try {
				const response = await DesignServiceClient.generateTokenScale({
					type: "color",
					seedValue: seed,
					optionsJson: JSON.stringify({ steps: 11 }),
				})
				const scale = JSON.parse(response.scaleJson)
				onChange({
					...tokens,
					color: { ...tokens.color, brand: { seed, scale } },
				})
			} catch (e) {
				console.error("Failed to generate color scale:", e)
			} finally {
				setGenerating(false)
			}
		},
		[tokens, onChange],
	)

	const handleNeutralChange = useCallback(
		(character: NeutralCharacter) => {
			onChange({
				...tokens,
				color: { ...tokens.color, neutral: { ...tokens.color.neutral, character } },
			})
		},
		[tokens, onChange],
	)

	const handleSemanticChange = useCallback(
		(key: string, value: string) => {
			onChange({
				...tokens,
				color: {
					...tokens.color,
					semantic: { ...tokens.color.semantic, [key]: value },
				},
			})
		},
		[tokens, onChange],
	)

	const scaleEntries = Object.entries(tokens.color.brand.scale || {})

	const handleHexInput = useCallback(
		(raw: string) => {
			let hex = raw.trim()
			if (!hex.startsWith("#")) hex = "#" + hex
			if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
				handleBrandColorChange(hex)
			}
		},
		[handleBrandColorChange],
	)

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-2">
				<label className="text-sm font-medium text-foreground">Brand Color</label>
				<div className="flex items-center gap-3">
					<input
						className="w-10 h-10 rounded border border-input cursor-pointer"
						onChange={(e) => handleBrandColorChange(e.target.value)}
						type="color"
						value={tokens.color.brand.seed}
					/>
					<input
						className="w-24 px-2 py-1 text-sm font-mono rounded border border-input bg-input-background text-foreground"
						defaultValue={tokens.color.brand.seed}
						key={tokens.color.brand.seed}
						onBlur={(e) => handleHexInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") handleHexInput(e.currentTarget.value)
						}}
						placeholder="#000000"
					/>
					{generating && <span className="text-xs text-muted-foreground">Generating scale...</span>}
				</div>
			</div>

			{scaleEntries.length > 0 && (
				<div className="flex flex-col gap-2">
					<label className="text-xs font-medium text-muted-foreground">Brand Scale</label>
					<div className="flex gap-1">
						{scaleEntries.map(([step, color]) => (
							<div className="flex flex-col items-center gap-1" key={step}>
								<div
									className="w-6 h-6 rounded-sm border border-input"
									style={{ backgroundColor: color as string }}
								/>
								<span className="text-[9px] text-muted-foreground">{step}</span>
							</div>
						))}
					</div>
				</div>
			)}

			<div className="flex flex-col gap-2">
				<label className="text-sm font-medium text-foreground">Neutral Character</label>
				<div className="flex gap-2">
					{NEUTRAL_CHARACTERS.map((char) => (
						<button
							className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
								tokens.color.neutral.character === char
									? "border-button-background bg-button-background text-button-foreground"
									: "border-input bg-input-background text-foreground hover:bg-input-background/80"
							}`}
							key={char}
							onClick={() => handleNeutralChange(char)}>
							{char}
						</button>
					))}
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<label className="text-sm font-medium text-foreground">Semantic Colors</label>
				<div className="grid grid-cols-2 gap-3">
					{(["success", "warning", "error", "info"] as const).map((key) => (
						<div className="flex items-center gap-2" key={key}>
							<input
								className="w-7 h-7 rounded border border-input cursor-pointer"
								onChange={(e) => handleSemanticChange(key, e.target.value)}
								type="color"
								value={tokens.color.semantic[key]}
							/>
							<span className="text-xs text-foreground capitalize">{key}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}
