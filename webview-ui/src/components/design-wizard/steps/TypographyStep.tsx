import { useCallback, useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { DesignServiceClient } from "@/services/grpc-client"
import { TYPE_SCALE_RATIOS } from "../data-steps"
import type { FoundationTokensDraft } from "../TokenWizard"

type Props = {
	tokens: FoundationTokensDraft
	onChange: (tokens: FoundationTokensDraft) => void
}

type FontResult = { family: string; category: string; variants: string[] }

export function TypographyStep({ tokens, onChange }: Props) {
	const [fontSearch, setFontSearch] = useState("")
	const [fontResults, setFontResults] = useState<FontResult[]>([])
	const [showDropdown, setShowDropdown] = useState(false)
	const dropdownRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setShowDropdown(false)
			}
		}
		document.addEventListener("mousedown", handleClickOutside)
		return () => document.removeEventListener("mousedown", handleClickOutside)
	}, [])

	useEffect(() => {
		const timeout = setTimeout(async () => {
			try {
				const response = await DesignServiceClient.searchGoogleFonts({ value: fontSearch })
				setFontResults(response.fonts)
			} catch (e) {
				console.error("Font search failed:", e)
			}
		}, 300)
		return () => clearTimeout(timeout)
	}, [fontSearch])

	const selectFont = useCallback(
		(family: string) => {
			onChange({ ...tokens, typography: { ...tokens.typography, fontFamily: family } })
			setFontSearch("")
			setShowDropdown(false)
		},
		[tokens, onChange],
	)

	const handleRatioChange = useCallback(
		(ratio: number) => {
			onChange({ ...tokens, typography: { ...tokens.typography, scaleRatio: ratio } })
		},
		[tokens, onChange],
	)

	const handleBaseSizeChange = useCallback(
		(size: number) => {
			onChange({ ...tokens, typography: { ...tokens.typography, baseSize: size } })
		},
		[tokens, onChange],
	)

	const previewSizes = generatePreviewSizes(tokens.typography.baseSize, tokens.typography.scaleRatio)

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-2">
				<label className="text-sm font-medium text-foreground">Font Family</label>
				<div className="relative" ref={dropdownRef}>
					<Input
						onChange={(e) => {
							setFontSearch(e.target.value)
							setShowDropdown(true)
						}}
						onFocus={() => setShowDropdown(true)}
						placeholder="Search fonts..."
						value={fontSearch || tokens.typography.fontFamily}
					/>
					{showDropdown && fontResults.length > 0 && (
						<div
							className="absolute z-10 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-input shadow-md"
							style={{
								backgroundColor:
									"var(--vscode-editorWidget-background, var(--vscode-dropdown-background, var(--vscode-editor-background)))",
							}}>
							{fontResults.map((font) => (
								<button
									className="w-full px-3 py-2 text-left text-sm text-foreground"
									key={font.family}
									onClick={() => selectFont(font.family)}
									onMouseEnter={(e) =>
										(e.currentTarget.style.backgroundColor = "var(--vscode-list-hoverBackground)")
									}
									onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}>
									<span className="font-medium">{font.family}</span>
									<span className="ml-2 text-xs text-muted-foreground">{font.category}</span>
								</button>
							))}
						</div>
					)}
				</div>
				<span className="text-xs text-muted-foreground">
					Current: <strong>{tokens.typography.fontFamily}</strong>
				</span>
			</div>

			<div className="flex flex-col gap-2">
				<label className="text-sm font-medium text-foreground">Base Size</label>
				<div className="flex items-center gap-3">
					<Input
						className="w-20"
						max={24}
						min={12}
						onChange={(e) => handleBaseSizeChange(Number(e.target.value))}
						type="number"
						value={tokens.typography.baseSize}
					/>
					<span className="text-xs text-muted-foreground">px</span>
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<label className="text-sm font-medium text-foreground">Scale Ratio</label>
				<div className="flex flex-wrap gap-2">
					{TYPE_SCALE_RATIOS.map(({ label, value }) => (
						<button
							className={`px-2 py-1 text-xs rounded-md border transition-colors ${
								tokens.typography.scaleRatio === value
									? "border-button-background bg-button-background text-button-foreground"
									: "border-input bg-input-background text-foreground hover:bg-input-background/80"
							}`}
							key={value}
							onClick={() => handleRatioChange(value)}>
							{label}
						</button>
					))}
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<label className="text-xs font-medium text-muted-foreground">Scale Preview</label>
				<div className="flex flex-col gap-1">
					{previewSizes.map(({ label, size }) => (
						<div className="flex items-baseline gap-3" key={label}>
							<span className="text-[10px] text-muted-foreground w-8">{label}</span>
							<span className="text-foreground" style={{ fontSize: `${Math.min(size, 36)}px` }}>
								Aa
							</span>
							<span className="text-[10px] text-muted-foreground">{size}px</span>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}

function generatePreviewSizes(baseSize: number, ratio: number): Array<{ label: string; size: number }> {
	const labels = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl"]
	const baseIndex = 2
	return labels.map((label, i) => ({
		label,
		size: Math.round(baseSize * ratio ** (i - baseIndex) * 100) / 100,
	}))
}
