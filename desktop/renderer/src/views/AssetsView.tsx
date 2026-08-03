/**
 * The asset library.
 *
 * Two jobs, and the second is the one that matters. Getting files *in* is
 * ordinary (drop, or a native picker). Getting them **described** is the part
 * that makes `@tag` work: an agent placing an image needs to know it is dark and
 * wide with room top-left, and no amount of metadata about byte counts supplies
 * that. So the description field is the loudest thing on each row, and an
 * undescribed asset says so rather than looking finished.
 */
import { useCallback, useEffect, useRef, useState } from "react"

import type { AssetEntryWire, ProjectState } from "../../../shared/ipc"
import { invoke, on } from "../ipc"
import { cn } from "../lib/utils"

export function AssetsView({ project, onClose }: { project: ProjectState; onClose(): void }) {
	const [assets, setAssets] = useState<AssetEntryWire[]>([])
	const [dragging, setDragging] = useState(false)
	const [problems, setProblems] = useState<Array<{ file: string; reason: string }>>([])
	const [busy, setBusy] = useState(false)

	const refresh = useCallback(async () => {
		setAssets((await invoke("assets:list", project.path)) ?? [])
	}, [project.path])

	useEffect(() => {
		void refresh()
	}, [refresh])

	// Assets can arrive from an agent or from Finder, not only from this surface,
	// so the list follows the index rather than only its own writes.
	useEffect(
		() =>
			on("assets:changed", (changed) => {
				if (changed === project.path) void refresh()
			}),
		[project.path, refresh],
	)

	const add = useCallback(
		async (paths: string[]) => {
			if (paths.length === 0) return
			setBusy(true)
			try {
				const result = await invoke("assets:add", project.path, paths)
				setProblems(result?.rejected ?? [])
				await refresh()
			} finally {
				setBusy(false)
			}
		},
		[project.path, refresh],
	)

	const onDrop = useCallback(
		(event: React.DragEvent) => {
			event.preventDefault()
			setDragging(false)
			// Electron exposes the real path on the File object; without it there is
			// nothing for main to copy, since the renderer has no disk access.
			const paths = [...event.dataTransfer.files].map((file) => (file as File & { path?: string }).path ?? "")
			void add(paths.filter(Boolean))
		},
		[add],
	)

	const undescribed = assets.filter((asset) => !asset.description).length

	return (
		<div
			className="flex flex-1 flex-col overflow-hidden bg-shell-bg"
			data-testid="assets-view"
			onDragLeave={() => setDragging(false)}
			onDragOver={(event) => {
				event.preventDefault()
				setDragging(true)
			}}
			onDrop={onDrop}>
			<header className="flex items-center justify-between border-b border-shell-border px-8 py-4">
				<div>
					<h1 className="text-lg font-semibold">Assets</h1>
					<p className="text-sm text-shell-muted">
						{assets.length === 0
							? "Images, vectors, video and 3D models your agent can use by name."
							: `${assets.length} asset${assets.length === 1 ? "" : "s"}${undescribed > 0 ? ` · ${undescribed} still undescribed` : ""}`}
					</p>
				</div>
				<div className="flex gap-2">
					<button
						className="rounded-md bg-caret-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
						data-testid="assets-add"
						disabled={busy}
						onClick={async () => add((await invoke("assets:pickFiles")) ?? [])}
						type="button">
						Add files
					</button>
					<button className="rounded-md border border-shell-border px-3 py-1.5 text-sm" onClick={onClose} type="button">
						Done
					</button>
				</div>
			</header>

			{problems.length > 0 && (
				<div className="border-b border-shell-border bg-amber-500/10 px-8 py-3 text-sm">
					{problems.map((problem) => (
						<p key={problem.file}>
							<span className="font-medium">{problem.file}</span> — {problem.reason}
						</p>
					))}
				</div>
			)}

			<div className={cn("flex-1 overflow-y-auto px-8 py-6", dragging && "bg-caret-accent/5")}>
				{assets.length === 0 ? (
					<div className="mx-auto mt-16 max-w-md text-center text-shell-muted">
						<p className="text-sm">Drop files here, or use Add files.</p>
						<p className="mt-2 text-xs">
							Everything you add is copied into <code>.caret/assets/</code> and versioned with the design, so it
							travels with the project.
						</p>
					</div>
				) : (
					<ul className="mx-auto flex max-w-3xl flex-col gap-3">
						{assets.map((asset) => (
							<AssetRow
								asset={asset}
								canvasUrl={project.canvasUrl}
								key={asset.tag}
								onChanged={refresh}
								projectPath={project.path}
							/>
						))}
					</ul>
				)}
			</div>
		</div>
	)
}

