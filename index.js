/**
 * dsh-plugin-notify — Host half.
 *
 * Watches session state on the Host and, for every interesting transition,
 * delivers the same notification through two independent channels:
 *
 *   1. **WxPusher** — an HTTPS push to `wxpusher.zjiecode.com` (appToken +
 *      UID/topic receivers), so the message reaches a phone.
 *   2. **Browser notification** — a Server-Sent Events frame on
 *      `/dsh-plugin-notify/events`, which the Client half turns into a real
 *      `new Notification(...)` with sound and `requireInteraction`.
 *
 * Detection lives here once, so both channels always carry the same payload.
 * The events observed are the Host's own:
 *
 *   - `api-session/status`  running → false  ⇒ the session stopped working
 *   - `api-session/error`   an Agent failed outside a durable turn position
 *   - `agent/error`         a step or turn errored
 *   - `user-questions/request`  the agent asked the user something
 *   - `approval/request`        the agent is waiting for an approval decision
 *
 * Every Config field is `volatile`, so the settings page edits apply live: the
 * Loader commits volatile-only changes into the running fiber's references
 * without re-running `apply`, and this module re-reads those references on
 * every read (`plain()`).
 *
 * @module dsh-plugin-notify
 */

import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Cordis plugin name; also the Client entry id and the settings entry id. */
export const name = 'dsh-plugin-notify';

/** Session store: the plugin waits for it before it starts observing. */
export const inject = ['sessions'];

/** Browser-notification SSE endpoint (absolute; the page asks it document-relative). */
const ROUTE_EVENTS = '/dsh-plugin-notify/events';
/** Test endpoint: broadcasts one frame and pushes one WxPusher message. */
const ROUTE_TEST = '/dsh-plugin-notify/test';
/** WxPusher "send message" API. */
const WXPUSHER_ENDPOINT = 'https://wxpusher.zjiecode.com/api/send/message';
/** Registered symbol cosmokit uses for its volatile config references. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');
/** SSE keep-alive cadence. */
const HEARTBEAT_MS = 25_000;
/** Window in which a second error notification for one session is dropped. */
const ERROR_DEDUPE_MS = 5_000;

//#region schema module resolution

/**
 * Locate the shared `@deepseek-ai/schemastery` ESM entry.
 *
 * A bundle installed with `link:` keeps its own path, so a plain bare import
 * only resolves when the package carries a local `node_modules`. Probe the
 * deployment's own resolution roots first (the bundle's own tree, the profile,
 * `$DSH_HOME`, and the running CLI) and fall back to the bare specifier.
 *
 * @returns A module URL string, or the bare specifier when nothing resolved.
 */
function schemaModuleUrl() {
	const bases = [];
	// The running CLI, through its symlink: `dsh` on PATH is a link into the
	// installation whose `node_modules` holds the shared schemastery.
	for (const argv of [process.argv[1]]) {
		if (argv === undefined) continue;
		try {
			bases.push(realpathSync(argv));
		} catch {
			bases.push(argv);
		}
	}
	if (process.env.DSH_PROFILE_DIR) bases.push(join(process.env.DSH_PROFILE_DIR, 'package.json'));
	if (process.env.DSH_HOME) bases.push(join(process.env.DSH_HOME, 'package.json'));
	// The bundle's own tree last: a `link:` install has no local dependencies,
	// while a registry install resolves here through the hoisted store.
	bases.push(import.meta.url);
	for (const base of bases) {
		try {
			const manifest = createRequire(base).resolve('@deepseek-ai/schemastery/package.json');
			const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
			const entry = pkg.exports?.['.']?.import ?? pkg.module ?? pkg.main ?? 'index.js';
			return pathToFileURL(join(dirname(manifest), entry)).href;
		} catch {
			// Try the next resolution root.
		}
	}
	return '@deepseek-ai/schemastery';
}

const Schema = (await import(schemaModuleUrl())).default;

//#endregion

//#region Config

/**
 * Plugin configuration. Every leaf is `volatile()`, which is what makes it
 * both editable from 设置 → 通知 and applied live without remounting.
 */
