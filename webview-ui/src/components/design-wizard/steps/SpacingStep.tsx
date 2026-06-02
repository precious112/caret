import { useCallback } from "react"
import type { FoundationTokensDraft } from "../TokenWizard"

type Props = {
	tokens: FoundationTokensDraft
	onChange: (tokens: FoundationTokensDraft) => void
}

export function SpacingStep({ tokens, onChange }: Props) {
	const handleBaseUnitChange = useCallback(
		(baseUnit: 4 | 8) => {
			const scale = baseUnit === 4 ? [0, 1, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64] : [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48]
			onChange({ ...tokens, spacing: { baseUnit, scale } })
		},
		[tokens, onChange],
	)

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-2">
				<label className="text-sm font-medium text-foreground">Base Unit</label>
				<div className="flex gap-3">
					{([4, 8] as const).map((unit) => (
						<button
							className={`px-4 py-2 text-sm rounded-md border transition-colors ${
								tokens.spacing.baseUnit === unit
									? "border-button-background bg-button-background text-button-foreground"
									: "border-input bg-input-background text-foreground hover:bg-input-background/80"
							}`}
							key={unit}
							onClick={() => handleBaseUnitChange(unit)}>
							{unit}px
						</button>
					))}
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<label className="text-xs font-medium text-muted-foreground">Scale Preview</label>
				<div className="flex flex-col gap-2">
					{tokens.spacing.scale.map((multiplier) => {
						const px = multiplier * tokens.spacing.baseUnit
						return (
							<div className="flex items-center gap-3" key={multiplier}>
								<span className="text-[10px] text-muted-foreground w-6 text-right">{multiplier}</span>
								<div
									className="h-3 rounded-sm bg-button-background/60"
									style={{ width: `${Math.min(px, 200)}px` }}
								/>
								<span className="text-[10px] text-muted-foreground">{px}px</span>
							</div>
						)
					})}
				</div>
			</div>
		</div>
	)
}
