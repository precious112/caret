/**
 * Simple Logger utility for the extension's backend code.
 */
export class Logger {
	private static isVerbose = process.env.IS_DEV === "true"

	private static subscribers: Set<(msg: string) => void> = new Set()

	private static output(msg: string): void {
		for (const subscriber of Logger.subscribers) {
			try {
				subscriber(msg)
			} catch {
				// ignore errors from subscribers
			}
		}
	}

	/**
	 * Register a callback to receive log output messages.
	 */
	static subscribe(outputFn: (msg: string) => void) {
		Logger.subscribers.add(outputFn)
	}

	static error(message: string, ...args: any[]) {
		Logger.#output("ERROR", message, undefined, args)
	}

	static warn(message: string, ...args: any[]) {
		Logger.#output("WARN", message, undefined, args)
	}

	static log(message: string, ...args: any[]) {
		Logger.#output("LOG", message, undefined, args)
	}

	static debug(message: string, ...args: any[]) {
		Logger.#output("DEBUG", message, undefined, args)
	}

	static info(message: string, ...args: any[]) {
		Logger.#output("INFO", message, undefined, args)
	}

	static trace(message: string, ...args: any[]) {
		Logger.#output("TRACE", message, undefined, args)
	}

	static #output(level: string, message: string, error: Error | undefined, args: any[]) {
		try {
			let fullMessage = message
			// ERROR and WARN always carry their arguments. They used to be
			// verbose-only, so in any non-dev build `Logger.error("uncaught
			// exception:", err)` logged a bare label — a full certification run
			// died with that as its entire evidence. And an Error must not go
			// through JSON.stringify, which yields "{}": it gets its stack.
			const attach = args.length > 0 && (Logger.isVerbose || level === "ERROR" || level === "WARN")
			if (attach) {
				fullMessage += ` ${args
					.map((arg) => {
						if (arg instanceof Error) return arg.stack ?? String(arg)
						if (typeof arg === "string") return arg
						try {
							return JSON.stringify(arg)
						} catch {
							return String(arg)
						}
					})
					.join(" ")}`
			}
			const errorSuffix = error?.message ? ` ${error.message}` : ""
			Logger.output(`${level} ${fullMessage}${errorSuffix}`.trimEnd())
		} catch {
			// do nothing if Logger fails
		}
	}
}