export const Config = Schema.object({
	/** Master switch for both channels. */
	enabled: Schema.boolean().default(true).description('总开关 / Master switch').volatile(),
	/** Which session transitions notify. */
	events: Schema.object({
		/** The session stopped working (agent went idle). */
		stopped: Schema.boolean().default(true).description('会话停止').volatile(),
		/** The session exited with an error. */
		error: Schema.boolean().default(true).description('因错误退出').volatile(),
		/** The agent asked the user a question. */
		question: Schema.boolean().default(true).description('收到提问').volatile(),
		/** The agent is waiting for an approval decision. */
		approval: Schema.boolean().default(false).description('等待授权').volatile(),
	}),
	/** Browser notification presentation. */
	browser: Schema.object({
		/** Show browser notifications at all. */
		enabled: Schema.boolean().default(true).description('浏览器通知').volatile(),
		/** Play a short chime with each notification. */
		sound: Schema.boolean().default(true).description('提示音').volatile(),
		/** Keep the notification on screen until the user dismisses it. */
		requireInteraction: Schema.boolean().default(true).description('需要手动关闭').volatile(),
		/** Only notify while the page is in a background tab. */
		onlyWhenHidden: Schema.boolean().default(true).description('仅页面不可见时').volatile(),
	}),
	/** WxPusher push. */
	wxpusher: Schema.object({
		/** Enable the WxPusher channel. */
		enabled: Schema.boolean().default(false).description('WxPusher 推送').volatile(),
		/** WxPusher appToken; write-only, never returned over the wire. */
		appToken: Schema.string().role('secret').default('').description('appToken').volatile(),
		/** Receiving UIDs (`UID_xxxxxxxx`). */
		uids: Schema.array(Schema.string()).default([]).description('UID 列表').volatile(),
		/** Receiving topic ids (主题 ID). */
		topicIds: Schema.array(Schema.number()).default([]).description('主题 ID 列表').volatile(),
		/** Optional URL a WxPusher message opens. */
		url: Schema.string().default('').description('点击跳转 URL').volatile(),
	}),
	/** Detection tuning. */
	advanced: Schema.object({
		/** Wait this long after a session goes idle before reporting it as stopped. */
		stopDebounceMs: Schema.number().default(1200).description('停止去抖 (ms)').volatile(),
		/** Ignore runs shorter than this (a quick turn is not worth a push). */
		minRunMs: Schema.number().default(2000).description('最短运行时长 (ms)').volatile(),
		/** Skip subagent sessions and keep only root sessions. */
		rootSessionsOnly: Schema.boolean().default(true).description('仅根会话').volatile(),
		/** Include the folded session title in the notification. */
		includeSessionTitle: Schema.boolean().default(true).description('包含会话标题').volatile(),
		/** Truncate the detail (error text, question text) to this many characters. */
		maxDetailChars: Schema.number().default(300).description('详情截断长度').volatile(),
	}),
});

//#endregion

//#region value helpers

/**
 * Deeply unwrap cosmokit volatile config references into plain JSON values.
 *
 * @param value - A parsed config value, possibly holding volatile references.
 * @returns The plain snapshot.
 */
function plain(value) {
	if (value !== null && typeof value === 'object' && VOLATILE_WRITE in value) return plain(value.get());
	if (Array.isArray(value)) return value.map(plain);
	if (value !== null && typeof value === 'object') {
		const out = {};
		for (const [key, child] of Object.entries(value)) out[key] = plain(child);
		return out;
	}
	return value;
}

/** Short, readable session handle used when a title is unavailable. */
function shortId(sessionId) {
	return String(sessionId).replace(/^session-/, '').slice(0, 8);
}