function AssetRow({
	asset,
	projectPath,
	canvasUrl,
	onChanged,
}: {
	asset: AssetEntryWire
	projectPath: string
	canvasUrl: string | null
	onChanged(): void | Promise<void>
}) {
	const [tag, setTag] = useState(asset.tag)
	const [description, setDescription] = useState(asset.description)
	const [alt, setAlt] = useState(asset.alt)
	const [error, setError] = useState<string | null>(null)

	// The index is the source of truth: an agent describing this asset while the
	// row is open should not be overwritten by stale local state.
	const dirty = useRef(false)
	useEffect(() => {
		if (dirty.current) return
		setTag(asset.tag)
		setDescription(asset.description)
		setAlt(asset.alt)
	}, [asset.tag, asset.description, asset.alt])

	const commitTag = async () => {
		dirty.current = false
		if (tag === asset.tag) return
		const result = await invoke("assets:retag", projectPath, asset.tag, tag)
		if (result?.ok) {
			setError(null)
			await onChanged()
		} else {
			setError(result?.error ?? "Could not rename.")
			setTag(asset.tag)
		}
	}

	const commitText = async () => {
		dirty.current = false
		if (description === asset.description && alt === asset.alt) return
		await invoke("assets:describe", projectPath, asset.tag, { alt, description })
		await onChanged()
	}

	return (
		<li className="flex gap-4 rounded-lg border border-shell-border p-3" data-testid="asset-row">
			<Thumbnail asset={asset} canvasUrl={canvasUrl} />

			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<div className="flex items-center gap-2">
					<span className="text-shell-muted">@</span>
					<input
						className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
						data-testid="asset-tag"
						onBlur={commitTag}
						onChange={(event) => {
							dirty.current = true
							setTag(event.target.value)
						}}
						onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
						value={tag}
					/>
					<span className="shrink-0 text-xs text-shell-muted">
						{asset.width && asset.height ? `${asset.width}×${asset.height}` : asset.kind}
						{" · "}
						{formatBytes(asset.bytes)}
						{asset.origin === "generated" ? " · generated" : ""}
					</span>
					<button
						className="shrink-0 text-xs text-shell-muted hover:text-red-400"
						onClick={async () => {
							await invoke("assets:remove", projectPath, asset.tag)
							await onChanged()
						}}
						type="button">
						Remove
					</button>
				</div>

				<input
					className={cn(
						"w-full rounded border bg-transparent px-2 py-1 text-sm outline-none",
						description ? "border-shell-border" : "border-amber-500/40",
					)}
					data-testid="asset-description"
					onBlur={commitText}
					onChange={(event) => {
						dirty.current = true
						setDescription(event.target.value)
					}}
					placeholder="What does it look like? e.g. wide, dark, empty space top-left"
					value={description}
				/>

				<input
					className="w-full rounded border border-shell-border bg-transparent px-2 py-1 text-xs outline-none"
					data-testid="asset-alt"
					onBlur={commitText}
					onChange={(event) => {
						dirty.current = true
						setAlt(event.target.value)
					}}
					placeholder="Alt text"
					value={alt}
				/>

				{error && <p className="text-xs text-red-400">{error}</p>}
			</div>
		</li>
	)
}

/**
 * Only image and vector assets can show themselves.
 *
 * Video and 3D get a labelled placeholder rather than a broken `<img>` — the
 * poster-frame and rendered-still work is real and not pretended at here.
 *
 * The src is absolute against the design server. This chrome is not served by
 * Vite, so the `/caret-assets/…` path the index records would resolve against
 * the chrome's own origin and silently 404.
 */
function Thumbnail({ asset, canvasUrl }: { asset: AssetEntryWire; canvasUrl: string | null }) {
	const previewable = asset.kind === "image" || asset.kind === "vector"
	const src = canvasUrl ? new URL(asset.url, canvasUrl).toString() : null

	return (
		<div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded border border-shell-border bg-black/20">
			{previewable && src ? (
				<img alt={asset.alt || asset.tag} className="max-h-full max-w-full object-contain" src={src} />
			) : (
				<span className="text-xs uppercase tracking-wide text-shell-muted">{previewable ? "loading" : asset.kind}</span>
			)}
		</div>
	)
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
