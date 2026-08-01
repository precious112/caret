/**
 * The local MCP server — one per open project.
 *
 * Plain Node `http` rather than express, because the only thing being served is
 * a single MCP endpoint behind an auth check and adding a framework for that
 * would be adding a dependency for nothing.
 *
 * Port 0 means the OS assigns, and the assignment is written into the project's
 * own `.caret/.mcp.json`. That is what lets several projects be open at once and
 * what makes a client config point at a *project* rather than at a machine.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http"
import type { AddressInfo } from "net"

import { type AgentBridge, type AgentTask, NullBridge, setProjectBridge } from "../../../src/core/design"
import { Logger } from "../../../src/shared/services/Logger"
import { authorize, generateToken } from "./auth"
import { clearDiscovery, writeDiscovery } from "./discovery"
import { logToolError, TOOLS, type ToolContext } from "./tools"

const MCP_PATH = "/mcp"

/** Requests larger than this are refused rather than buffered. */
const MAX_BODY_BYTES = 8 * 1024 * 1024

export interface CaretMcpServerOptions {
	projectPath: string
	/** Fired when an agent connects or disconnects, so the UI can reflect it. */
	onAgentConnectionChanged?(connected: boolean): void
	/** Captures a page screenshot from the running canvas. */
	screenshot?(pageId: string): Promise<string | null>
	/** Surfaces an outbound agent task (sync, visual edit) to the user. */
	onAgentTask?(task: AgentTask): void
}

export class CaretMcpServer {
	private http: Server | null = null
	private mcp: McpServer | null = null
	private transport: StreamableHTTPServerTransport | null = null
	private token = generateToken()
	private port: number | null = null
	private connected = false

	/** Tasks handed out but not yet picked up by an agent. */
	private queue: AgentTask[] = []

	constructor(private readonly options: CaretMcpServerOptions) {}

	getUrl(): string | null {
		return this.port === null ? null : `http://127.0.0.1:${this.port}${MCP_PATH}`
	}

	getToken(): string {
		return this.token
	}

	hasConnectedAgent(): boolean {
		return this.connected
	}

	/** Tasks waiting for the agent to collect. Drains on read. */
	takePendingTasks(): AgentTask[] {
		const taken = this.queue
		this.queue = []
		return taken
	}

	async start(): Promise<void> {
		if (this.http) return

		this.mcp = new McpServer({ name: "caret", version: "0.1.0" })
		this.registerTools(this.mcp)

		// No session id: each request is independent, which suits an agent that
		// may reconnect between turns without losing anything.
		this.transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
		await this.mcp.connect(this.transport)

		this.http = createServer((req, res) => void this.handleRequest(req, res))

		await new Promise<void>((resolve, reject) => {
			this.http?.once("error", reject)
			// Bound to loopback explicitly — the default would listen on every
			// interface and expose a file-writing server to the local network.
			this.http?.listen(0, "127.0.0.1", resolve)
		})

		this.port = (this.http.address() as AddressInfo).port

		await writeDiscovery(this.options.projectPath, {
			version: 1,
			url: this.getUrl() as string,
			port: this.port,
			token: this.token,
			project: this.options.projectPath,
			pid: process.pid,
			startedAt: new Date().toISOString(),
		})

		// Until an agent actually talks to us, every feature that needs one must
		// refuse honestly rather than appear to work.
		setProjectBridge(this.options.projectPath, this.createBridge())

		Logger.info(`[mcp] serving ${this.options.projectPath} on ${this.getUrl()}`)
	}

	async stop(): Promise<void> {
		setProjectBridge(this.options.projectPath, new NullBridge())
		await clearDiscovery(this.options.projectPath)
		await this.mcp?.close().catch(() => {})
		await new Promise<void>((resolve) => {
			if (!this.http) return resolve()
			this.http.close(() => resolve())
		})
		this.http = null
		this.mcp = null
		this.transport = null
		this.port = null
		this.setConnected(false)
	}

	private createBridge(): AgentBridge {
		const server = this
		return {
			connected: () => server.connected,
			async request(task: AgentTask) {
				if (!server.connected) {
					const { NoAgentConnectedError } = await import("../../../src/core/design")
					throw new NoAgentConnectedError(task.kind)
				}
				server.queue.push(task)
				server.options.onAgentTask?.(task)
			},
		}
	}

	private registerTools(mcp: McpServer): void {
		const ctx: ToolContext = {
			projectPath: this.options.projectPath,
			screenshot: (pageId) => this.options.screenshot?.(pageId) ?? Promise.resolve(null),
		}

		for (const tool of TOOLS) {
			mcp.registerTool(
				tool.name,
				{ title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
				(async (args: unknown) => {
					this.setConnected(true)
					try {
						return await tool.handler(ctx, args)
					} catch (err) {
						return logToolError(tool.name, err)
					}
				}) as never,
			)
		}
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`)

		if (url.pathname !== MCP_PATH) {
			res.writeHead(404).end()
			return
		}

		const auth = authorize(req, this.token)
		if (!auth.ok) {
			Logger.warn(`[mcp] refused a request: ${auth.reason}`)
			res.writeHead(auth.status, { "content-type": "application/json" })
			res.end(JSON.stringify({ error: auth.reason }))
			return
		}

		let body: unknown
		try {
			body = await readJsonBody(req)
		} catch (err) {
			res.writeHead(400, { "content-type": "application/json" })
			res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Malformed request body" }))
			return
		}

		this.setConnected(true)
		try {
			await this.transport?.handleRequest(req, res, body)
		} catch (err) {
			Logger.error("[mcp] request handling failed:", err)
			if (!res.headersSent) res.writeHead(500).end()
		}
	}

	private setConnected(connected: boolean): void {
		if (this.connected === connected) return
		this.connected = connected
		Logger.info(`[mcp] agent ${connected ? "connected" : "disconnected"}`)
		this.options.onAgentConnectionChanged?.(connected)
	}
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		if (req.method === "GET" || req.method === "DELETE") return resolve(undefined)

		const chunks: Buffer[] = []
		let size = 0

		req.on("data", (chunk: Buffer) => {
			size += chunk.length
			if (size > MAX_BODY_BYTES) {
				reject(new Error("Request body too large"))
				req.destroy()
				return
			}
			chunks.push(chunk)
		})
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf-8")
			if (!raw) return resolve(undefined)
			try {
				resolve(JSON.parse(raw))
			} catch {
				reject(new Error("Request body is not valid JSON"))
			}
		})
		req.on("error", reject)
	})
}