/** Escape text for WxPusher's HTML content body. */
function escapeHtml(text) {
	return String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

/** Chinese channel copy for WxPusher (the WxPusher audience is the phone). */
const WXPUSHER_LABEL = {
	stopped: '会话已停止',
	error: '会话出错',
	question: '收到提问',
	approval: '等待授权',
	test: '测试通知',
};

//#endregion

/**
 * Host plugin body.
 *
 * @param ctx - Host plugin context carrying `sessions`.
 * @param config - Resolved plugin Config (volatile leaves are references).
 */
export function apply(ctx, config) {
	/** Live SSE responses. */
	const clients = new Set();
	/** sessionId → epoch ms the current run started. */
	const runStartedAt = new Map();
	/** sessionId → pending stopped-notification timer. */
	const stopTimers = new Map();
	/** sessionId → epoch ms of the last error notification. */
	const lastErrorAt = new Map();
	/** Monotonic frame id. */
	let seq = 0;

	const settings = () => {
		const raw = plain(config) ?? {};
		return {
			enabled: raw.enabled !== false,
			events: {
				stopped: raw.events?.stopped !== false,
				error: raw.events?.error !== false,
				question: raw.events?.question !== false,
				approval: raw.events?.approval === true,
			},
			browser: {
				enabled: raw.browser?.enabled !== false,
				sound: raw.browser?.sound !== false,
				requireInteraction: raw.browser?.requireInteraction !== false,
				onlyWhenHidden: raw.browser?.onlyWhenHidden !== false,
			},
			wxpusher: {
				enabled: raw.wxpusher?.enabled === true,
				appToken: typeof raw.wxpusher?.appToken === 'string' ? raw.wxpusher.appToken.trim() : '',
				uids: (raw.wxpusher?.uids ?? []).filter((uid) => typeof uid === 'string' && uid.trim() !== '').map((uid) => uid.trim()),
				topicIds: (raw.wxpusher?.topicIds ?? []).filter((id) => typeof id === 'number' && Number.isFinite(id)),
				url: typeof raw.wxpusher?.url === 'string' ? raw.wxpusher.url.trim() : '',
			},
			advanced: {
				stopDebounceMs: Math.max(0, Number(raw.advanced?.stopDebounceMs) || 0),
				minRunMs: Math.max(0, Number(raw.advanced?.minRunMs) || 0),
				rootSessionsOnly: raw.advanced?.rootSessionsOnly !== false,
				includeSessionTitle: raw.advanced?.includeSessionTitle !== false,
				maxDetailChars: Math.max(40, Number(raw.advanced?.maxDetailChars) || 300),
			},
		};
	};

	/** The live session, or undefined once it left the store. */
	const sessionOf = (sessionId) => ctx.sessions.get(sessionId);

	/** Whether a session is a delegated child rather than a root conversation. */
	function isSubagentSession(sessionId) {
		const header = sessionOf(sessionId)?.header;
		return header?.origin === 'subagent' || header?.parentSession !== undefined;
	}

	/** Fold the session title when the deployment provides the title service. */
	function titleOf(sessionId) {
		const session = sessionOf(sessionId);
		if (session === undefined) return '';
		try {
			return ctx.get('sessionTitle')?.get(session)?.title ?? '';
		} catch {
			return '';
		}
	}

	/** Truncate one line of detail to the configured budget. */
	function trimDetail(detail, limit) {
		const text = String(detail ?? '').replace(/\s+/g, ' ').trim();
		return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
	}

	//#region delivery

	/** Write one SSE frame to every subscribed page. */
	function broadcast(frame) {
		const payload = `data: ${JSON.stringify(frame)}\n\n`;
		for (const response of [...clients]) {
			try {
				response.write(payload);
			} catch {
				clients.delete(response);
			}
		}
	}

	/**
	 * Compose one notification frame.
	 *
	 * @param kind - `stopped` | `error` | `question` | `approval` | `test`.
	 * @param sessionId - Session the frame belongs to, or undefined for a test.
	 * @param detail - Event detail text (error message, question, tool name).
	 * @param overrides - Per-frame delivery overrides (used by the test frame).
	 * @returns The frame to broadcast and push.
	 */
	function buildFrame(kind, sessionId, detail, overrides = {}) {
		const current = settings();
		const sessionTitle = sessionId !== undefined && current.advanced.includeSessionTitle ? titleOf(sessionId) : '';
		return {
			id: ++seq,
			kind,
			time: Date.now(),
			sessionId: sessionId === undefined ? null : String(sessionId),
			sessionTitle,
			detail: trimDetail(detail, current.advanced.maxDetailChars),
			tag: sessionId === undefined ? `dsh-notify-${kind}` : `dsh-notify-${String(sessionId)}`,
			browser: {
				...current.browser,
				...overrides.browser,
			},
			wxpusher: {
				...current.wxpusher,
				...overrides.wxpusher,
			},
		};
	}

	/**
	 * Push one frame to WxPusher.
	 *
	 * @param frame - Composed notification frame.
	 * @param options - `{ force?: boolean }` ignores the enable switch (test).
	 * @returns A short human-readable report for the test endpoint.
	 */
	async function pushWxPusher(frame, options = {}) {
		const channel = frame.wxpusher;
		if (!options.force && !channel.enabled) return { status: 'disabled' };
		if (!channel.appToken) return { status: 'no-token' };
		if (channel.uids.length === 0 && channel.topicIds.length === 0) return { status: 'no-receiver' };
		const label = WXPUSHER_LABEL[frame.kind] ?? frame.kind;
		const heading = frame.sessionTitle ? `${label} · ${frame.sessionTitle}` : label;
		const body = frame.detail
			? `<p style="margin:0 0 8px;line-height:1.6">${escapeHtml(frame.detail)}</p>`
			: '';
		const content = [
			`<h3 style="margin:0 0 8px">${escapeHtml(heading)}</h3>`,
			body,
			`<p style="margin:0;color:#999;font-size:12px">${new Date(frame.time).toLocaleString()}${
				frame.sessionId ? ` · ${escapeHtml(shortId(frame.sessionId))}` : ''
			}</p>`,
		].join('');
		const payload = {
			appToken: channel.appToken,
			contentType: 1,
			content,
			summary: `${heading}${frame.detail ? ` ${frame.detail}` : ''}`.slice(0, 100),
			uids: channel.uids,
			...(channel.topicIds.length > 0 ? { topicIds: channel.topicIds } : {}),
			...(channel.url ? { url: channel.url } : {}),
		};
		try {
			const response = await fetch(WXPUSHER_ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(15_000),
			});
			const answer = await response.json().catch(() => null);
			if (!response.ok || answer === null || answer.code !== 1000) {
				const message = answer?.msg ?? `HTTP ${response.status}`;
				ctx.logger.warn('dsh-plugin-notify: WxPusher push refused: %s', message);
				return { status: 'failed', message: String(message) };
			}
			return { status: 'sent' };
		} catch (error) {
			ctx.logger.warn('dsh-plugin-notify: WxPusher push failed: %s', error?.message ?? error);
			return { status: 'error', message: String(error?.message ?? error) };
		}
	}

	/**
	 * Deliver one notification on both channels.
	 *
	 * @param kind - Notification kind.
	 * @param sessionId - Session the notification belongs to.
	 * @param detail - Event detail text.
	 */
	function notify(kind, sessionId, detail) {
		const current = settings();
		if (!current.enabled) return;
		const frame = buildFrame(kind, sessionId, detail);
		if (current.browser.enabled) broadcast(frame);
		if (current.wxpusher.enabled) void pushWxPusher(frame);
	}

	//#endregion

	//#region detection

	ctx.effect(
		() =>
			ctx.on('api-session/status', (sessionId, running) => {
				const current = settings();
				if (running) {
					runStartedAt.set(sessionId, Date.now());
					const pending = stopTimers.get(sessionId);
					if (pending !== undefined) {
						clearTimeout(pending);
						stopTimers.delete(sessionId);
					}
					return;
				}
				const startedAt = runStartedAt.get(sessionId);
				runStartedAt.delete(sessionId);
				if (!current.enabled || !current.events.stopped) return;
				if (startedAt !== undefined && Date.now() - startedAt < current.advanced.minRunMs) return;
				if (current.advanced.rootSessionsOnly && isSubagentSession(sessionId)) return;
				const pending = stopTimers.get(sessionId);
				if (pending !== undefined) clearTimeout(pending);
				const timer = setTimeout(() => {
					stopTimers.delete(sessionId);
					// The session must still exist, must still be idle, and must not
					// have just reported an error (that notification is more precise).
					if (sessionOf(sessionId) === undefined) return;
					if ((lastErrorAt.get(sessionId) ?? 0) + ERROR_DEDUPE_MS > Date.now()) return;
					notify('stopped', sessionId, '');
				}, current.advanced.stopDebounceMs);
				timer.unref?.();
				stopTimers.set(sessionId, timer);
			}),
		'dsh-plugin-notify: session status',
	);

	/** Report one error exactly once per session per dedupe window. */
	function reportError(sessionId, detail) {
		const current = settings();
		if (!current.enabled || !current.events.error) return;
		if (current.advanced.rootSessionsOnly && isSubagentSession(sessionId)) return;
		const now = Date.now();
		if ((lastErrorAt.get(sessionId) ?? 0) + ERROR_DEDUPE_MS > now) return;
		lastErrorAt.set(sessionId, now);
		notify('error', sessionId, detail);
	}

	ctx.effect(
		() =>
			ctx.on('api-session/error', (sessionId, message) => {
				reportError(sessionId, message);
			}),
		'dsh-plugin-notify: session error',
	);

	ctx.effect(
		() =>
			ctx.on('agent/error', (payload) => {
				const sessionId = payload?.agent?.id;
				if (sessionId === undefined) return;
				const error = payload.error;
				reportError(sessionId, error?.message ?? error?.failure?.message ?? String(error ?? ''));
			}),
		'dsh-plugin-notify: agent error',
	);

	ctx.effect(
		() =>
			ctx.on('user-questions/request', function (request, next) {
				try {
					const current = settings();
					const sessionId = request?.agent?.id;
					if (sessionId !== undefined && current.enabled && current.events.question) {
						if (!current.advanced.rootSessionsOnly || !isSubagentSession(sessionId)) {
							const first = request.questions?.[0];
							const count = request.questions?.length ?? 0;
							const detail = first === undefined
								? ''
								: count > 1
									? `${first.question} (+${count - 1})`
									: first.question;
							notify('question', sessionId, detail);
						}
					}
				} catch (error) {
					ctx.logger.warn('dsh-plugin-notify: question notification failed: %s', error?.message ?? error);
				}
				return next();
			}),
		'dsh-plugin-notify: user questions',
	);

	ctx.effect(
		() =>
			ctx.on('approval/request', function (request, next) {
				try {
					const current = settings();
					const sessionId = request?.agent?.id;
					if (sessionId !== undefined && current.enabled && current.events.approval) {
						if (!current.advanced.rootSessionsOnly || !isSubagentSession(sessionId)) {
							notify('approval', sessionId, request.toolName ?? '');
						}
					}
				} catch (error) {
					ctx.logger.warn('dsh-plugin-notify: approval notification failed: %s', error?.message ?? error);
				}
				return next();
			}),
		'dsh-plugin-notify: approval requests',
	);

	//#endregion

	//#region HTTP routes

	/** Open one SSE response and keep it in the broadcast set. */
	function handleEvents(req, res) {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.writeHead(405, { allow: 'GET' });
			res.end();
			return;
		}
		res.writeHead(200, {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no',
		});
		res.write('retry: 2000\n\n');
		res.write(`data: ${JSON.stringify({ kind: 'hello', time: Date.now() })}\n\n`);
		if (req.method === 'HEAD') {
			res.end();
			return;
		}
		clients.add(res);
		req.on('close', () => {
			clients.delete(res);
		});
	}

	/**
	 * Broadcast a test frame and/or push one, reporting each channel outcome.
	 *
	 * `?channel=browser|wxpusher` narrows the probe to one channel, so the
	 * WxPusher card can verify its own credentials without raising a system
	 * notification. Anything else exercises both.
	 */
	async function handleTest(req, res) {
		if (req.method !== 'POST') {
			res.writeHead(405, { allow: 'POST' });
			res.end();
			return;
		}
		const requested = new URL(req.url ?? ROUTE_TEST, 'http://dsh.invalid').searchParams.get('channel');
		const channel = requested === 'browser' || requested === 'wxpusher' ? requested : 'all';
		const current = settings();
		const frame = buildFrame('test', undefined, 'dsh-plugin-notify test notification', {
			browser: { enabled: true, onlyWhenHidden: false },
		});
		const report = { ok: true, channel };
		if (channel !== 'wxpusher') {
			if (current.browser.enabled) broadcast(frame);
			report.browser = { delivered: current.browser.enabled && clients.size > 0, subscribers: clients.size };
		} else {
			report.browser = { skipped: true };
		}
		if (channel !== 'browser') {
			// `force` bypasses `wxpusher.enabled`, so credentials can be
			// verified before the channel is switched on.
			report.wxpusher = await pushWxPusher(frame, { force: true });
		} else {
			report.wxpusher = { status: 'skipped' };
		}
		res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
		res.end(JSON.stringify(report));
	}

	ctx.inject(['webServer'], (webCtx) => {
		webCtx.effect(
			() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_EVENTS, handler: handleEvents }),
			'dsh-plugin-notify: browser notification stream',
		);
		webCtx.effect(
			() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_TEST, handler: handleTest }),
			'dsh-plugin-notify: test notification endpoint',
		);
	});

	ctx.effect(() => {
		const heartbeat = setInterval(() => {
			for (const response of [...clients]) {
				try {
					response.write(': ping\n\n');
				} catch {
					clients.delete(response);
				}
			}
		}, HEARTBEAT_MS);
		heartbeat.unref?.();
		return () => {
			clearInterval(heartbeat);
			for (const response of clients) {
				try {
					response.end();
				} catch {
					// The socket is already gone.
				}
			}
			clients.clear();
			for (const timer of stopTimers.values()) clearTimeout(timer);
			stopTimers.clear();
			runStartedAt.clear();
			lastErrorAt.clear();
		};
	}, 'dsh-plugin-notify: stream lifecycle');

	//#endregion
}
