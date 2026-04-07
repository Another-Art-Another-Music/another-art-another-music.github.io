/*
# vim: set ts=4 sw=4 sts=4 noet :

#STYLE RULES

- Preserve existing style unless readability clearly improves.
- Keep code visually calm, compact, and easy to scan.
- Prefer direct, idiomatic JS (also HTML + CSS + SVG)
- Reuse existing primitives first.
- If logic repeats, extract the minimal missing helper.
- Do not duplicate logic without a clear reason.
- Avoid unnecessary wrappers, indirection, boilerplate, and abstraction.
- Keep names, structure, and formatting consistent.
- Use tabs where the file already uses tabs.
- No trailing whitespace or unnecessary empty lines
- Keep lines under 130 chars when reasonably possible.
- Wrap for human readability, not mechanically or for horizontal compactness.
- Do not use decorative alignment or visually unstable long-line layouts.
- Preserve useful comments and their placement unless clarity improves.
- Make the smallest clean change that fully solves the task.
- Preserve behavior unless a real change is explicitly required.
- The header STYLE RULES are binding for all requested code changes.
- They do not justify unrelated cleanup outside the requested scope.
- Keep the result comfortable for long-term human reading and maintenance.

*/

;(function(){
	const PLOG = '[a3m]';
	const log = console.log.bind(console, PLOG);
	const warn = console.warn.bind(console, PLOG);
	const err = console.error.bind(console, PLOG);

	const UI = {
		icons: {
			play: '▶',
			pause: '❚❚',
			prev: '‹',
			next: '›',
			stop: '■',
			download: '↓',
			mute: '🔉',
			muted: '🔇',
			hint: '▶'
		},
		text: {
			title: 'Nothing selected',
			noTracks: 'No loaded tracks yet.',
			noCover: 'No cover',
			noDownloads: 'No downloads listed.',
			refresh: 'Refresh',
			share: 'Share',
			list: '^L',
			loadMore: 'More',
			pos: '^P',
			begin: '<'
		},
		modes: {
			minimal: 'v',
			medium: 'V',
			full: 'F'
		},
		listPos: {
			left: 'L',
			right: 'R',
			bottom: 'B',
			top: 'T'
		}
	};

	const savedSession = loadPlayerSession();

	const CFG = {
		api: 'https://api.github.com/repos/Another-Art-Another-Music/listen/releases',
		apiPerPage: 30,
		listRowsVisible: 15,
		cachePrefix: 'a3m-listen:',
		cacheVer: 'v4',
		freshMsFirst: 15 * 60 * 1000,
		freshMsOther: 24 * 60 * 60 * 1000,
		timeoutMs: 15000,
		maxSeekUpdateMs: 120,
		sessionSaveMs: 10000,
		fullUiHideMs: 2200,
		miniVolIdleMs: 1000,
		failedHashMs: 60 * 1000,
		githubMinRequestMs: 5000,
		allowHashMissFallback: 1,
		groupViews: [ 'newest', 'album', 'year', 'month', 'list' ],
		listPosModes: [ 'right', 'left', 'bottom' ],
		defaultMode: 'minimal',
		defaultView: 'newest',
		defaultListPos: 'bottom',
		playFormatOrder: [ 'opus', 'm4a', 'ogg', 'mp3', 'flac', 'wav' ],
		downloadOrder: [ 'opus', 'flac', 'm4a', 'ogg', 'mp3', 'wav', 'aac' ]
	};

	const state = {
		mode: validMode(
			savedSession && savedSession.mode || CFG.defaultMode
		),
		prevMode: validMode(
			savedSession && savedSession.prevMode || CFG.defaultMode
		),
		view: validView(
			savedSession && savedSession.view || CFG.defaultView
		),
		listPos: validListPos(
			savedSession && savedSession.listPos || CFG.defaultListPos
		),
		playlistOpen: savedSession && savedSession.playlistOpen != null
			? !!savedSession.playlistOpen
			: false,
		prevPlaylistOpen: null,
		blocks: {},
		tracks: [],
		trackByKey: {},
		index: {
			blockByTag: {}
		},
		totalKnownPages: null,
		loading: false,
		error: '',
		currentId: '',
		currentHash: '',
		seeking: false,
		lastTimePaint: 0,
		inflight: {},
		requestSeq: 0,
		session: savedSession,
		sessionRestoreHash: '',
		pendingSession: null,
		refreshInflight: 0,
		lastSessionSave: 0,
		lastNotice: { text: '', kind: 'info' },
		nextApiAt: 0,
		toastSticky: false,
		toastTimer: 0,
		downloadOpen: false,
		fullUiVisible: true,
		fullUiTimer: 0,
		lastMuted: null,
		failedHash: '',
		failedHashAt: 0,
		miniVolTimer: 0,
		miniVolPreviewPointerId: null,
		miniVolAction: '',
		miniVolActionPointerId: null,
		miniVolSuppressClickAt: 0,
		pressNodes: [],
		volFocusTimer: 0
	};

	async function fetchGitApi(url, opts){
		if (String(url || '').indexOf(CFG.api) !== 0) {
			throw new Error('Blocked non-GitHub API request.');
		}

		const now = Date.now();
		const startAt = state.nextApiAt > now ? state.nextApiAt : now;
		const wait = startAt - now;

		state.nextApiAt = startAt + CFG.githubMinRequestMs;

		log('git api request:', url);
		if (wait > 0) {
			log('git api wait', wait + 'ms', url);
			await new Promise(function(resolve){
				setTimeout(resolve, wait);
			});
		}

		return fetchWithTimeout(url, opts);
	}

	const dom = {};
	let audio;

	init();

	function init(){
		log('init', {
			src: (document.currentScript && document.currentScript.getAttribute('src') || '.js'),
			hash: location.hash || '',
			session: !!savedSession,
			mode: state.mode,
			view: state.view
		});
		renderShell();
		audio = dom.audio;
		bindAudio();
		bindUi();
		restoreAudioPrefs();
		rebuildFromCaches();
		syncDocumentMode();
		resolveStartup().catch(function(e){
			fail(e);
		});
	}

	function renderShell(){
		const root = document.getElementById('a3m-root');
		root.innerHTML = [
			'<section class="a3m-player" data-mode="' +
				escAttr(validMode(state.mode)) +
				'" data-busy="0" data-error="0" data-list-open="' +
				(state.playlistOpen ? '1' : '0') +
				'" data-list-pos="' + escAttr(effectiveListPos()) +
				'" data-full-ui="1" data-vol-axis="horizontal" data-vol-expand-mode="overlay">',
				'<audio class="a3m-audio" preload="none"></audio>',
				'<div class="a3m-mini">',
					'<button class="a3m-btn a3m-btn-sym a3m-mini-btn a3m-mini-ctl-play" type="button" ' +
						'data-act="toggle" title="Play / Pause">',
						esc(UI.icons.play),
					'</button>',
					'<button class="a3m-btn a3m-btn-small a3m-mini-btn a3m-mini-ctl-begin" type="button" ' +
						'data-act="stop" title="Begin">',
						esc(UI.text.begin),
					'</button>',
					'<div class="a3m-mini-line-text a3m-mini-ctl-title" data-role="mini-line-text">',
						esc(UI.text.title),
					'</div>',
					volumeControl('mini'),
					'<button class="a3m-btn a3m-btn-small a3m-mini-btn a3m-mini-ctl-mode" type="button" ' +
						'data-act="mode-next" data-role="mode-mini" title="Mode">',
						esc(UI.modes[state.mode]),
					'</button>',
					'<button class="a3m-btn a3m-btn-sym a3m-mini-btn a3m-mini-ctl-prev" type="button" ' +
						'data-act="prev" title="Previous">',
						esc(UI.icons.prev),
					'</button>',
					'<button class="a3m-btn a3m-btn-sym a3m-mini-btn a3m-mini-ctl-next" type="button" ' +
						'data-act="next" title="Next">',
						esc(UI.icons.next),
					'</button>',
					'<div class="a3m-mini-ctl-seek">',
						'<div class="a3m-progress a3m-range a3m-mini-progress a3m-mini-ctl-progress">',
							'<div class="a3m-progressbar">',
								'<div class="a3m-progressbuf" data-role="mini-buf"></div>',
								'<div class="a3m-progressplay" data-role="mini-play"></div>',
							'</div>',
							'<input type="range" min="0" max="1000" step="1" value="0" data-role="mini-seek" ' +
								'aria-label="Mini seek">',
						'</div>',
						'<div class="a3m-mini-time a3m-mini-ctl-time" data-role="mini-time">0:00 / 0:00</div>',
					'</div>',
					'<button class="a3m-btn a3m-btn-small a3m-mini-btn a3m-mini-ctl-playlist" type="button" ' +
						'data-act="playlist-toggle" title="Playlist">',
						esc(UI.text.list),
					'</button>',
				'</div>',
				'<div class="a3m-layout">',
					'<section class="a3m-main">',
						'<div class="a3m-trackblock">',
							'<div class="a3m-coverwrap">',
								'<button class="a3m-cover-btn" type="button" data-act="cover-open" title="Cover">',
									'<div class="a3m-cover is-missing" data-role="cover">',
										esc(UI.text.noCover),
									'</div>',
								'</button>',
							'</div>',
							'<div class="a3m-meta">',
								'<div class="a3m-headrow">',
									'<div class="a3m-headtext">',
										'<h1 class="a3m-tracktitle" data-role="title">',
											esc(UI.text.title),
										'</h1>',
										'<p class="a3m-subtitle" data-role="subtitle"></p>',
									'</div>',
									'<div class="a3m-nav">',
										'<button class="a3m-btn a3m-btn-small" type="button" data-act="refresh" title="Refresh">',
											esc(UI.text.refresh),
										'</button>',
										'<button class="a3m-btn a3m-btn-small" type="button" data-act="share" title="Share">',
											esc(UI.text.share),
										'</button>',
										'<button class="a3m-btn a3m-btn-small" type="button" data-act="mode-next" ' +
											'data-role="mode-main" title="Mode">',
											esc(UI.modes[state.mode]),
										'</button>',
									'</div>',
								'</div>',
								'<div class="a3m-times">',
									'<span data-role="time-now">00:00</span>',
									'<span data-role="time-total">00:00</span>',
								'</div>',
								'<div class="a3m-progress a3m-range">',
									'<div class="a3m-progressbar">',
										'<div class="a3m-progressbuf" data-role="buf"></div>',
										'<div class="a3m-progressplay" data-role="play"></div>',
									'</div>',
									'<input type="range" min="0" max="1000" step="1" value="0" data-role="seek" ' +
										'aria-label="Seek">',
								'</div>',
								'<div class="a3m-controlrow">',
									'<div class="a3m-controlrow-left">',
										'<button class="a3m-btn a3m-btn-sym" type="button" data-act="prev" title="Previous">',
											esc(UI.icons.prev),
										'</button>',
										'<button class="a3m-btn a3m-btn-sym" type="button" data-act="toggle" title="Play / Pause">',
											esc(UI.icons.play),
										'</button>',
										'<button class="a3m-btn a3m-btn-sym" type="button" data-act="stop" title="Stop">',
											esc(UI.icons.stop),
										'</button>',
										'<button class="a3m-btn a3m-btn-sym" type="button" data-act="next" title="Next">',
											esc(UI.icons.next),
										'</button>',
										'<button class="a3m-btn a3m-btn-sym" type="button" data-act="download-toggle" ' +
											'data-role="download-toggle" title="Downloads">',
											esc(UI.icons.download),
										'</button>',
									'</div>',
									'<div class="a3m-controlrow-right">',
										volumeControl('main'),
									'</div>',
								'</div>',
								'<div class="a3m-downloads a3m-hidden" data-role="downloads"></div>',
								'<div class="a3m-meta-grid" data-role="meta"></div>',
							'</div>',
						'</div>',
						'<div class="a3m-main-foot">',
							'<button class="a3m-btn a3m-btn-small" type="button" data-act="pos-cycle" ' +
								'data-role="pos-main" title="Playlist position"></button>',
							'<button class="a3m-btn a3m-btn-small" type="button" data-act="playlist-toggle" title="Playlist">',
								esc(UI.text.list),
							'</button>',
						'</div>',
					'</section>',
					'<aside class="a3m-side">',
						'<div class="a3m-side-head">',
							'<div class="a3m-list-tools">',
								viewButton('newest', 'N'),
								viewButton('album', 'A'),
								viewButton('year', 'Y'),
								viewButton('month', 'M'),
								viewButton('list', 'L'),
							'</div>',
							'<div class="a3m-side-top">',
								'<span class="a3m-note" data-role="count">0 tracks</span>',
							'</div>',
						'</div>',
						'<div class="a3m-list-wrap" data-role="list-wrap">',
							'<div class="a3m-empty" data-role="list-empty">Loading…</div>',
							'<div data-role="groups"></div>',
						'</div>',
						'<div class="a3m-list-foot">',
							'<button class="a3m-loadmore" type="button" data-act="load-more">',
								esc(UI.text.loadMore),
							'</button>',
							'<span data-role="foot-note">First page only by default.</span>',
						'</div>',
					'</aside>',
				'</div>',
				'<div class="a3m-toast" data-role="toast" data-kind="info"></div>',
			'</section>'
		].join('');

		dom.root = root;
		dom.player = root.querySelector('.a3m-player');
		dom.audio = root.querySelector('.a3m-audio');
		dom.mini = root.querySelector('.a3m-mini');
		dom.toast = pick('[data-role="toast"]');
		dom.title = pick('[data-role="title"]');
		dom.subtitle = pick('[data-role="subtitle"]');
		dom.meta = pick('[data-role="meta"]');
		dom.downloads = pick('[data-role="downloads"]');
		dom.downloadToggle = pick('[data-role="download-toggle"]');
		dom.cover = pick('[data-role="cover"]');
		dom.timeNow = pick('[data-role="time-now"]');
		dom.timeTotal = pick('[data-role="time-total"]');
		dom.seek = pick('[data-role="seek"]');
		dom.progressPlay = pick('[data-role="play"]');
		dom.progressBuf = pick('[data-role="buf"]');
		dom.miniSeek = pick('[data-role="mini-seek"]');
		dom.miniProgressPlay = pick('[data-role="mini-play"]');
		dom.miniProgressBuf = pick('[data-role="mini-buf"]');
		dom.miniTime = pick('[data-role="mini-time"]');
		dom.groups = pick('[data-role="groups"]');
		dom.listWrap = pick('[data-role="list-wrap"]');
		dom.listEmpty = pick('[data-role="list-empty"]');
		dom.count = pick('[data-role="count"]');
		dom.footNote = pick('[data-role="foot-note"]');
		dom.miniLineText = pick('[data-role="mini-line-text"]');
		dom.modeMini = pick('[data-role="mode-mini"]');
		dom.modeMain = pick('[data-role="mode-main"]');
		dom.posMain = pick('[data-role="pos-main"]');

		syncVolumeCssConfig();

		function pick(sel){
			return root.querySelector(sel);
		}
	}

	function viewButton(view, label){
		return '<button class="a3m-chip' +
			(validView(state.view) === view ? ' is-active' : '') +
			'" type="button" data-act="view" data-view="' +
			escAttr(view) + '">' + esc(label) + '</button>';
	}

	function volumeControl(context){
		const extraClass = context === 'mini' ? ' a3m-mini-ctl-vol' : '';
		return [
			'<div class="a3m-volhost' + extraClass + '" data-role="vol-host" data-vol-context="' +
				escAttr(context) + '">',
				'<div class="a3m-volctl" data-role="volctl" data-muted="0" data-level="high">',
					'<button class="a3m-volctl-mute" type="button" data-act="mute" data-role="vol-mute" ' +
						'title="Mute" aria-label="Mute">',
						esc(UI.icons.mute),
					'</button>',
					'<div class="a3m-volctl-slider">',
						'<div class="a3m-volctl-track"><div class="a3m-volctl-fill"></div></div>',
						'<input type="range" min="0" max="1000" step="1" value="1000" data-role="volume" ' +
							'aria-label="Volume">',
					'</div>',
				'</div>',
			'</div>'
		].join('');
	}

	function bindUi(){
		dom.root.addEventListener('click', onClick);
		dom.root.addEventListener('input', onRootInput);
		dom.root.addEventListener('change', onRootChange);
		dom.root.addEventListener('focusin', onRootFocusChange, true);
		dom.root.addEventListener('focusout', onRootFocusChange, true);
		dom.listWrap.addEventListener('scroll', onListScroll);
		dom.root.addEventListener('wheel', onWheel, { passive: false });
		document.addEventListener('keydown', onKey);
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('hashchange', onHashChange);
		window.addEventListener('pagehide', onPageHide);
		window.addEventListener('resize', syncVolumeCssConfig);
		bindPressUi();
		bindMiniVolUi();
		dom.player.addEventListener('mousemove', onFullUiActivity);
		dom.player.addEventListener('touchstart', onFullUiActivity, { passive: true });
	}

	function bindPressUi(){
		window.addEventListener('blur', onPressWindowBlur);

		if (window.PointerEvent) {
			document.addEventListener('pointerdown', onPressPointerDown, true);
			document.addEventListener('pointerup', onPressPointerEnd, true);
			document.addEventListener('pointercancel', onPressPointerCancel, true);
			return;
		}

		document.addEventListener('mousedown', onPressMouseDown, true);
		document.addEventListener('mouseup', onPressMouseEnd, true);
		document.addEventListener('touchstart', onPressTouchStart, { capture: true, passive: true });
		document.addEventListener('touchend', onPressTouchEnd, { capture: true, passive: true });
		document.addEventListener('touchcancel', onPressTouchCancel, { capture: true, passive: true });
	}

	function bindMiniVolUi(){
		if (window.PointerEvent) {
			document.addEventListener('pointerdown', onMiniVolPointerDown, true);
			document.addEventListener('pointerup', onMiniVolPointerUp, true);
			document.addEventListener('pointercancel', onMiniVolPointerCancel, true);
			return;
		}
		document.addEventListener('touchstart', onMiniVolTouchStart, { capture: true, passive: true });
		document.addEventListener('touchend', onMiniVolTouchEnd, { capture: true, passive: true });
		document.addEventListener('touchcancel', onMiniVolTouchCancel, { capture: true, passive: true });
	}

	function pressTargetElement(target){
		if (!target) return null;
		if (target.nodeType === 1) return target;
		return target.parentElement || null;
	}

	function pressNodesFromTarget(target){
		const node = pressTargetElement(target);
		const nodes = [];
		let button = null;
		let volctl = null;

		if (!node || !dom.root || !dom.root.contains(node)) return nodes;

		button = node.closest('button, .a3m-item');
		volctl = node.closest('[data-role="volctl"]');

		if (button && dom.root.contains(button)) nodes.push(button);
		if (volctl && dom.root.contains(volctl) && nodes.indexOf(volctl) < 0) nodes.push(volctl);

		return nodes;
	}

	function clearPressState(){
		for (let i = 0; i < state.pressNodes.length; i++) {
			state.pressNodes[i].removeAttribute('data-press');
		}
		state.pressNodes = [];
	}

	function applyPressState(target){
		const nodes = pressNodesFromTarget(target);
		let i = 0;

		clearPressState();

		for (i = 0; i < nodes.length; i++) nodes[i].setAttribute('data-press', '1');
		state.pressNodes = nodes;
	}

	function onPressWindowBlur(){
		clearPressState();
		syncVolFocusStateSoon();
	}

	function onPressPointerDown(e){
		if (e.button != null && e.button !== 0) return;
		applyPressState(e.target);
	}

	function onPressPointerEnd(){
		clearPressState();
		syncVolFocusStateSoon();
	}

	function onPressPointerCancel(){
		clearPressState();
		syncVolFocusStateSoon();
	}

	function onPressMouseDown(e){
		if (e.button != null && e.button !== 0) return;
		applyPressState(e.target);
	}

	function onPressMouseEnd(){
		clearPressState();
		syncVolFocusStateSoon();
	}

	function onPressTouchStart(e){
		applyPressState(e.target);
	}

	function onPressTouchEnd(){
		clearPressState();
		syncVolFocusStateSoon();
	}

	function onPressTouchCancel(){
		clearPressState();
		syncVolFocusStateSoon();
	}

	function onRootFocusChange(){
		syncVolFocusStateSoon();
	}

	function syncVolFocusStateSoon(){
		if (state.volFocusTimer) clearTimeout(state.volFocusTimer);
		state.volFocusTimer = setTimeout(function(){
			state.volFocusTimer = 0;
			syncVolFocusState();
		}, 0);
	}

	function hasFocusVisible(node){
		try {
			return !!node.querySelector(':focus-visible');
		} catch (e) {
			return !!(document.activeElement && node.contains(document.activeElement));
		}
	}

	function syncVolFocusState(){
		const nodes = dom.root
			? dom.root.querySelectorAll('[data-role="volctl"]')
			: [];
		for (let i = 0; i < nodes.length; i++) {
			if (hasFocusVisible(nodes[i])) nodes[i].setAttribute('data-focus-visible', '1');
			else nodes[i].removeAttribute('data-focus-visible');
		}
	}

	function bindAudio(){
		audio.addEventListener('loadedmetadata', onAudioMeta);
		audio.addEventListener('durationchange', onAudioMeta);
		audio.addEventListener('timeupdate', onTime);
		audio.addEventListener('progress', onProgress);
		audio.addEventListener('play', onPlayState);
		audio.addEventListener('pause', onPlayState);
		audio.addEventListener('ended', onEnded);
		audio.addEventListener('volumechange', onVolumeState);
		audio.addEventListener('waiting', function(){
			showToast('Waiting…', 'info', 1600);
			dispatch('a3m:waiting');
		});
		audio.addEventListener('canplay', function(){
			dispatch('a3m:track-ready');
		});
		audio.addEventListener('error', function(){
			fail(audio.error ? audio.error.message || 'Audio error.' : 'Audio error.');
		});
	}

	function restoreAudioPrefs(){
		const snap = state.session;
		const v = parseFloat(snap && snap.volume != null ? snap.volume : 1);
		audio.volume = clamp(isFinite(v) ? v : 1, 0, 1);
		audio.muted = snap && snap.muted ? true : false;
		state.lastMuted = !!audio.muted;
		paintVolume();
		paintPlayButtons();
	}

	async function resolveStartup(){
		const want = getHashKey();
		const snap = state.session;
		let target = want;
		let opened = false;
		let allowHashMissFallback = false;

		log('startup', {
			hash: want || '',
			sessionHash: snap && snap.hash || '',
			playlistOpen: state.playlistOpen
		});

		setBusy(true);

		if (!target && snap && snap.hash) {
			target = cleanText(snap.hash);
			if (target) history.replaceState(null, '', '#' + target);
		}

		allowHashMissFallback = !!target && CFG.allowHashMissFallback == 1;

		if (target) {
			state.currentHash = target;
			state.sessionRestoreHash = snap && cleanText(snap.hash) === target
				? target
				: '';
			opened = await openByHash(target);
		}

		if (!opened) {
			const ok = await ensureBlock(1, false);
			if (ok && !state.currentId) {
				if (!target || allowHashMissFallback) {
					if (!selectFirstLoaded()) showToast('No tracks found.', 'error', 3200);
				}
			}
		}

		setBusy(false);
		renderAll();
	}

	function rebuildFromCaches(){
		const keys = getLocalKeys(CFG.cachePrefix + 'block:' + CFG.cacheVer + ':');
		for (let i = 0; i < keys.length; i++) {
			const rec = restoreJson(keys[i], null);
			if (!rec || !rec.page || !Array.isArray(rec.raw)) continue;
			if (rec.totalKnownPages) {
				state.totalKnownPages = Math.max(
					state.totalKnownPages || 0,
					rec.totalKnownPages
				);
			}
			adoptBlock(rec.page, normalizeReleaseArray(rec.raw, rec.page));
		}
		if (state.tracks.length) sortTracks();
	}

	async function openByHash(key){
		key = cleanText(key);
		if (!key) return false;
		if (state.failedHash && state.failedHash !== key) clearFailedHash();
		if (hasFailedHash(key)) {
			log('openByHash skip failed', key);
			return false;
		}
		log('openByHash', key);

		const hit = findTrackByHash(key);
		if (hit) {
			clearFailedHash();
			openTrack(hit.id, false);
			return true;
		}

		let page = 1;
		for (;;) {
			if (state.totalKnownPages && page > state.totalKnownPages) break;
			if (state.blocks[page]) {
				const found = findTrackByHash(key);
				if (found) {
					clearFailedHash();
					openTrack(found.id, false);
					return true;
				}
				page++;
				continue;
			}
			const ok = await ensureBlock(page, false);
			if (!ok) break;
			const found = findTrackByHash(key);
			if (found) {
				clearFailedHash();
				openTrack(found.id, false);
				return true;
			}
			if (state.totalKnownPages && page >= state.totalKnownPages) break;
			page++;
		}

		noteFailedHash(key);
		state.error = 'Track not found.';
		renderStatus();
		showToast('Track not found.', 'error', 3600);
		return false;
	}

	function findTrackByHash(key){
		let i = 0;
		key = cleanText(key);
		if (!key) return null;
		for (i = 0; i < state.tracks.length; i++) {
			if (String(state.tracks[i].tag || '').indexOf(key) >= 0) return state.tracks[i];
		}
		return null;
	}

	function hasFailedHash(key){
		key = cleanText(key);
		if (!key || state.failedHash !== key) return false;
		if (!state.failedHashAt) return false;
		if (Date.now() >= state.failedHashAt + CFG.failedHashMs) {
			clearFailedHash();
			return false;
		}
		return true;
	}

	function noteFailedHash(key){
		state.failedHash = cleanText(key);
		state.failedHashAt = Date.now();
	}

	function clearFailedHash(){
		state.failedHash = '';
		state.failedHashAt = 0;
	}

	async function ensureBlock(page, force){
		page = parseInt(page, 10) || 1;
		if (state.blocks[page] && !force) return true;
		if (state.inflight[page]) return state.inflight[page];

		const seq = ++state.requestSeq;
		state.inflight[page] = fetchBlock(page, force).then(function(ok){
			delete state.inflight[page];
			if (seq >= state.requestSeq) renderAll();
			return ok;
		}).catch(function(e){
			delete state.inflight[page];
			fail(e);
			return false;
		});

		return state.inflight[page];
	}

	function hasFreshCache(cached, field, now, freshMs, force){
		return !force && cached && cached[field] && cached.fetchedAt && now < cached.fetchedAt + freshMs;
	}

	function applyCacheHeaders(headers, cached, force){
		if (force || !cached) return;
		if (cached.etag) headers['If-None-Match'] = cached.etag;
		if (cached.lastModified) headers['If-Modified-Since'] = cached.lastModified;
	}

	function finishCached(adopt){
		adopt();
		setBusy(false);
		showToast('Cache used.', 'info', 900);
	}

	function finishCached304(key, cached, now, adopt){
		cached.fetchedAt = now;
		storeJson(key, cached);
		finishCached(adopt);
	}

	async function fetchBlock(page, force){
		log('block', page, force ? 'force' : 'normal');
		setBusy(true);
		showToast('Loading…', 'info', 1200);

		const key = CFG.cachePrefix + 'block:' + CFG.cacheVer + ':' + page;
		const now = Date.now();
		const cached = restoreJson(key, null);
		const freshMs = page === 1 ? CFG.freshMsFirst : CFG.freshMsOther;

		if (hasFreshCache(cached, 'raw', now, freshMs, force)) {
			log('block cache hit', page);
			finishCached(function(){
				adoptBlock(page, normalizeReleaseArray(cached.raw, page));
			});
			return true;
		}

		const headers = {
			'Accept': 'application/vnd.github+json'
		};

		applyCacheHeaders(headers, cached, force);

		const url = CFG.api +
			'?page=' + encodeURIComponent(page) +
			'&per_page=' + encodeURIComponent(CFG.apiPerPage);
		const res = await fetchGitApi(url, {
			headers: headers,
			cache: 'no-store'
		});

		if (res.status === 304 && cached && Array.isArray(cached.raw)) {
			log('block 304', page);
			finishCached304(key, cached, now, function(){
				adoptBlock(page, normalizeReleaseArray(cached.raw, page));
			});
			return true;
		}

		if (!res.ok) {
			handleHttpIssue(res, cached);
			setBusy(false);
			return !!cached;
		}

		const raw = await res.json();
		const link = res.headers.get('Link') || '';
		const etag = res.headers.get('ETag') || '';
		const lastModified = res.headers.get('Last-Modified') || '';
		state.totalKnownPages = inferLastPage(link, raw, page);

		const rec = {
			page: page,
			raw: raw,
			fetchedAt: now,
			etag: etag,
			lastModified: lastModified,
			totalKnownPages: state.totalKnownPages
		};

		storeJson(key, rec);
		adoptBlock(page, normalizeReleaseArray(raw, page));
		setBusy(false);
		return true;
	}

	function inferLastPage(link, data, page){
		if (Array.isArray(data) && data.length < CFG.apiPerPage) return page;
		const m = /[?&]page=(\d+)>;\s*rel="last"/i.exec(link);
		if (m) return parseInt(m[1], 10) || null;
		return state.totalKnownPages;
	}

	function handleHttpIssue(res, cached){
		warn('http issue', res.status);
		const remain = res.headers.get('x-ratelimit-remaining');
		const reset = res.headers.get('x-ratelimit-reset');
		if (res.status === 403 || res.status === 429) {
			if (remain === '0' && reset) {
				const t = new Date(parseInt(reset, 10) * 1000);
				showToast(
					'Rate limited. Cache kept. Reset around ' +
					t.toLocaleTimeString() + '.',
					'error',
					5200
				);
			} else {
				showToast('Request limited. Cache kept.', 'error', 4200);
			}
		} else {
			showToast('Request failed. ' + res.status + '.', 'error', 4200);
		}
		if (cached && Array.isArray(cached.raw)) {
			adoptBlock(cached.page || 1, normalizeReleaseArray(cached.raw, cached.page || 1));
		}
		if (cached && cached.raw && !Array.isArray(cached.raw)) {
			adoptTrack(normalizeRelease(cached.raw, 0));
		}
	}

	function adoptBlock(page, items){
		if (!Array.isArray(items)) return;
		state.blocks[page] = {
			page: page,
			items: items
		};
		for (let i = 0; i < items.length; i++) adoptTrack(items[i]);
		sortTracks();
		updateFootNote();
	}

	function adoptTrack(track){
		if (!track || !track.id) return;
		const old = state.trackByKey[track.id];
		if (old) {
			state.trackByKey[track.id] = mergeTrack(old, track);
			mirrorTrack(state.trackByKey[track.id]);
		} else {
			state.trackByKey[track.id] = track;
			state.tracks.push(track);
			mirrorTrack(track);
		}
		if (track.tag && track.sourceBlock) state.index.blockByTag[track.tag] = track.sourceBlock;
	}

	function mirrorTrack(track){
		state.trackByKey[track.tag] = track;
		state.trackByKey[track.id] = track;
	}

	function mergeTrack(a, b){
		const out = {};
		const keys = Object.keys(a).concat(Object.keys(b));
		for (let i = 0; i < keys.length; i++) {
			const k = keys[i];
			if (
				b[k] != null &&
				b[k] !== '' &&
				(!(Array.isArray(b[k])) || b[k].length)
			) {
				out[k] = b[k];
			} else {
				out[k] = a[k];
			}
		}
		return out;
	}

	function sortTracks(){
		state.tracks.sort(function(a, b){
			if (a.sortTime !== b.sortTime) return b.sortTime - a.sortTime;
			return String(a.title).localeCompare(String(b.title));
		});
	}

	function normalizeReleaseArray(arr, page){
		const out = [];
		if (!Array.isArray(arr)) return out;
		for (let i = 0; i < arr.length; i++) {
			const t = normalizeRelease(arr[i], page);
			if (t) out.push(t);
		}
		return out;
	}

	function normalizeRelease(release, page){
		if (!release || !release.id) return null;
		const assets = Array.isArray(release.assets) ? release.assets : [];
		const bodyMeta = parseBodyMeta(release.body || '');
		const rawTag = cleanText(release.tag_name || '');
		const parsedName = parseTrackStem(rawTag);
		const tag = rawTag;
		const title = firstText(
			bodyMeta.title,
			parsedName.title,
			cleanTitle(rawTag || tag)
		);
		const album = firstText(
			bodyMeta.album,
			bodyMeta.release,
			bodyMeta.collection,
			parsedName.album,
			'Single'
		);
		const artist = firstText(
			bodyMeta.artist,
			parsedName.artist,
			joinArtistMeta(bodyMeta.composer, bodyMeta.creator),
			'AAAM / Dogon'
		);
		const dateRaw = firstText(
			bodyMeta.date,
			bodyMeta.day,
			parsedName.date,
			yymmddFromTag(rawTag),
			release.published_at,
			release.created_at
		);
		const stamp = safeDate(
			dateRaw,
			release.published_at ||
			release.created_at ||
			release.updated_at
		);
		const year = firstText(
			bodyMeta.year,
			parsedName.year,
			yearFromLooseDate(dateRaw),
			yearFromLooseDate(release.published_at),
			yearFromLooseDate(release.created_at),
			yearFromLooseDate(release.updated_at)
		);
		const updatedRaw = firstText(bodyMeta.updated, release.updated_at);
		const updated = updatedRaw ? formatLooseDate(updatedRaw, '') : '';
		const info = extractAssets(assets);
		const ym = yearMonth(stamp, year);
		const downloadFormats = info.downloads;
		const primary = pickPrimaryFormat(downloadFormats);
		const trackNum = cleanTrackNum(
			bodyMeta.track ||
			bodyMeta.trackno ||
			bodyMeta.track_number ||
			bodyMeta.number ||
			''
		);
		const id = 'rel-' + release.id;

		return {
			id: id,
			tag: tag,
			title: title,
			artist: artist,
			album: album,
			trackNum: trackNum,
			date: formatDate(dateRaw, stamp),
			updated: updated,
			year: year || ym.year,
			month: ym.month,
			cover: info.cover || '',
			primaryUrl: primary ? primary.url : '',
			playFormat: primary ? primary.ext : '',
			formats: downloadFormats,
			sourceBlock: page,
			sortTime: stamp ? stamp.getTime() : 0
		};
	}

	function extractAssets(assets){
		let cover = '';
		const downloads = [];
		const seen = {};

		for (let i = 0; i < assets.length; i++) {
			const a = assets[i];
			const name = String(a.name || '');
			const ext = extname(name);
			if (!cover && /^(jpg|jpeg|png|webp)$/i.test(ext)) {
				cover = a.browser_download_url || '';
				continue;
			}
			if (!/^(opus|flac|m4a|ogg|mp3|wav|aac)$/i.test(ext)) continue;
			if (seen[ext]) continue;
			seen[ext] = 1;
			downloads.push({
				name: name,
				ext: ext.toLowerCase(),
				url: a.browser_download_url || '',
				size: humanBytes(a.size || 0),
				count: a.download_count || 0
			});
		}

		downloads.sort(function(a, b){
			return orderOf(CFG.downloadOrder, a.ext) - orderOf(CFG.downloadOrder, b.ext);
		});

		return {
			cover: cover,
			downloads: downloads
		};
	}

	function pickPrimaryFormat(formats){
		for (let i = 0; i < CFG.playFormatOrder.length; i++) {
			for (let j = 0; j < formats.length; j++) {
				if (formats[j].ext === CFG.playFormatOrder[i]) return formats[j];
			}
		}
		return formats[0] || null;
	}

	function parseBodyMeta(body){
		const out = {};
		const lines = String(body || '').split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!/=/.test(line)) continue;
			const p = line.split('=');
			const k = cleanText(p.shift().replace(/^TAG:/i, '')).toLowerCase();
			const v = cleanText(p.join('='));
			if (!k || !v) continue;
			out[k] = v;
		}
		return out;
	}

	function renderAll(){
		renderStatus();
		renderModeButtons();
		renderListButtons();
		renderPosButton();
		renderViews();
		renderPlaylistState();
		renderCurrent();
		renderList();
		paintProgress();
		paintVolume();
		paintPlayButtons();
		renderDownloadToggle();
		syncVolumeCssConfig();
		syncDocumentMode();
		syncVolFocusStateSoon();
	}

	function renderStatus(){
		dom.player.setAttribute('data-busy', state.loading ? '1' : '0');
		dom.player.setAttribute('data-error', state.error ? '1' : '0');
	}

	function renderModeButtons(){
		const label = UI.modes[validMode(state.mode)];
		dom.player.setAttribute('data-mode', validMode(state.mode));
		if (dom.modeMini) {
			dom.modeMini.textContent = label;
			dom.modeMini.title = 'Mode: ' + state.mode;
		}
		if (dom.modeMain) {
			dom.modeMain.textContent = label;
			dom.modeMain.title = 'Mode: ' + state.mode;
		}
	}

	function renderListButtons(){
		const nodes = dom.root.querySelectorAll('[data-act="playlist-toggle"]');
		for (let i = 0; i < nodes.length; i++) {
			nodes[i].textContent = UI.text.list;
			nodes[i].title = 'Playlist';
			nodes[i].classList.toggle('is-active', !!state.playlistOpen);
		}
	}

	function renderPosButton(){
		const pos = effectiveListPos();
		const label = UI.text.pos + ':' + UI.listPos[pos];
		if (dom.posMain) {
			dom.posMain.textContent = label;
			dom.posMain.title = state.mode === 'full'
				? 'Playlist position: top (fullscreen)'
				: 'Playlist position';
		}
	}

	function renderViews(){
		updateActive('[data-act="view"]', 'data-view', validView(state.view));
	}

	function renderPlaylistState(){
		dom.player.setAttribute('data-list-open', state.playlistOpen ? '1' : '0');
		dom.player.setAttribute('data-list-pos', effectiveListPos());
		dom.player.setAttribute('data-full-ui', state.fullUiVisible ? '1' : '0');
	}

	function effectiveListPos(){
		return state.mode === 'full' ? 'top' : state.listPos;
	}

	function updateActive(sel, attr, want){
		const nodes = dom.root.querySelectorAll(sel);
		for (let i = 0; i < nodes.length; i++) {
			nodes[i].classList.toggle('is-active', nodes[i].getAttribute(attr) === want);
		}
	}

	function currentTrack(){
		return state.currentId ? state.trackByKey[state.currentId] || null : null;
	}

	function renderCurrent(){
		const t = currentTrack();
		if (!t) {
			dom.title.textContent = UI.text.title;
			dom.subtitle.textContent = state.tracks.length ? '' : UI.text.noTracks;
			dom.meta.innerHTML = '';
			dom.downloads.innerHTML = '';
			dom.downloads.classList.add('a3m-hidden');
			dom.cover.className = 'a3m-cover is-missing';
			dom.cover.textContent = UI.text.noCover;
			dom.cover.removeAttribute('src');
			dom.miniLineText.textContent = UI.text.title;
			dom.timeNow.textContent = '00:00';
			dom.timeTotal.textContent = '00:00';
			dom.miniTime.textContent = '0:00 / 0:00';
			dom.player.style.backgroundImage = '';
			document.title = 'A3M Listen';
			return;
		}

		document.title = t.title + ' - A3M Listen';
		dom.title.textContent = t.title;
		dom.subtitle.textContent = [ t.artist, t.album, t.date ].filter(Boolean).join(' · ');
		dom.miniLineText.textContent = [ t.title, t.album, t.date ].filter(Boolean).join(' / ');

		dom.meta.innerHTML =
			metaItem('Title', t.title) +
			metaItem('Artist', t.artist) +
			metaItem('Album', t.album) +
			(t.trackNum ? metaItem('Track', t.trackNum) : '') +
			metaItem('Date', t.date) +
			(t.updated ? metaItem('Updated', t.updated) : '') +
			metaItem('Format', t.playFormat ? t.playFormat.toUpperCase() : '');

		dom.downloads.innerHTML = renderDownloads(t);
		dom.downloads.classList.toggle('a3m-hidden', !state.downloadOpen);

		if (t.cover) {
			const img = new Image();
			img.className = 'a3m-cover';
			img.alt = t.title + ' cover';
			img.src = t.cover;
			dom.cover.replaceWith(img);
			dom.cover = img;
		} else {
			const miss = document.createElement('div');
			miss.className = 'a3m-cover is-missing';
			miss.textContent = UI.text.noCover;
			dom.cover.replaceWith(miss);
			dom.cover = miss;
		}

		if (state.mode === 'full' && t.cover) {
			dom.player.style.backgroundImage = 'url("' + cssUrl(t.cover) + '")';
		} else {
			dom.player.style.backgroundImage = '';
		}
	}

	function renderDownloads(t){
		if (!t.formats || !t.formats.length) {
			return '<span class="a3m-note">' + esc(UI.text.noDownloads) + '</span>';
		}
		let html = '';
		for (let i = 0; i < t.formats.length; i++) {
			const f = t.formats[i];
			html += '<a href="' + escAttr(f.url) + '" target="_blank" rel="noreferrer">' +
				'<strong>' + esc(f.ext.toUpperCase()) + '</strong>' +
				'<span class="a3m-note">' +
					esc([ f.size, f.count ? (f.count + ' dl') : '' ].filter(Boolean).join(' · ')) +
				'</span></a>';
		}
		return html;
	}

	function renderDownloadToggle(){
		if (!dom.downloadToggle) return;
		dom.downloadToggle.classList.toggle('is-active', !!state.downloadOpen);
	}

	function renderList(){
		const groups = groupedTracks(validView(state.view));
		let count = 0;
		for (let i = 0; i < groups.length; i++) count += groups[i].items.length;
		dom.count.textContent = count + 't'; // tracks
		dom.listEmpty.classList.toggle('a3m-hidden', count > 0);
		dom.listEmpty.textContent = count
			? ''
			: UI.text.noTracks;
		dom.groups.innerHTML = renderGroupsHtml(groups);
		applyListRowsVisible();
	}

	function groupedTracks(view){
		const list = state.tracks.slice();
		const out = [];
		if (!list.length) return out;

		if (view === 'list' || view === 'newest') {
			out.push({
				label: view === 'newest' ? 'Newest first' : 'Tracks',
				items: list
			});
			return out;
		}

		const map = {};
		for (let i = 0; i < list.length; i++) {
			const t = list[i];
			let k = '';
			if (view === 'album') k = t.album || 'Single';
			else if (view === 'year') k = t.year || 'Unknown year';
			else if (view === 'month') k = t.month || 'Unknown month';
			if (!map[k]) map[k] = [];
			map[k].push(t);
		}

		const keys = Object.keys(map);
		keys.sort(function(a, b){
			if (view === 'year' || view === 'month') return String(b).localeCompare(String(a));
			return String(a).localeCompare(String(b));
		});

		for (let i = 0; i < keys.length; i++) {
			out.push({
				label: keys[i],
				items: map[keys[i]]
			});
		}
		return out;
	}

	function renderGroupsHtml(groups){
		let html = '';
		for (let i = 0; i < groups.length; i++) {
			const g = groups[i];
			html += '<section class="a3m-group"><h3>' + esc(g.label) + '</h3><ul class="a3m-list">';
			for (let j = 0; j < g.items.length; j++) {
				const t = g.items[j];
				html += '<li><button class="a3m-item' +
					(state.currentId === t.id ? ' is-current' : '') +
					'" type="button" data-act="track" data-id="' +
					escAttr(t.id) + '">' +
					'<span class="a3m-item-main"><span class="a3m-item-hint">' +
					esc(UI.icons.hint) +
					'</span><span class="a3m-item-title">' +
					esc(t.title) +
					'</span></span><span class="a3m-item-meta">' +
					esc([ t.album, t.date ].filter(Boolean).join(' · ')) +
					'</span></button></li>';
			}
			html += '</ul></section>';
		}
		return html;
	}

	function metaItem(k, v){
		return '<div class="a3m-meta-item"><span class="a3m-meta-key">' +
			esc(k) + '</span><span class="a3m-meta-val">' +
			esc(v || '') + '</span></div>';
	}

	function openTrack(id, autoplay){
		const t = state.trackByKey[id];
		if (!t) return;
		log('open track', t.tag, autoplay === false ? 'prepare' : 'play');
		clearFailedHash();
		state.pendingSession =
			state.sessionRestoreHash &&
			state.session &&
			state.sessionRestoreHash === t.tag &&
			cleanText(state.session.hash) === t.tag
				? state.session
				: null;
		state.sessionRestoreHash = '';
		state.currentId = t.id;
		state.currentHash = t.tag;
		state.error = '';
		state.downloadOpen = false;
		renderStatus();
		renderCurrent();
		renderList();
		if (t.primaryUrl) {
			if (audio.src !== t.primaryUrl) {
				audio.src = t.primaryUrl;
				audio.load();
				dispatch('a3m:track-load', { track: t });
			}
			if (autoplay !== false) {
				audio.play().then(function(){
					dispatch('a3m:play', { track: t });
				}).catch(function(){
					showToast('Press play.', 'info', 1200);
				});
			} else if (state.pendingSession && state.pendingSession.playing) {
				showToast('Restoring session…', 'info', 1600);
			}
		} else {
			showToast('No playable format.', 'error', 3200);
		}
		updateHash(t.tag);
		saveSessionState();
	}

	function selectFirstLoaded(){
		if (!state.tracks.length) return false;
		openTrack(state.tracks[0].id, false);
		return true;
	}

	function nextTrack(dir){
		const list = state.tracks.slice();
		if (!list.length) return;
		if (!state.currentId) {
			openTrack(list[0].id, true);
			return;
		}
		let idx = list.findIndex(function(t){ return t.id === state.currentId; });
		if (idx < 0) idx = 0;
		idx += dir;
		if (idx < 0) idx = list.length - 1;
		if (idx >= list.length) idx = 0;
		openTrack(list[idx].id, true);
	}

	function stopTrack(){
		audio.pause();
		try { audio.currentTime = 0; } catch (e) {}
		saveSessionState();
		dispatch('a3m:stop');
		paintProgress();
		paintPlayButtons();
	}

	function toggleTrack(){
		const t = currentTrack();
		if (!t) {
			if (selectFirstLoaded()) audio.play().catch(function(){});
			return;
		}
		if (audio.paused) audio.play().catch(function(){});
		else audio.pause();
	}

	function onClick(e){
		const el = e.target.closest('[data-act]');
		if (!el) return;
		const act = el.getAttribute('data-act');

		if (act === 'track') return void openTrack(el.getAttribute('data-id'), true);
		if (act === 'mode-next') return void cycleMode();
		if (act === 'view') return void setView(el.getAttribute('data-view'));
		if (act === 'toggle') return void toggleTrack();
		if (act === 'stop') return void stopTrack();
		if (act === 'prev') return void nextTrack(-1);
		if (act === 'next') return void nextTrack(1);
		if (act === 'refresh') return void refreshCurrentScope();
		if (act === 'load-more') return void loadMore();
		if (act === 'share') return void copyCurrentLink();
		if (act === 'mute') {
			if (
				miniVolMuteFromTarget(el) &&
				state.miniVolSuppressClickAt &&
				Date.now() < state.miniVolSuppressClickAt + 1000
			) {
				state.miniVolSuppressClickAt = 0;
				return;
			}
			return void toggleMute();
		}
		if (act === 'playlist-toggle') return void togglePlaylist();
		if (act === 'pos-cycle') return void cyclePlaylistPos();
		if (act === 'download-toggle') {
			state.downloadOpen = !state.downloadOpen;
			renderCurrent();
			renderDownloadToggle();
			return;
		}
		if (act === 'cover-open') return void coverOpen();
	}

	function onRootInput(e){
		const role = e.target && e.target.getAttribute('data-role');
		if (role === 'seek' || role === 'mini-seek') return void onSeekInput(e);
		if (role === 'volume') return void onVolumeInput(e);
	}

	function onRootChange(e){
		const role = e.target && e.target.getAttribute('data-role');
		if (role === 'seek' || role === 'mini-seek') return void onSeekChange(e);
	}

	function onSeekInput(e){
		state.seeking = true;
		paintProgress(previewTime(e.target));
	}

	function onSeekChange(e){
		const t = currentTrack();
		if (!t || !isFinite(audio.duration) || audio.duration <= 0) {
			state.seeking = false;
			return;
		}
		audio.currentTime = (parseFloat(e.target.value || '0') / 1000) * audio.duration;
		state.seeking = false;
		saveSessionState();
		paintProgress();
	}

	function onVolumeInput(e){
		setVolumeValue(parseFloat(e.target.value || '1000') / 1000);
	}

	function onListScroll(){
		const n = dom.listWrap;
		if (n.scrollTop + n.clientHeight >= n.scrollHeight - 120) loadMoreSoft();
	}

	function onWheel(e){
		if (!e.target.closest('[data-role="vol-host"]')) return;
		e.preventDefault();
		stepVolume(e.deltaY < 0 ? 0.05 : -0.05);
	}

	function onKey(e){
		if (ignoreKey(e)) return;
		if (state.mode === 'full') showFullUi();
		const k = e.key;
		if (e.code === 'Backquote') {
			e.preventDefault();
			toggleLastToast();
			return;
		}
		if (k === ' ') {
			e.preventDefault();
			toggleTrack();
			return;
		}
		if (k === 'Escape') {
			if (state.mode === 'full') {
				exitFullMode();
				return;
			}
			hideToast(true);
			return;
		}

		const low = String(k).toLowerCase();
		if (low === 'p') return void toggleTrack();
		if (low === 'q') return void stopTrack();
		if (low === 'r') return void refreshCurrentScope();
		if (low === 's') return void shuffleLoaded();
		if (low === 'l') return void togglePlaylist();
		if (low === 'm') return void toggleMute();
		if (low === 'i') return void infoNow();
		if (low === 'e') return void cycleMode();
		if (low === '1') return void setMode('minimal');
		if (low === '2') return void setMode('medium');
		if (low === '3') return void setMode('full');
		if (k === ',' || k === '<') return void nextTrack(-1);
		if (k === '.' || k === '>') return void nextTrack(1);
		if (k === '-') return void stepVolume(-0.05);
		if (k === '=') return void stepVolume(0.05);
		if (k === 'ArrowUp') {
			e.preventDefault();
			moveSelection(-1);
			return;
		}
		if (k === 'ArrowDown') {
			e.preventDefault();
			moveSelection(1);
			return;
		}
		if (k === 'Enter') {
			e.preventDefault();
			if (state.currentId) openTrack(state.currentId, true);
			return;
		}
	}

	function onVisibility(){
		if (document.visibilityState === 'hidden') {
			clearPressState();
			closeMiniVol();
			saveSessionState();
			syncVolFocusStateSoon();
		}
	}

	function onPageHide(){
		clearPressState();
		closeMiniVol();
		saveSessionState();
		syncVolFocusStateSoon();
	}

	function onHashChange(){
		const key = getHashKey();
		if (!key || key === state.currentHash) return;
		log('hashchange', key);
		state.currentHash = key;
		state.sessionRestoreHash =
			state.session && cleanText(state.session.hash) === key
				? key
				: '';
		openByHash(key).catch(function(e){
			fail(e);
		});
	}

	function onAudioMeta(){
		applyPendingSession();
		paintProgress();
	}

	function onTime(){
		const now = Date.now();
		if (now - state.lastTimePaint < CFG.maxSeekUpdateMs && !state.seeking) return;
		state.lastTimePaint = now;
		paintProgress();
		if (!audio.paused && now - state.lastSessionSave >= CFG.sessionSaveMs) {
			saveSessionState();
		}
		dispatch('a3m:time', {
			currentTime: audio.currentTime,
			duration: audio.duration
		});
	}

	function onProgress(){
		paintProgress();
		dispatch('a3m:progress');
	}

	function onPlayState(){
		paintPlayButtons();
		saveSessionState();
		renderStatus();
		dispatch(audio.paused ? 'a3m:pause' : 'a3m:play');
	}

	function onVolumeState(){
		const muted = !!audio.muted;
		paintVolume();
		saveSessionState();
		dispatch('a3m:volume', {
			volume: audio.volume,
			muted: muted
		});
		if (state.lastMuted !== muted) {
			state.lastMuted = muted;
			dispatch('a3m:mute', { muted: muted });
		}
	}

	function onEnded(){
		dispatch('a3m:stop');
		nextTrack(1);
	}

	function onFullUiActivity(){
		if (state.mode !== 'full') return;
		showFullUi();
	}

	function showFullUi(){
		state.fullUiVisible = true;
		renderPlaylistState();
		if (state.fullUiTimer) clearTimeout(state.fullUiTimer);
		state.fullUiTimer = setTimeout(function(){
			state.fullUiVisible = false;
			renderPlaylistState();
		}, CFG.fullUiHideMs);
	}

	function getMiniVolHost(){
		return dom.root
			? dom.root.querySelector('.a3m-volhost[data-vol-context="mini"]')
			: null;
	}

	function miniVolUsesCollapsedMode(host){
		host = host || getMiniVolHost();
		return !!(host && host.getAttribute('data-vol-display-effective') === 'mini');
	}

	function miniVolMuteFromTarget(target){
		return target && target.closest
			? target.closest('.a3m-volhost[data-vol-context="mini"] [data-role="vol-mute"]')
			: null;
	}

	function miniVolSliderFromTarget(target){
		return target && target.closest
			? target.closest('.a3m-volhost[data-vol-context="mini"] .a3m-volctl-slider')
			: null;
	}

	function isMiniVolOpen(){
		const host = getMiniVolHost();
		return !!(host && miniVolUsesCollapsedMode(host) && host.getAttribute('data-vol-open') === '1');
	}

	function isMiniVolReady(){
		const host = getMiniVolHost();
		return !!(host && miniVolUsesCollapsedMode(host) && host.getAttribute('data-vol-ready') === '1');
	}

	function clearMiniVolTimer(){
		if (state.miniVolTimer) clearTimeout(state.miniVolTimer);
		state.miniVolTimer = 0;
	}

	function startMiniVolTimer(){
		const host = getMiniVolHost();
		clearMiniVolTimer();
		if (!host || !miniVolUsesCollapsedMode(host) || host.getAttribute('data-vol-ready') !== '1') return;
		state.miniVolTimer = setTimeout(function(){
			closeMiniVol();
		}, CFG.miniVolIdleMs);
	}

	function openMiniVolPreview(pointerId){
		const host = getMiniVolHost();
		if (!host || !miniVolUsesCollapsedMode(host)) return;
		clearMiniVolTimer();
		host.setAttribute('data-vol-open', '1');
		host.setAttribute('data-vol-ready', '0');
		state.miniVolPreviewPointerId = pointerId;
		state.miniVolAction = 'preview';
		state.miniVolActionPointerId = null;
		state.miniVolSuppressClickAt = Date.now();
	}

	function unlockMiniVol(){
		const host = getMiniVolHost();
		if (!host || !miniVolUsesCollapsedMode(host)) return;
		host.setAttribute('data-vol-open', '1');
		host.setAttribute('data-vol-ready', '1');
		state.miniVolPreviewPointerId = null;
		state.miniVolAction = '';
		state.miniVolActionPointerId = null;
		startMiniVolTimer();
	}

	function closeMiniVol(){
		const host = getMiniVolHost();
		clearMiniVolTimer();
		state.miniVolPreviewPointerId = null;
		state.miniVolAction = '';
		state.miniVolActionPointerId = null;
		if (!host) return;
		host.removeAttribute('data-vol-open');
		host.removeAttribute('data-vol-ready');
	}

	function sameMiniVolPointer(a, b){
		return a == null || b == null || a === b;
	}

	function handleMiniVolTouchStart(target, pointerId){
		const host = getMiniVolHost();
		if (!host || !host.contains(target) || !miniVolUsesCollapsedMode(host)) return;

		if (!isMiniVolOpen()) {
			openMiniVolPreview(pointerId);
			return;
		}

		if (!isMiniVolReady()) return;

		clearMiniVolTimer();
		state.miniVolActionPointerId = pointerId;

		if (miniVolMuteFromTarget(target)) {
			state.miniVolAction = 'mute';
			state.miniVolSuppressClickAt = Date.now();
			toggleMute();
			return;
		}

		if (miniVolSliderFromTarget(target)) {
			state.miniVolAction = 'slider';
			return;
		}

		state.miniVolAction = 'host';
	}

	function handleMiniVolTouchEnd(pointerId, cancelled){
		if (cancelled) {
			closeMiniVol();
			return;
		}

		if (state.miniVolAction === 'preview') {
			if (sameMiniVolPointer(pointerId, state.miniVolPreviewPointerId)) unlockMiniVol();
			return;
		}

		if (state.miniVolAction) {
			if (sameMiniVolPointer(pointerId, state.miniVolActionPointerId)) {
				state.miniVolAction = '';
				state.miniVolActionPointerId = null;
				startMiniVolTimer();
			}
		}
	}

	function onMiniVolPointerDown(e){
		const host = getMiniVolHost();
		if (host && isMiniVolOpen() && !host.contains(e.target)) {
			closeMiniVol();
			return;
		}
		if (e.pointerType === 'mouse') return;
		handleMiniVolTouchStart(e.target, e.pointerId);
	}

	function onMiniVolPointerUp(e){
		if (e.pointerType === 'mouse') return;
		handleMiniVolTouchEnd(e.pointerId, false);
	}

	function onMiniVolPointerCancel(e){
		if (e.pointerType === 'mouse') return;
		handleMiniVolTouchEnd(e.pointerId, true);
	}

	function onMiniVolTouchStart(e){
		const host = getMiniVolHost();
		if (host && isMiniVolOpen() && !host.contains(e.target)) {
			closeMiniVol();
			return;
		}
		handleMiniVolTouchStart(e.target, null);
	}

	function onMiniVolTouchEnd(){
		handleMiniVolTouchEnd(null, false);
	}

	function onMiniVolTouchCancel(){
		handleMiniVolTouchEnd(null, true);
	}

	function paintPlayButtons(){
		const play = !audio.paused;
		const nodes = dom.root.querySelectorAll('[data-act="toggle"]');
		for (let i = 0; i < nodes.length; i++) {
			nodes[i].textContent = play ? UI.icons.pause : UI.icons.play;
			nodes[i].classList.toggle('is-playing', play);
		}
	}

	function paintProgress(preview){
		const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
		const cur = typeof preview === 'number'
			? preview
			: (isFinite(audio.currentTime) ? audio.currentTime : 0);
		const p = dur > 0 ? clamp(cur / dur, 0, 1) : 0;
		const b = bufferedRatio();
		const pw = Math.round(p * 1000) / 10 + '%';
		const bw = Math.round(b * 1000) / 10 + '%';
		dom.progressPlay.style.width = pw;
		dom.progressBuf.style.width = bw;
		dom.miniProgressPlay.style.width = pw;
		dom.miniProgressBuf.style.width = bw;
		dom.seek.value = String(Math.round(p * 1000));
		dom.miniSeek.value = dom.seek.value;
		dom.timeNow.textContent = fmtTime(cur);
		dom.timeTotal.textContent = fmtTime(dur);
		dom.miniTime.textContent = fmtTime(cur) + ' / ' + fmtTime(dur);
	}

	function bufferedRatio(){
		try {
			if (
				!audio.buffered ||
				!audio.buffered.length ||
				!isFinite(audio.duration) ||
				audio.duration <= 0
			) {
				return 0;
			}
			return clamp(audio.buffered.end(audio.buffered.length - 1) / audio.duration, 0, 1);
		} catch (e) {
			return 0;
		}
	}

	function previewTime(input){
		const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
		return dur * (parseFloat((input || dom.seek).value || '0') / 1000);
	}

	function paintVolume(){
		const actual = clamp(audio.volume, 0, 1);
		const shown = audio.muted ? 0 : actual;
		const icon = audio.muted || actual <= 0 ? UI.icons.muted : UI.icons.mute;
		const level = actual <= 0 ? 'zero' : (actual < 0.5 ? 'low' : 'high');
		const value = String(Math.round(actual * 1000));
		const label = audio.muted ? 'Unmute' : 'Mute';
		const controls = dom.root.querySelectorAll('[data-role="volctl"]');
		const inputs = dom.root.querySelectorAll('[data-role="volume"]');
		const buttons = dom.root.querySelectorAll('[data-role="vol-mute"]');

		for (let i = 0; i < controls.length; i++) {
			controls[i].setAttribute('data-muted', audio.muted ? '1' : '0');
			controls[i].setAttribute('data-level', level);
			controls[i].style.setProperty('--a3m-vol-level', String(shown));
		}
		for (let i = 0; i < inputs.length; i++) inputs[i].value = value;
		for (let i = 0; i < buttons.length; i++) {
			buttons[i].textContent = icon;
			buttons[i].title = label;
			buttons[i].setAttribute('aria-label', label);
			buttons[i].setAttribute('aria-pressed', audio.muted ? 'true' : 'false');
		}
	}

	function setVolumeValue(value){
		audio.volume = clamp(value, 0, 1);
		if (audio.volume > 0 && audio.muted) audio.muted = false;
	}

	function stepVolume(step){
		setVolumeValue(audio.volume + step);
	}

	function toggleMute(){
		audio.muted = !audio.muted;
	}

	function setMode(mode){
		mode = validMode(mode);
		if (mode === state.mode) return;

		if (mode === 'full' && state.mode !== 'full') {
			state.prevMode = state.mode;
			state.prevPlaylistOpen = state.playlistOpen ? 1 : 0;
			state.playlistOpen = false;
		} else if (
			state.mode === 'full' &&
			mode !== 'full' &&
			state.prevPlaylistOpen != null
		) {
			state.playlistOpen = !!state.prevPlaylistOpen;
			state.prevPlaylistOpen = null;
		}

		state.mode = mode;

		if (state.mode === 'full') {
			showFullUi();
		} else {
			state.fullUiVisible = true;
			if (state.fullUiTimer) clearTimeout(state.fullUiTimer);
		}

		renderAll();
		saveSessionState();
		dispatch('a3m:mode-change', { mode: state.mode });
		showToast('Mode: ' + state.mode, 'info', 1000);
	}

	function cycleMode(){
		const list = [ 'minimal', 'medium', 'full' ];
		let i = list.indexOf(validMode(state.mode));
		if (i < 0) i = 0;
		i = (i + 1) % list.length;
		setMode(list[i]);
	}

	function exitFullMode(){
		setMode(state.prevMode && state.prevMode !== 'full' ? state.prevMode : CFG.defaultMode);
	}

	function setView(view){
		state.view = validView(view);
		saveSessionState();
		renderViews();
		renderList();
		dispatch('a3m:view-change', { view: state.view });
	}

	function cyclePlaylistPos(){
		if (state.mode === 'full') {
			showToast('Playlist position fixed in fullscreen.', 'info', 1200);
			return;
		}
		let i = CFG.listPosModes.indexOf(state.listPos);
		if (i < 0) i = 0;
		i = (i + 1) % CFG.listPosModes.length;
		state.listPos = CFG.listPosModes[i];
		saveSessionState();
		renderPosButton();
		renderPlaylistState();
	}

	function togglePlaylist(){
		state.playlistOpen = !state.playlistOpen;
		if (state.mode === 'full') showFullUi();
		renderPlaylistState();
		saveSessionState();
		showToast(
			state.playlistOpen ? 'Playlist shown.' : 'Playlist hidden.',
			'info',
			1200
		);
	}

	function coverOpen(){
		if (state.mode === 'full') exitFullMode();
		else setMode('full');
	}

	async function loadMore(){
		const next = nextBlockPage();
		if (!next) return;
		await ensureBlock(next, false);
	}

	function loadMoreSoft(){
		const next = nextBlockPage();
		if (!next) return;
		ensureBlock(next, false);
	}

	function nextBlockPage(){
		const next = highestLoadedPage() + 1;
		if (state.totalKnownPages && next > state.totalKnownPages) return 0;
		return next;
	}

	function highestLoadedPage(){
		let n = 0;
		const keys = Object.keys(state.blocks);
		for (let i = 0; i < keys.length; i++) {
			n = Math.max(n, parseInt(keys[i], 10) || 0);
		}
		return n;
	}

	function failedHashSecs(){
		return Math.round(CFG.failedHashMs / 1000);
	}

	function failedHashWaitSecs(){
		if (!state.failedHashAt) return 0;
		return Math.max(0, Math.ceil((state.failedHashAt + CFG.failedHashMs - Date.now()) / 1000));
	}

	async function refreshCurrentScope(){
		if (state.refreshInflight) {
			log('refresh skip inflight');
			showToast('Refresh already pending.', 'info', 1000);
			return;
		}

		state.refreshInflight = 1;

		try {
			showToast('Refreshing…', 'info', 1200);
			const changed = await refreshReleaseSnapshot();
			const want = getHashKey();

			if (changed == null) return;

			if (want && hasFailedHash(want)) {
				const wait = failedHashWaitSecs();
				showToast('Track not found. Retry paused for ' + wait + ' s.', 'error', 1400);
				log('refresh skip failed hash', want, 'retry paused ' + wait + 's');
				return;
			}

			if (want) {
				const hit = findTrackByHash(want);
				if (hit) {
					openTrack(hit.id, false);
					return;
				}
				await openByHash(want);
				return;
			}

			if (!state.currentId && state.tracks.length) {
				openTrack(state.tracks[0].id, false);
				return;
			}

			renderAll();
		} finally {
			state.refreshInflight = 0;
		}
	}

	async function refreshReleaseSnapshot(){
		const key = CFG.cachePrefix + 'block:' + CFG.cacheVer + ':1';
		const now = Date.now();
		const cached = restoreJson(key, null);
		const headers = {
			'Accept': 'application/vnd.github+json'
		};
		log("refreshReleaseSnapshot", key, now);
		setBusy(true);
		applyCacheHeaders(headers, cached, false);

		const url = CFG.api +
			'?page=1' +
			'&per_page=' + encodeURIComponent(CFG.apiPerPage);
		const res = await fetchGitApi(url, {
			headers: headers,
			cache: 'no-store'
		});

		if (res.status === 304 && cached && Array.isArray(cached.raw)) {
			cached.fetchedAt = now;
			storeJson(key, cached);
			adoptBlock(1, normalizeReleaseArray(cached.raw, 1));
			setBusy(false);
			showToast('Latest cache still current.', 'ok', 1200);
			return false;
		}

		if (!res.ok) {
			handleHttpIssue(res, cached);
			setBusy(false);
			return null;
		}

		clearReleaseRuntime();
		clearReleaseCaches();

		const raw = await res.json();
		const link = res.headers.get('Link') || '';
		const etag = res.headers.get('ETag') || '';
		const lastModified = res.headers.get('Last-Modified') || '';
		state.totalKnownPages = inferLastPage(link, raw, 1);

		storeJson(key, {
			page: 1,
			raw: raw,
			fetchedAt: now,
			etag: etag,
			lastModified: lastModified,
			totalKnownPages: state.totalKnownPages
		});

		adoptBlock(1, normalizeReleaseArray(raw, 1));
		setBusy(false);
		showToast('Latest releases reloaded.', 'ok', 1200);
		return true;
	}

	function clearReleaseRuntime(){
		state.blocks = {};
		state.tracks = [];
		state.trackByKey = {};
		state.index = {
			blockByTag: {}
		};
		state.totalKnownPages = null;
		state.currentId = '';
		state.error = '';
	}

	function clearReleaseCaches(){
		clearStoragePrefix(CFG.cachePrefix + 'block:' + CFG.cacheVer + ':');
	}

	function clearStoragePrefix(prefix){
		clearStoragePrefixIn(localStorage, prefix);
		clearStoragePrefixIn(sessionStorage, prefix);
	}

	function clearStoragePrefixIn(store, prefix){
		const keys = [];
		try {
			for (let i = 0; i < store.length; i++) {
				const k = store.key(i);
				if (k && k.indexOf(prefix) === 0) keys.push(k);
			}
			for (let i = 0; i < keys.length; i++) store.removeItem(keys[i]);
		} catch (e) {}
	}

	function shuffleLoaded(){
		if (!state.tracks.length) return;
		const arr = state.tracks.slice();
		for (let i = arr.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const t = arr[i];
			arr[i] = arr[j];
			arr[j] = t;
		}
		state.tracks = arr;
		saveSessionState();
		renderList();
		showToast('Shuffle.', 'info', 1000);
		openTrack(state.tracks[0].id, true);
	}

	function moveSelection(dir){
		const list = state.tracks.slice();
		if (!list.length) return;
		if (!state.currentId) {
			openTrack(list[0].id, false);
			return;
		}
		let idx = list.findIndex(function(t){ return t.id === state.currentId; });
		if (idx < 0) idx = 0;
		idx = clamp(idx + dir, 0, list.length - 1);
		openTrack(list[idx].id, false);
		scrollCurrentIntoView();
	}

	function scrollCurrentIntoView(){
		const n = dom.root.querySelector('.a3m-item.is-current');
		if (n) n.scrollIntoView({ block: 'nearest' });
	}

	function infoNow(){
		const t = currentTrack();
		if (!t) return;
		showToast([
			t.title,
			t.album,
			t.playFormat ? t.playFormat.toUpperCase() : '',
			t.date
		].filter(Boolean).join(' · '), 'info', 2400);
	}

	function copyCurrentLink(){
		const t = currentTrack();
		const url = location.origin + location.pathname + (t ? ('#' + t.tag) : '');
		if (!navigator.clipboard || !navigator.clipboard.writeText) {
			showToast('Clipboard not available.', 'error', 2400);
			return;
		}
		navigator.clipboard.writeText(url).then(function(){
			showToast('Link copied.', 'ok', 1200);
		}).catch(function(){
			showToast('Could not copy link.', 'error', 2400);
		});
	}

	function updateHash(tag){
		if (!tag) return;
		state.currentHash = tag;
		if (location.hash.replace(/^#/, '') === tag) return;
		history.replaceState(null, '', '#' + tag);
	}

	function getHashKey(){
		return cleanText(location.hash.replace(/^#/, ''));
	}

	function updateFootNote(){
		const pages = Object.keys(state.blocks).length;
		const total = state.totalKnownPages ? ('/' + state.totalKnownPages) : '';
		dom.footNote.textContent = 'Lp: ' + pages + total; // Loaded Pages
	}

	function applyListRowsVisible(){
		const item = dom.root.querySelector('.a3m-item');
		if (!item) return;
		const h = Math.max(28, Math.ceil(item.getBoundingClientRect().height));
		dom.listWrap.style.maxHeight = (h * CFG.listRowsVisible) + 'px';
	}

	function setBusy(on){
		state.loading = !!on;
		renderStatus();
	}

	function showToast(text, kind, hold){
		if (!text) return;
		state.lastNotice = { text: text, kind: kind || 'info' };
		dom.toast.textContent = text;
		dom.toast.setAttribute('data-kind', kind || 'info');
		dom.toast.classList.add('is-open');
		if (state.toastTimer) clearTimeout(state.toastTimer);
		if (!state.toastSticky) {
			state.toastTimer = setTimeout(function(){
				hideToast(false);
			}, hold || 2200);
		}
	}

	function hideToast(force){
		if (state.toastSticky && !force) return;
		if (state.toastTimer) clearTimeout(state.toastTimer);
		state.toastTimer = 0;
		state.toastSticky = false;
		dom.toast.classList.remove('is-open');
	}

	function toggleLastToast(){
		if (!state.lastNotice.text) return;
		state.toastSticky = !state.toastSticky;
		if (state.toastSticky) showToast(state.lastNotice.text, state.lastNotice.kind, 0);
		else hideToast(true);
	}

	function fail(e){
		state.error = String(e && e.message ? e.message : e || 'Error.');
		state.loading = false;
		renderStatus();
		err(state.error);
		showToast(state.error, 'error', 4800);
	}

	function dispatch(name, detail){
		dom.player.dispatchEvent(new CustomEvent(name, {
			bubbles: true,
			detail: detail || {}
		}));
	}

	function applyPendingSession(){
		const snap = state.pendingSession;
		let time = 0;

		if (!snap) return;
		state.pendingSession = null;
		time = parseFloat(snap.time);
		if (!isFinite(time) || time < 0) time = 0;

		try {
			if (isFinite(audio.duration) && audio.duration > 0) {
				time = clamp(time, 0, audio.duration);
			}
			audio.currentTime = time;
		} catch (e) {}

		paintProgress();
		saveSessionState();
		log('session restore', snap.hash, time, snap.playing ? 'play' : 'pause');
		showToast('Session restored.', 'ok', 1400);

		if (snap.playing) {
			audio.play().then(function(){
				dispatch('a3m:play', { track: currentTrack() });
			}).catch(function(){
				showToast('Press play.', 'info', 1200);
			});
		}
	}

	function saveSessionState(){
		const t = currentTrack();
		const snap = {
			hash: t ? t.tag : getHashKey(),
			time: isFinite(audio.currentTime) ? audio.currentTime : 0,
			playing: audio && !audio.paused ? 1 : 0,
			volume: audio ? audio.volume : 1,
			muted: audio && audio.muted ? 1 : 0,
			mode: validMode(state.mode),
			prevMode: validMode(state.prevMode),
			view: validView(state.view),
			listPos: validListPos(state.listPos),
			playlistOpen: state.playlistOpen ? 1 : 0,
			savedAt: Date.now()
		};

		state.session = snap;
		state.lastSessionSave = snap.savedAt;
		storePlayerSession(snap);
	}

	function fetchWithTimeout(url, opts){
		const ctl = new AbortController();
		const timer = setTimeout(function(){ ctl.abort(); }, CFG.timeoutMs);
		const o = opts || {};
		o.signal = ctl.signal;
		log("fetch wt", url);
		return fetch(url, o).finally(function(){
			clearTimeout(timer);
		});
	}

	function syncDocumentMode(){
		const on = state.mode === 'full';
		try { document.documentElement.style.overflow = on ? 'hidden' : ''; } catch (e) {}
		try { document.body.style.overflow = on ? 'hidden' : ''; } catch (e) {}
	}

	function syncVolumeCssConfig(){
		let style = null;
		let axis = '';
		let mode = '';
		if (
			!dom.root ||
			!dom.player ||
			typeof getComputedStyle !== 'function'
		) {
			return;
		}
		style = getComputedStyle(dom.root);
		axis = cleanText(style.getPropertyValue('--a3m-vol-expand-axis')).toLowerCase();
		mode = cleanText(style.getPropertyValue('--a3m-vol-expand-mode')).toLowerCase();
		if (!/^(horizontal|vertical)$/.test(axis)) axis = 'horizontal';
		if (!/^(overlay|push)$/.test(mode)) mode = 'overlay';
		dom.player.setAttribute('data-vol-axis', axis);
		dom.player.setAttribute('data-vol-expand-mode', mode);
		syncVolumeDisplayModes(style);
	}

	function syncVolumeDisplayModes(style){
		const hosts = dom.root.querySelectorAll('[data-role="vol-host"]');
		for (let i = 0; i < hosts.length; i++) syncVolumeDisplayMode(hosts[i], style);
		syncMiniLayoutState();
	}

	function syncVolumeDisplayMode(host, style){
		const context = host.getAttribute('data-vol-context') || '';
		const want = validVolDisplay(style.getPropertyValue(
			context === 'mini'
				? '--a3m-mini-vol-display'
				: '--a3m-main-vol-display'
		));
		const effective = want === 'auto'
			? resolveAutoVolDisplay(host, style)
			: want;
		host.setAttribute('data-vol-display', want);
		host.setAttribute('data-vol-display-effective', effective);
		if (context === 'mini' && effective !== 'mini') closeMiniVol();
	}

	function resolveAutoVolDisplay(host, style){
		let box = null;
		let minWide = 0;
		let minNarrow = 0;
		let narrow = false;

		if ((host.getAttribute('data-vol-context') || '') !== 'mini') return 'full';

		box = host.closest('.a3m-mini');
		if (!box) return 'full';

		narrow = miniLayoutIsNarrow(box);
		minWide = parsePx(style.getPropertyValue('--a3m-mini-vol-auto-min-wide'), 520);
		minNarrow = parsePx(style.getPropertyValue('--a3m-mini-vol-auto-min-narrow'), 400);

		if (box.clientWidth < (narrow ? minNarrow : minWide)) return 'mini';

		return miniHasAutoVolRoom(box, style, narrow)
			? 'full'
			: 'mini';
	}

	function syncMiniLayoutState(){
		const box = dom.mini;
		const host = getMiniVolHost();

		if (!box) return;

		box.setAttribute('data-mini-layout', miniLayoutIsNarrow(box) ? 'narrow' : 'wide');
		box.setAttribute(
			'data-mini-vol-effective',
			host ? (host.getAttribute('data-vol-display-effective') || 'mini') : 'mini'
		);
	}

	function miniHasAutoVolRoom(box, style, narrow){
		const gap = miniGapPx(box, style);
		const vol = parsePx(style.getPropertyValue('--a3m-volume-width'), 88);

		if (narrow) {
			return box.clientWidth - (
				outerWidth(box.querySelector('.a3m-mini-ctl-play')) +
				outerWidth(box.querySelector('.a3m-mini-ctl-prev')) +
				outerWidth(box.querySelector('.a3m-mini-ctl-next')) +
				outerWidth(box.querySelector('.a3m-mini-ctl-playlist')) +
				gap * 5
			) >= vol + 16;
		}

		return box.clientWidth - (
			outerWidth(box.querySelector('.a3m-mini-ctl-play')) +
			outerWidth(box.querySelector('.a3m-mini-ctl-begin')) +
			outerWidth(box.querySelector('.a3m-mini-ctl-mode')) +
			gap * 4
		) >= vol + 140;
	}

	function miniLayoutIsNarrow(box){
		const begin = box && box.querySelector('.a3m-mini-ctl-begin');
		return !!(begin && getComputedStyle(begin).display === 'none');
	}

	function miniGapPx(box, style){
		let gap = 0;
		if (box && typeof getComputedStyle === 'function') {
			gap = parseFloat(getComputedStyle(box).columnGap);
			if (isFinite(gap)) return gap;
		}
		gap = parseFloat(style.getPropertyValue('--a3m-gap-s'));
		return isFinite(gap) ? gap : 8;
	}

	function outerWidth(node){
		return node ? Math.ceil(node.getBoundingClientRect().width) : 0;
	}

	function parsePx(value, fallback){
		const n = parseFloat(value);
		return isFinite(n) ? n : fallback;
	}

	function validMode(v){
		return /^(minimal|medium|full)$/.test(v || '') ? v : CFG.defaultMode;
	}

	function validView(v){
		return CFG.groupViews.indexOf(v) >= 0 ? v : CFG.defaultView;
	}

	function validListPos(v){
		return CFG.listPosModes.indexOf(v) >= 0 ? v : CFG.defaultListPos;
	}

	function validVolDisplay(v){
		v = cleanText(v).toLowerCase();
		return /^(auto|mini|full)$/.test(v) ? v : 'auto';
	}

	function ignoreKey(e){
		const t = e.target;
		if (!t) return false;
		if (t.isContentEditable) return true;
		const tag = String(t.tagName || '').toLowerCase();
		return tag === 'input' || tag === 'textarea';
	}

	function cleanTitle(s){
		s = cleanText(s);
		s = s.replace(/\s*-\s*aaam(?:\/dogon)?$/i, '');
		return s || 'Untitled';
	}

	function cleanText(s){
		return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
	}

	function firstText(){
		for (let i = 0; i < arguments.length; i++) {
			const v = cleanText(arguments[i]);
			if (v) return v;
		}
		return '';
	}

	function cleanTrackNum(s){
		s = cleanText(s);
		const m = /\d+/.exec(s);
		return m ? m[0] : '';
	}

	function extname(s){
		const m = /\.([a-z0-9]+)$/i.exec(String(s || ''));
		return m ? m[1].toLowerCase() : '';
	}

	function orderOf(arr, v){
		const i = arr.indexOf(v);
		return i >= 0 ? i : 999;
	}

	function humanBytes(n){
		n = parseInt(n, 10) || 0;
		if (!n) return '';
		const u = [ 'B', 'KB', 'MB', 'GB' ];
		let i = 0;
		let x = n;
		while (x >= 1024 && i < u.length - 1) {
			x /= 1024;
			i++;
		}
		return (x >= 10 || i === 0 ? Math.round(x) : x.toFixed(1)) + ' ' + u[i];
	}

	function yymmddFromTag(tag){
		const m = /^(\d{2})(\d{2})(\d{2})(?:[-_]|$)/.exec(cleanText(tag || ''));
		return m ? ('20' + m[1] + '-' + m[2] + '-' + m[3]) : '';
	}

	function parseTrackStem(s){
		const out = {
			title: '',
			album: '',
			artist: '',
			year: '',
			date: ''
		};
		let stem = cleanText(String(s || '').replace(/\.[a-z0-9]{1,6}$/i, ''));
		let m = /^(\d{6})(?:[-_]|$)/.exec(stem);
		let parts = [];
		let tokens = [];
		let marks = [];
		let cut = 0;
		let yearIdx = -1;
		let aaamIdx = -1;
		let artistTokens = [];

		if (m) {
			out.date = m[1];
			stem = stem.slice(m[0].length);
		}

		if (stem.indexOf('--') >= 0) {
			parts = stem.split('--');
			out.title = humanizeSlug(parts.shift() || '');
			tokens = stripTrackTailMarkers(splitTrackTokens(parts.join('--')));

			for (let i = 0; i < tokens.length; i++) {
				if (yearIdx < 0 && /^(19|20)\d{2}$/.test(tokens[i])) yearIdx = i;
				if (aaamIdx < 0 && /^aaam$/i.test(tokens[i])) aaamIdx = i;
			}

			if (yearIdx >= 0) marks.push(yearIdx);
			if (aaamIdx >= 0) marks.push(aaamIdx);
			cut = marks.length ? Math.min.apply(Math, marks) : tokens.length;

			out.album = humanizeSlug(tokens.slice(0, cut).join('-'));
			out.year = yearIdx >= 0 ? tokens[yearIdx] : '';

			artistTokens = tokens.slice(cut).filter(function(tok){
				return !/^(?:aaam|album)$/i.test(tok) && !/^(19|20)\d{2}$/.test(tok);
			});
			out.artist = formatArtistTokens(artistTokens);
			return out;
		}

		tokens = stripTrackTailMarkers(splitTrackTokens(stem));

		for (let i = 0; i < tokens.length; i++) {
			if (yearIdx < 0 && /^(19|20)\d{2}$/.test(tokens[i])) yearIdx = i;
			if (aaamIdx < 0 && /^aaam$/i.test(tokens[i])) aaamIdx = i;
		}

		if (yearIdx >= 0) marks.push(yearIdx);
		if (aaamIdx >= 0) marks.push(aaamIdx);
		cut = marks.length ? Math.min.apply(Math, marks) : tokens.length;

		out.title = humanizeSlug(tokens.slice(0, cut).join('-'));
		out.year = yearIdx >= 0 ? tokens[yearIdx] : '';

		artistTokens = tokens.slice(cut).filter(function(tok){
			return !/^(?:aaam|album)$/i.test(tok) && !/^(19|20)\d{2}$/.test(tok);
		});
		out.artist = formatArtistTokens(artistTokens);
		return out;
	}

	function splitTrackTokens(s){
		const parts = cleanText(s).split(/[-_]+/);
		const out = [];
		for (let i = 0; i < parts.length; i++) {
			const part = cleanText(parts[i]);
			if (part) out.push(part);
		}
		return out;
	}

	function stripTrackTailMarkers(tokens){
		const out = tokens.slice();
		while (out.length && /^(album|single|ep|release)$/i.test(out[out.length - 1])) out.pop();
		return out;
	}

	function formatArtistTokens(tokens){
		const out = [];
		for (let i = 0; i < tokens.length; i++) {
			const part = humanizeSlug(tokens[i]);
			if (part) out.push(part);
		}
		return out.join(' / ');
	}

	function humanizeSlug(s){
		const words = cleanText(String(s || '').replace(/[_-]+/g, ' ')).split(/\s+/);
		const out = [];
		for (let i = 0; i < words.length; i++) {
			const word = formatHumanWord(words[i], i, words.length);
			if (word) out.push(word);
		}
		return out.join(' ');
	}

	function formatHumanWord(word, idx, len){
		const low = cleanText(word).toLowerCase();
		if (!low) return '';
		if (low === 'aaam') return 'AAAM';
		if (/^\d+$/.test(low)) return low;
		if (
			idx > 0 &&
			idx < len - 1 &&
			/^(a|an|and|as|at|but|by|for|from|in|nor|of|on|or|the|to)$/.test(low)
		) {
			return low;
		}
		return low.charAt(0).toUpperCase() + low.slice(1);
	}

	function joinArtistMeta(){
		const out = [];
		for (let i = 0; i < arguments.length; i++) {
			const v = cleanText(arguments[i]);
			if (v && out.indexOf(v) < 0) out.push(v);
		}
		return out.join(' / ');
	}

	function safeDate(a, b){
		return parseLooseDate(a) || parseLooseDate(b) || null;
	}

	function parseLooseDate(s){
		s = cleanText(s);
		if (!s) return null;
		let m = /^(\d{2})(\d{2})(\d{2})$/.exec(s);
		if (m) return buildDate(2000 + parseInt(m[1], 10), m[2], m[3]);
		m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
		if (m) return buildDate(m[1], m[2], m[3]);
		m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
		if (m) return buildDate(m[1], m[2], m[3]);
		m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
		if (m) return buildDate(m[3], m[2], m[1]);
		const d = new Date(s);
		return isFinite(d.getTime()) ? d : null;
	}

	function buildDate(y, m, d){
		y = parseInt(y, 10) || 0;
		m = parseInt(m, 10) || 0;
		d = parseInt(d, 10) || 0;
		if (y < 1000 || m < 1 || m > 12 || d < 1 || d > 31) return null;
		const out = new Date(y, m - 1, d, 12, 0, 0, 0);
		if (out.getFullYear() !== y || out.getMonth() !== m - 1 || out.getDate() !== d) return null;
		return out;
	}

	function yearFromLooseDate(s){
		const d = parseLooseDate(s);
		return d ? String(d.getFullYear()) : '';
	}

	function yearMonth(d, fallbackYear){
		if (!d) return { year: cleanText(fallbackYear), month: '' };
		const y = String(d.getFullYear());
		const m = d.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long'
		});
		return { year: y, month: m };
	}

	function formatDate(raw, d){
		if (d) {
			return d.toLocaleDateString('en-GB', {
				day: '2-digit',
				month: 'short',
				year: 'numeric'
			});
		}
		return cleanText(raw);
	}

	function formatLooseDate(raw, fallback){
		const d = safeDate(raw, fallback || '');
		if (!d) return cleanText(raw || fallback || '');
		return d.toLocaleDateString('en-GB', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		}) + ' ' + d.toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function fmtTime(n){
		n = isFinite(n) && n > 0 ? Math.floor(n) : 0;
		const m = Math.floor(n / 60);
		const s = n % 60;
		const h = Math.floor(m / 60);
		const mm = h ? String(m % 60).padStart(2, '0') : String(m);
		const ss = String(s).padStart(2, '0');
		return h ? (h + ':' + mm + ':' + ss) : (mm + ':' + ss);
	}

	function cssUrl(s){
		return String(s == null ? '' : s)
			.replace(/\\/g, '\\\\')
			.replace(/"/g, '\\"');
	}

	function esc(s){
		return String(s == null ? '' : s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function escAttr(s){
		return esc(s).replace(/'/g, '&#39;');
	}

	function clamp(n, a, b){
		return Math.min(b, Math.max(a, n));
	}

	function restoreJson(k, fallback){
		const v = sessionStorage.getItem(k) || localStorage.getItem(k);
		if (!v) return fallback;
		try {
			return JSON.parse(v);
		} catch (e) {
			return fallback;
		}
	}

	function storeJson(k, v){
		try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
		try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
	}

	function loadPlayerSession(){
		let v = '';
		try { v = sessionStorage.getItem('a3m-session'); } catch (e) {}
		if (!v) return null;
		try {
			return JSON.parse(v);
		} catch (e) {
			return null;
		}
	}

	function storePlayerSession(v){
		try { sessionStorage.setItem('a3m-session', JSON.stringify(v)); } catch (e) {}
	}

	function getLocalKeys(prefix){
		const out = [];
		try {
			for (let i = 0; i < localStorage.length; i++) {
				const k = localStorage.key(i);
				if (k && k.indexOf(prefix) === 0) out.push(k);
			}
		} catch (e) {}
		return out;
	}
})();
