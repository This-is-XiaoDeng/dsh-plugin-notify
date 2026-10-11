/**
 * dsh-plugin-notify — Client (browser) half.
 *
 * Two responsibilities:
 *
 *   1. **Deliver notifications.** Subscribe to the Host's
 *      `/dsh-plugin-notify/events` Server-Sent Events stream and turn every
 *      frame into a real `new Notification(...)` — with `requireInteraction`
 *      and a WebAudio chime — plus an optional `onlyWhenHidden` filter.
 *   2. **Own the settings page.** Contribute a 设置 → 通知 section that edits
 *      the Host plugin's Config through `ctx.configForms`. Every field is
 *      `volatile` on the Host, so a write applies live.
 *
 * The page uses only `--dsw-alias-*` theme tokens for colour, keeps all copy in
 * the locale service, and writes through path-addressed `mutate()` operations
 * so the write-only `appToken` secret is never restated.
 *
 * @module dsh-plugin-notify/client
 */

window.__ModuleLoader__.load({
	id: 'dsh-plugin-notify',
	factory(require) {
		const React = require('react');

		/** Locale namespace, Client entry id, and Host settings entry id. */
		const NS = 'dsh-plugin-notify';
		/** Document-relative SSE endpoint (resolved under whatever mount served the page). */
		const EVENTS_ROUTE = 'dsh-plugin-notify/events';
		/** Document-relative test endpoint. */
		const TEST_ROUTE = 'dsh-plugin-notify/test';

		//#region locale dictionaries

		/** Simplified Chinese dictionary and key source of truth. */
		const zh = {
			nav: '通知',
			title: '通知',
			intro: '会话停止、因错误退出或向你提问时，推送 WxPusher 消息并发出浏览器通知。',
			loading: '正在读取配置…',
			missing: '没有找到本插件的配置节。请确认插件行已启用。',
			master: '总开关',
			masterHint: '关闭后两条通道都不再提醒',
			eventsTitle: '触发事件',
			eventStopped: '会话停止',
			eventStoppedHint: '智能体结束一轮工作、进入空闲时',
			eventError: '因错误退出',
			eventErrorHint: '会话或某一步出错时',
			eventQuestion: '收到提问',
			eventQuestionHint: '智能体提问、等你回答时',
			eventApproval: '等待授权',
			eventApprovalHint: '智能体等待授权决定时',
			browserTitle: '浏览器通知',
			browserEnabled: '启用浏览器通知',
			browserEnabledHint: '使用系统级通知横幅，而不是页面内提示',
			browserSound: '提示音',
			browserSoundHint: '通知到达时播放一声短提示音',
			browserRequireInteraction: '需要手动关闭',
			browserRequireInteractionHint: '通知常驻，直到你手动关闭',
			browserOnlyWhenHidden: '仅页面不可见时',
			browserOnlyWhenHiddenHint: '当前标签页可见时不打扰',
			permissionLabel: '通知权限',
			permissionGranted: '已授权',
			permissionDenied: '已被拒绝，请在地址栏的站点设置中重新允许',
			permissionDefault: '尚未授权',
			permissionUnsupported: '当前浏览器不支持通知 API',
			permissionRequest: '请求权限',
			wxpusherTitle: 'WxPusher 推送',
			wxpusherEnabled: '启用 WxPusher',
			wxpusherEnabledHint: '把同样的内容推送到手机',
			wxpusherAppToken: 'appToken',
			wxpusherAppTokenHint: '在 wxpusher.zjiecode.com 应用管理中获取；只写不回显',
			wxpusherAppTokenSet: '已设置',
			wxpusherAppTokenEmpty: '未设置',
			wxpusherAppTokenSave: '保存',
			wxpusherAppTokenClear: '清除',
			wxpusherUids: '接收 UID',
			wxpusherUidsHint: '每行一个，形如 UID_xxxxxxxx',
			wxpusherTopics: '主题 ID',
			wxpusherTopicsHint: '每行一个数字',
			wxpusherUrl: '点击跳转 URL',
			wxpusherUrlHint: '可选；推送被点击时打开',
			advancedTitle: '高级',
			stopDebounce: '停止去抖 (ms)',
			stopDebounceHint: '进入空闲后等待这么久，再判定为「已停止」',
			minRun: '最短运行时长 (ms)',
			minRunHint: '短于该时长的运行不通知',
			rootOnly: '仅根会话',
			rootOnlyHint: '忽略子智能体会话',
			includeTitle: '包含会话标题',
			includeTitleHint: '在通知里带上会话标题',
			maxDetail: '详情截断长度',
			maxDetailHint: '错误信息、提问内容的最大字符数',
			test: '发送测试通知',
			testing: '发送中…',
			testTitle: '测试结果',
			testBrowserYes: '浏览器：{n} 个页面收到',
			testBrowserNo: '浏览器：没有已连接的页面（浏览器通知可能已关闭）',
			testWxSent: 'WxPusher：已发送',
			testWxDisabled: 'WxPusher：未启用',
			testWxNoToken: 'WxPusher：未填写 appToken',
			testWxNoReceiver: 'WxPusher：未填写 UID 或主题 ID',
			testWxFailed: 'WxPusher：被拒绝（{message}）',
			testWxError: 'WxPusher：请求失败（{message}）',
			testFailed: '测试请求失败（{message}）',
			appName: 'DeepSeek Harness',
			notifyStopped: '会话已停止',
			notifyError: '会话出错',
			notifyQuestion: '收到提问',
			notifyApproval: '等待授权',
			notifyTest: '测试通知',
			bodyStopped: '智能体已完成当前工作，等待你的下一步。',
			bodyQuestion: '智能体正在等你回答。',
			bodyApproval: '智能体正在等待授权决定。',
		};

		/** English dictionary. */
		const en = {
			nav: 'Notifications',
			title: 'Notifications',
			intro: 'When a session stops, exits with an error, or asks you a question, push a WxPusher message and raise a browser notification.',
			loading: 'Reading configuration…',
			missing: 'This plugin\'s configuration entry was not found. Check that the plugin row is enabled.',
			master: 'Master switch',
			masterHint: 'Turn both channels off',
			eventsTitle: 'Trigger events',
			eventStopped: 'Session stopped',
			eventStoppedHint: 'The agent finished its work and went idle',
			eventError: 'Exited with an error',
			eventErrorHint: 'A session or a step errored',
			eventQuestion: 'Question asked',
			eventQuestionHint: 'The agent is waiting for your answer',
			eventApproval: 'Approval needed',
			eventApprovalHint: 'The agent is waiting for an approval decision',
			browserTitle: 'Browser notifications',
			browserEnabled: 'Enable browser notifications',
			browserEnabledHint: 'Use system-level notification banners',
			browserSound: 'Sound',
			browserSoundHint: 'Play a short chime when a notification arrives',
			browserRequireInteraction: 'Require interaction',
			browserRequireInteractionHint: 'Keep the notification on screen until dismissed',
			browserOnlyWhenHidden: 'Only when the page is hidden',
			browserOnlyWhenHiddenHint: 'Stay quiet while this tab is visible',
			permissionLabel: 'Notification permission',
			permissionGranted: 'Granted',
			permissionDenied: 'Denied — re-allow it in the address bar site settings',
			permissionDefault: 'Not granted yet',
			permissionUnsupported: 'This browser has no Notification API',
			permissionRequest: 'Request permission',
			wxpusherTitle: 'WxPusher push',
			wxpusherEnabled: 'Enable WxPusher',
			wxpusherEnabledHint: 'Push the same content to your phone',
			wxpusherAppToken: 'appToken',
			wxpusherAppTokenHint: 'From your app settings on wxpusher.zjiecode.com; write-only',
			wxpusherAppTokenSet: 'Set',
			wxpusherAppTokenEmpty: 'Not set',
			wxpusherAppTokenSave: 'Save',
			wxpusherAppTokenClear: 'Clear',
			wxpusherUids: 'Receiver UIDs',
			wxpusherUidsHint: 'One per line, e.g. UID_xxxxxxxx',
			wxpusherTopics: 'Topic ids',
			wxpusherTopicsHint: 'One number per line',
			wxpusherUrl: 'Click-through URL',
			wxpusherUrlHint: 'Optional; opened when the push is tapped',
			advancedTitle: 'Advanced',
			stopDebounce: 'Stop debounce (ms)',
			stopDebounceHint: 'Wait this long after going idle before reporting a stop',
			minRun: 'Minimum run length (ms)',
			minRunHint: 'Runs shorter than this never notify',
			rootOnly: 'Root sessions only',
			rootOnlyHint: 'Ignore subagent sessions',
			includeTitle: 'Include the session title',
			includeTitleHint: 'Put the folded session title in the notification',
			maxDetail: 'Detail truncation',
			maxDetailHint: 'Maximum characters of error text or question text',
			test: 'Send a test notification',
			testing: 'Sending…',
			testTitle: 'Test result',
			testBrowserYes: 'Browser: delivered to {n} page(s)',
			testBrowserNo: 'Browser: no connected page (browser notifications may be off)',
			testWxSent: 'WxPusher: sent',
			testWxDisabled: 'WxPusher: disabled',
			testWxNoToken: 'WxPusher: no appToken',
			testWxNoReceiver: 'WxPusher: no UID or topic id',
			testWxFailed: 'WxPusher: refused ({message})',
			testWxError: 'WxPusher: request failed ({message})',
			testFailed: 'Test request failed ({message})',
			appName: 'DeepSeek Harness',
			notifyStopped: 'Session stopped',
			notifyError: 'Session error',
			notifyQuestion: 'Question asked',
			notifyApproval: 'Approval needed',
			notifyTest: 'Test notification',
			bodyStopped: 'The agent finished its work and is waiting for you.',
			bodyQuestion: 'The agent is waiting for your answer.',
			bodyApproval: 'The agent is waiting for an approval decision.',
		};

		//#endregion

		//#region styles

		/** Component-local styles; colours come only from `--dsw-alias-*` tokens. */
		const CSS = `
.dsh-notify-page{box-sizing:border-box;display:flex;flex-direction:column;gap:28px;padding-bottom:24px;color:var(--dsw-alias-label-primary)}
.dsh-notify-head{display:flex;flex-direction:column;gap:6px}
.dsh-notify-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.dsh-notify-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dsh-notify-section{display:flex;flex-direction:column;gap:4px}
.dsh-notify-sectionTitle{margin:0 0 6px;font-size:14px;font-weight:500;line-height:22px}
.dsh-notify-row{display:flex;align-items:center;gap:16px;padding:10px 2px;border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.dsh-notify-row:last-child{border-bottom:0}
.dsh-notify-rowMain{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.dsh-notify-rowLabel{font-size:13.5px;line-height:20px}
.dsh-notify-rowHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-notify-rowControl{display:flex;align-items:center;gap:8px;flex:none}
.dsh-notify-stack{flex-direction:column;align-items:stretch;gap:8px}
.dsh-notify-stack .dsh-notify-rowControl{justify-content:flex-start}
.dsh-notify-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:10px;cursor:pointer;background:var(--dsw-alias-state-idle-primary);transition:background .16s ease}
.dsh-notify-switch[aria-checked="true"]{background:var(--dsw-alias-state-success-primary)}
.dsh-notify-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-notify-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .16s ease}
.dsh-notify-switch[aria-checked="true"] .dsh-notify-knob{transform:translateX(16px)}
.dsh-notify-input,.dsh-notify-area{box-sizing:border-box;width:100%;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;outline:none}
.dsh-notify-input{width:150px}
.dsh-notify-inputWide{width:100%;max-width:420px}
.dsh-notify-input:focus,.dsh-notify-area:focus{border-color:var(--dsw-alias-brand-primary)}
.dsh-notify-area{min-height:62px;resize:vertical;font-family:inherit;line-height:18px}
.dsh-notify-button{font:inherit;font-size:13px;line-height:20px;height:32px;padding:0 12px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}
.dsh-notify-button:hover:not(:disabled){background:var(--dsw-alias-bg-overlay)}
.dsh-notify-button:disabled{opacity:.5;cursor:default}
.dsh-notify-buttonPrimary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.dsh-notify-buttonPrimary:hover:not(:disabled){background:var(--dsw-alias-brand-primary)}
.dsh-notify-badge{font-size:11.5px;line-height:18px;padding:0 8px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dsh-notify-badgeOk{color:var(--dsw-alias-state-success-primary)}
.dsh-notify-badgeWarn{color:var(--dsw-alias-state-warn-primary)}
.dsh-notify-badgeError{color:var(--dsw-alias-state-error-primary)}
.dsh-notify-note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-notify-error{color:var(--dsw-alias-state-error-primary)}
.dsh-notify-tokenRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
`;

		//#endregion

		//#region small controls

		/** Subscribe to one observable snapshot source. */
		function useSnapshot(source) {
			const [snapshot, setSnapshot] = React.useState(() => (source === null ? null : source.getSnapshot()));
			React.useEffect(() => {
				if (source === null) {
					setSnapshot(null);
					return undefined;
				}
				setSnapshot(source.getSnapshot());
				return source.subscribe(() => setSnapshot(source.getSnapshot()));
			}, [source]);
			return snapshot;
		}

		/** One label/hint row with a trailing control. */
		function Row({ label, hint, children, stacked }) {
			return React.createElement(
				'div',
				{ className: stacked ? 'dsh-notify-row dsh-notify-stack' : 'dsh-notify-row' },
				React.createElement(
					'div',
					{ className: 'dsh-notify-rowMain' },
					React.createElement('div', { className: 'dsh-notify-rowLabel' }, label),
					hint ? React.createElement('div', { className: 'dsh-notify-rowHint' }, hint) : null,
				),
				React.createElement('div', { className: 'dsh-notify-rowControl' }, children),
			);
		}

		/** Accessible switch. */
		function Switch({ checked, label, onChange }) {
			return React.createElement(
				'button',
				{
					type: 'button',
					role: 'switch',
					'aria-checked': checked === true,
					'aria-label': label,
					className: 'dsh-notify-switch',
					onClick: () => onChange(checked !== true),
				},
				React.createElement('span', { className: 'dsh-notify-knob' }),
			);
		}

		/** Text control that commits on blur or Enter. */
		function TextField({ value, type = 'text', placeholder, onCommit, className = 'dsh-notify-input' }) {
			const [draft, setDraft] = React.useState(value ?? '');
			React.useEffect(() => {
				setDraft(value ?? '');
			}, [value]);
			return React.createElement('input', {
				className,
				type,
				value: draft,
				placeholder,
				spellCheck: false,
				onChange: (event) => setDraft(event.target.value),
				onBlur: () => {
					if (draft !== (value ?? '')) onCommit(draft);
				},
				onKeyDown: (event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
				},
			});
		}

		/** Multi-line control that commits on blur. */
		function AreaField({ value, placeholder, onCommit }) {
			const [draft, setDraft] = React.useState(value ?? '');
			React.useEffect(() => {
				setDraft(value ?? '');
			}, [value]);
			return React.createElement('textarea', {
				className: 'dsh-notify-area',
				value: draft,
				placeholder,
				spellCheck: false,
				onChange: (event) => setDraft(event.target.value),
				onBlur: () => {
					if (draft !== (value ?? '')) onCommit(draft);
				},
			});
		}

		/** A short status chip. */
		function Badge({ text, tone }) {
			const suffix = tone === undefined ? '' : tone === 'ok' ? ' dsh-notify-badgeOk' : tone === 'warn' ? ' dsh-notify-badgeWarn' : ' dsh-notify-badgeError';
			return React.createElement('span', { className: `dsh-notify-badge${suffix}` }, text);
		}

		//#endregion

		//#region browser notification delivery

		/** Cached PNG data URL used as the notification icon. */
		let iconDataUrl;
		/** Lazily created WebAudio context (undefined = not tried, null = unsupported). */
		let audioContext;

		/** Draw the plugin mark into a canvas once and reuse it as a PNG data URL. */
		function notificationIcon() {
			if (iconDataUrl !== undefined) return iconDataUrl;
			iconDataUrl = null;
			try {
				const size = 128;
				const canvas = document.createElement('canvas');
				canvas.width = size;
				canvas.height = size;
				const paint = canvas.getContext('2d');
				paint.fillStyle = '#247bbf';
				paint.beginPath();
				paint.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
				paint.fill();
				paint.fillStyle = '#ffffff';
				paint.beginPath();
				paint.moveTo(size / 2, 30);
				paint.bezierCurveTo(42, 30, 34, 46, 34, 60);
				paint.lineTo(34, 74);
				paint.lineTo(26, 86);
				paint.lineTo(102, 86);
				paint.lineTo(94, 74);
				paint.lineTo(94, 60);
				paint.bezierCurveTo(94, 46, 86, 30, size / 2, 30);
				paint.closePath();
				paint.fill();
				paint.beginPath();
				paint.arc(size / 2, 98, 9, 0, Math.PI * 2);
				paint.fill();
				iconDataUrl = canvas.toDataURL('image/png');
			} catch {
				iconDataUrl = null;
			}
			return iconDataUrl;
		}

		/** Create (once) the WebAudio context used for the chime. */
		function ensureAudioContext() {
			if (audioContext !== undefined) return audioContext;
			const Ctor = window.AudioContext ?? window.webkitAudioContext;
			if (Ctor === undefined) {
				audioContext = null;
				return null;
			}
			try {
				audioContext = new Ctor();
			} catch {
				audioContext = null;
			}
			return audioContext;
		}

		/** Play a two-tone chime; silently does nothing where audio is unavailable. */
		function playChime() {
			try {
				const audio = ensureAudioContext();
				if (audio === null) return;
				if (audio.state === 'suspended') audio.resume().catch(() => {});
				const start = audio.currentTime;
				for (const [frequency, delay] of [[880, 0], [1320, 0.16]]) {
					const oscillator = audio.createOscillator();
					const gain = audio.createGain();
					oscillator.type = 'sine';
					oscillator.frequency.value = frequency;
					gain.gain.setValueAtTime(0, start + delay);
					gain.gain.linearRampToValueAtTime(0.14, start + delay + 0.02);
					gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.3);
					oscillator.connect(gain);
					gain.connect(audio.destination);
					oscillator.start(start + delay);
					oscillator.stop(start + delay + 0.32);
				}
			} catch {
				// Audio is best-effort.
			}
		}

		/**
		 * Register the SSE subscription and the notification delivery path.
		 *
		 * @param ctx - Client plugin context.
		 */
		function installNotificationStream(ctx) {
			const t = ctx.locale.bind(NS);

			/** Turn one Host frame into a system notification. */
			function deliver(frame) {
				const browser = frame.browser ?? {};
				if (browser.enabled === false) return;
				if (browser.onlyWhenHidden !== false && document.visibilityState === 'visible') return;
				if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
				const labelKey = {
					stopped: 'notifyStopped',
					error: 'notifyError',
					question: 'notifyQuestion',
					approval: 'notifyApproval',
					test: 'notifyTest',
				}[frame.kind];
				const label = labelKey === undefined ? String(frame.kind) : t(labelKey);
				const title = frame.sessionTitle ? `${label} · ${frame.sessionTitle}` : `${t('appName')} · ${label}`;
				const fallbackKey = frame.kind === 'stopped' ? 'bodyStopped' : frame.kind === 'question' ? 'bodyQuestion' : frame.kind === 'approval' ? 'bodyApproval' : undefined;
				const body = frame.detail || (fallbackKey === undefined ? '' : t(fallbackKey));
				try {
					const notification = new Notification(title, {
						body,
						tag: frame.tag ?? undefined,
						icon: notificationIcon() ?? undefined,
						requireInteraction: browser.requireInteraction === true,
						silent: browser.sound === false,
					});
					notification.onclick = () => {
						try {
							window.focus();
						} catch {
							// Focus is best-effort.
						}
						notification.close();
					};
				} catch (error) {
					ctx.logger.warn('dsh-plugin-notify: browser notification failed: %s', error?.message ?? error);
					return;
				}
				if (browser.sound !== false) playChime();
			}

			// Browsers keep an AudioContext suspended until a gesture unlocks it.
			const unlock = () => {
				const audio = ensureAudioContext();
				if (audio !== null && audio.state === 'suspended') audio.resume().catch(() => {});
			};
			window.addEventListener('pointerdown', unlock, { capture: true, once: true });
			window.addEventListener('keydown', unlock, { capture: true, once: true });

			ctx.effect(() => {
				if (typeof EventSource === 'undefined') return undefined;
				const source = new EventSource(EVENTS_ROUTE);
				const onMessage = (event) => {
					let frame;
					try {
						frame = JSON.parse(event.data);
					} catch {
						return;
					}
					if (frame === null || typeof frame !== 'object' || frame.kind === 'hello') return;
					deliver(frame);
				};
				source.addEventListener('message', onMessage);
				return () => {
					source.removeEventListener('message', onMessage);
					source.close();
				};
			}, 'dsh-plugin-notify: browser notification stream');

			ctx.effect(
				() => () => {
					window.removeEventListener('pointerdown', unlock, { capture: true });
					window.removeEventListener('keydown', unlock, { capture: true });
				},
				'dsh-plugin-notify: audio unlock listeners',
			);
		}

		//#endregion

		//#region settings page

		/**
		 * Resolve the Host entry id backing this plugin's settings namespace.
		 *
		 * The Loader entry id is the patch-declared row id, but a profile may
		 * nest bundle patches (which prefixes it). Fall back to a structural
		 * match on the schema the page knows it owns.
		 *
		 * @param view - The settings describe view, or undefined before the first read.
		 * @returns The namespace key, or undefined while it is not served.
		 */
		function resolveNamespace(view) {
			const namespaces = view?.namespaces ?? [];
			const exact = namespaces.find((entry) => entry.ns === NS);
			if (exact !== undefined) return exact.ns;
			const suffixed = namespaces.find((entry) => entry.ns.endsWith(`:${NS}`) || entry.ns.endsWith(`/${NS}`) || entry.ns.endsWith(`#${NS}`));
			if (suffixed !== undefined) return suffixed.ns;
			const marked = namespaces.find((entry) => {
				const dict = entry.schema?.dict;
				return dict !== undefined && dict !== null && dict.wxpusher !== undefined && dict.browser !== undefined && dict.events !== undefined && dict.advanced !== undefined;
			});
			return marked?.ns;
		}

		/** Render the 设置 → 通知 page. */
		function createSection(ctx) {
			/** One ConfigFormController per namespace. */
			const forms = new Map();
			const formFor = (namespace) => {
				let form = forms.get(namespace);
				if (form === undefined) {
					form = ctx.configForms.get(namespace);
					forms.set(namespace, form);
				}
				return form;
			};

			/** Queue one settings mutation, surfacing a refusal or a transport failure. */
			const queue = (form, ops) => {
				form.mutate(ops).then(
					(accepted) => {
						if (accepted === false) ctx.logger.warn('dsh-plugin-notify: the Host refused a settings write');
					},
					(error) => {
						ctx.logger.warn('dsh-plugin-notify: settings write failed: %s', error?.message ?? error);
					},
				);
			};

			return function NotifySection(props) {
				const t = props.t ?? ctx.locale.bind(NS);
				const face = ctx.configForms.describe();
				const mirror = useSnapshot(face);
				React.useEffect(() => {
					Promise.resolve(face.ensure()).catch(() => {});
				}, [face]);

				const namespace = resolveNamespace(mirror?.view);
				const form = namespace === undefined ? null : formFor(namespace);
				const formSnapshot = useSnapshot(form);
				const namespaceView = mirror?.view?.namespaces?.find((entry) => entry.ns === namespace);
				const secrets = namespaceView?.secrets ?? [];
				const tokenSet = secrets.some(
					(secret) => secret.path.length === 2 && secret.path[0] === 'wxpusher' && secret.path[1] === 'appToken' && secret.set === true,
				);

				const [testing, setTesting] = React.useState(false);
				const [testResult, setTestResult] = React.useState(null);
				const [permission, setPermission] = React.useState(
					typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
				);

				const value = formSnapshot?.value ?? {};
				const writable = formSnapshot?.status === 'ready' && formSnapshot?.writable !== false;
				const commit = React.useCallback(
					(path, next) => {
						if (form === null) return;
						queue(form, [{ op: 'set', path, value: next }]);
					},
					[form],
				);

				/** Write the write-only appToken (or clear it). */
				const commitToken = (token) => {
					if (form === null) return;
					queue(
						form,
						token === ''
							? [{ op: 'unset', path: ['wxpusher', 'appToken'] }]
							: [{ op: 'set', path: ['wxpusher', 'appToken'], value: token }],
					);
				};

				const runTest = async () => {
					setTesting(true);
					setTestResult(null);
					try {
						const response = await fetch(TEST_ROUTE, { method: 'POST', credentials: 'same-origin' });
						const payload = await response.json();
						setTestResult({ ok: true, payload });
					} catch (error) {
						setTestResult({ ok: false, message: String(error?.message ?? error) });
					}
					setTesting(false);
				};

				const requestPermission = () => {
					if (typeof Notification === 'undefined') return;
					Notification.requestPermission().then(
						(next) => setPermission(next),
						() => setPermission(Notification.permission),
					);
				};

				const children = [];
				children.push(
					React.createElement(
						'div',
						{ className: 'dsh-notify-head', key: 'head' },
						React.createElement('h2', { className: 'dsh-notify-title' }, t('title')),
						React.createElement('p', { className: 'dsh-notify-intro' }, t('intro')),
					),
				);

				if (formSnapshot === null || mirror === null || mirror.status === 'idle' || mirror.status === 'loading') {
					children.push(React.createElement('p', { className: 'dsh-notify-note', key: 'loading' }, t('loading')));
				}
				if (namespace === undefined && mirror !== null && mirror.status === 'ready') {
					children.push(React.createElement('p', { className: 'dsh-notify-note dsh-notify-error', key: 'missing' }, t('missing')));
				}

				if (namespace !== undefined) {
					/** One boolean row bound to a config path. */
					const switchRow = (key, path, label, hint) =>
						React.createElement(
							Row,
							{ key, label, hint },
							React.createElement(Switch, {
								checked: value?.[path[0]]?.[path[1]] === true,
								label,
								onChange: (next) => commit(path, next),
							}),
						);

					children.push(
						React.createElement(
							'section',
							{ className: 'dsh-notify-section', key: 'master' },
							React.createElement('h3', { className: 'dsh-notify-sectionTitle' }, t('master')),
							React.createElement(
								Row,
								{ label: t('master'), hint: t('masterHint') },
								React.createElement(Switch, {
									checked: value?.enabled !== false,
									label: t('master'),
									onChange: (next) => commit(['enabled'], next),
								}),
							),
						),
					);

					children.push(
						React.createElement(
							'section',
							{ className: 'dsh-notify-section', key: 'events' },
							React.createElement('h3', { className: 'dsh-notify-sectionTitle' }, t('eventsTitle')),
							switchRow('event-stopped', ['events', 'stopped'], t('eventStopped'), t('eventStoppedHint')),
							switchRow('event-error', ['events', 'error'], t('eventError'), t('eventErrorHint')),
							switchRow('event-question', ['events', 'question'], t('eventQuestion'), t('eventQuestionHint')),
							switchRow('event-approval', ['events', 'approval'], t('eventApproval'), t('eventApprovalHint')),
						),
					);

					const permissionText =
						permission === 'granted'
							? t('permissionGranted')
							: permission === 'denied'
								? t('permissionDenied')
								: permission === 'unsupported'
									? t('permissionUnsupported')
									: t('permissionDefault');
					const permissionTone = permission === 'granted' ? 'ok' : permission === 'denied' ? 'error' : 'warn';

					children.push(
						React.createElement(
							'section',
							{ className: 'dsh-notify-section', key: 'browser' },
							React.createElement('h3', { className: 'dsh-notify-sectionTitle' }, t('browserTitle')),
							switchRow('browser-enabled', ['browser', 'enabled'], t('browserEnabled'), t('browserEnabledHint')),
							switchRow('browser-sound', ['browser', 'sound'], t('browserSound'), t('browserSoundHint')),
							switchRow('browser-require', ['browser', 'requireInteraction'], t('browserRequireInteraction'), t('browserRequireInteractionHint')),
							switchRow('browser-hidden', ['browser', 'onlyWhenHidden'], t('browserOnlyWhenHidden'), t('browserOnlyWhenHiddenHint')),
							React.createElement(
								Row,
								{ key: 'permission', label: t('permissionLabel'), hint: permission === 'granted' ? undefined : permissionText },
								React.createElement(Badge, { text: permissionText, tone: permissionTone }),
								permission === 'default'
									? React.createElement(
											'button',
											{ type: 'button', className: 'dsh-notify-button', onClick: requestPermission },
											t('permissionRequest'),
										)
									: null,
							),
							React.createElement(
								Row,
								{ key: 'test', label: t('test'), hint: testResult === null ? undefined : renderTestResult(t, testResult) },
								React.createElement(
									'button',
									{
										type: 'button',
										className: 'dsh-notify-button dsh-notify-buttonPrimary',
										disabled: testing,
										onClick: runTest,
									},
									testing ? t('testing') : t('test'),
								),
							),
						),
					);

					children.push(
						React.createElement(
							'section',
							{ className: 'dsh-notify-section', key: 'wxpusher' },
							React.createElement('h3', { className: 'dsh-notify-sectionTitle' }, t('wxpusherTitle')),
							switchRow('wx-enabled', ['wxpusher', 'enabled'], t('wxpusherEnabled'), t('wxpusherEnabledHint')),
							React.createElement(
								Row,
								{ key: 'wx-token', label: t('wxpusherAppToken'), hint: t('wxpusherAppTokenHint'), stacked: true },
								React.createElement(
									'div',
									{ className: 'dsh-notify-tokenRow' },
									React.createElement(TokenField, {
										key: tokenSet ? 'set' : 'empty',
										tokenSet,
										labels: {
											placeholder: tokenSet ? '••••••••' : t('wxpusherAppToken'),
											save: t('wxpusherAppTokenSave'),
											clear: t('wxpusherAppTokenClear'),
										},
										onSave: commitToken,
									}),
									React.createElement(Badge, {
										text: tokenSet ? t('wxpusherAppTokenSet') : t('wxpusherAppTokenEmpty'),
										tone: tokenSet ? 'ok' : 'warn',
									}),
								),
							),
							React.createElement(
								Row,
								{ key: 'wx-uids', label: t('wxpusherUids'), hint: t('wxpusherUidsHint'), stacked: true },
								React.createElement(AreaField, {
									value: (value?.wxpusher?.uids ?? []).join('\n'),
									placeholder: 'UID_xxxxxxxx',
									onCommit: (text) =>
										commit(
											['wxpusher', 'uids'],
											text
												.split(/[\s,;]+/)
												.map((item) => item.trim())
												.filter((item) => item !== ''),
										),
								}),
							),
							React.createElement(
								Row,
								{ key: 'wx-topics', label: t('wxpusherTopics'), hint: t('wxpusherTopicsHint'), stacked: true },
								React.createElement(AreaField, {
									value: (value?.wxpusher?.topicIds ?? []).join('\n'),
									placeholder: '123',
									onCommit: (text) =>
										commit(
											['wxpusher', 'topicIds'],
											text
												.split(/[\s,;]+/)
												.map((item) => Number(item.trim()))
												.filter((item) => Number.isFinite(item)),
										),
								}),
							),
							React.createElement(
								Row,
								{ key: 'wx-url', label: t('wxpusherUrl'), hint: t('wxpusherUrlHint'), stacked: true },
								React.createElement(TextField, {
									value: value?.wxpusher?.url ?? '',
									placeholder: 'https://…',
									className: 'dsh-notify-input dsh-notify-inputWide',
									onCommit: (text) => commit(['wxpusher', 'url'], text.trim()),
								}),
							),
						),
					);

					children.push(
						React.createElement(
							'section',
							{ className: 'dsh-notify-section', key: 'advanced' },
							React.createElement('h3', { className: 'dsh-notify-sectionTitle' }, t('advancedTitle')),
							React.createElement(
								Row,
								{ label: t('stopDebounce'), hint: t('stopDebounceHint') },
								React.createElement(TextField, {
									type: 'number',
									value: String(value?.advanced?.stopDebounceMs ?? ''),
									onCommit: (text) => commit(['advanced', 'stopDebounceMs'], Number(text) || 0),
								}),
							),
							React.createElement(
								Row,
								{ label: t('minRun'), hint: t('minRunHint') },
								React.createElement(TextField, {
									type: 'number',
									value: String(value?.advanced?.minRunMs ?? ''),
									onCommit: (text) => commit(['advanced', 'minRunMs'], Number(text) || 0),
								}),
							),
							React.createElement(
								Row,
								{ label: t('maxDetail'), hint: t('maxDetailHint') },
								React.createElement(TextField, {
									type: 'number',
									value: String(value?.advanced?.maxDetailChars ?? ''),
									onCommit: (text) => commit(['advanced', 'maxDetailChars'], Number(text) || 300),
								}),
							),
							switchRow('adv-root', ['advanced', 'rootSessionsOnly'], t('rootOnly'), t('rootOnlyHint')),
							switchRow('adv-title', ['advanced', 'includeSessionTitle'], t('includeTitle'), t('includeTitleHint')),
						),
					);

					if (!writable) {
						children.push(React.createElement('p', { className: 'dsh-notify-note', key: 'ro' }, t('loading')));
					}
				}

				return React.createElement(
					'div',
					{ className: 'dsh-notify-page' },
					React.createElement('style', { key: 'css' }, CSS),
					...children,
				);
			};
		}

		/** Render the test endpoint's answer as one line of text. */
		function renderTestResult(t, result) {
			if (result.ok !== true) return t('testFailed', { message: result.message ?? '' });
			const payload = result.payload ?? {};
			const browserLine = payload.browser?.delivered === true ? t('testBrowserYes', { n: String(payload.browser.subscribers ?? 0) }) : t('testBrowserNo');
			const status = payload.wxpusher?.status;
			const wxLine =
				status === 'sent'
					? t('testWxSent')
					: status === 'disabled'
						? t('testWxDisabled')
						: status === 'no-token'
							? t('testWxNoToken')
							: status === 'no-receiver'
								? t('testWxNoReceiver')
								: status === 'failed'
									? t('testWxFailed', { message: payload.wxpusher?.message ?? '' })
									: t('testWxError', { message: payload.wxpusher?.message ?? '' });
			return `${browserLine} · ${wxLine}`;
		}

		/** Write-only secret input: never prefilled, commits only on explicit action. */
		function TokenField({ tokenSet, labels, onSave }) {
			const [draft, setDraft] = React.useState('');
			return React.createElement(
				React.Fragment,
				null,
				React.createElement('input', {
					className: 'dsh-notify-input dsh-notify-inputWide',
					type: 'password',
					value: draft,
					placeholder: labels.placeholder,
					autoComplete: 'off',
					spellCheck: false,
					onChange: (event) => setDraft(event.target.value),
					onKeyDown: (event) => {
						if (event.key === 'Enter' && draft.trim() !== '') {
							onSave(draft.trim());
							setDraft('');
						}
					},
				}),
				React.createElement(
					'button',
					{
						type: 'button',
						className: 'dsh-notify-button',
						disabled: draft.trim() === '',
						onClick: () => {
							onSave(draft.trim());
							setDraft('');
						},
					},
					labels.save,
				),
				tokenSet
					? React.createElement(
							'button',
							{
								type: 'button',
								className: 'dsh-notify-button',
								onClick: () => {
									onSave('');
									setDraft('');
								},
							},
							labels.clear,
						)
					: null,
			);
		}

		//#endregion

		/** Client plugin body. */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-notify: dictionaries');
			installNotificationStream(ctx);
			ctx.slots.inject('settings.section', () =>
				ctx.slots.register(
					{
						name: 'settings.section',
						id: 'notify',
						order: 40,
						label: () => ctx.locale.bind(NS)('nav'),
						locale: NS,
					},
					createSection(ctx),
				),
			);
		}

		return {
			name: NS,
			inject: ['slots', 'locale', 'configForms'],
			apply,
		};
	},
});
