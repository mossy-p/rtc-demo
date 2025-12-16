<script lang="ts">
	import { onMount } from 'svelte';
	import { gameEngine, type GameState } from '$lib/game-engine.svelte';
	import { gameSync } from '$lib/game-sync.svelte';

	// Auth & Room
	let token = $state('');
	let userId = $state('');
	let roomId = $state('');
	let roomCode = $state('');
	let displayName = $state('');

	// WebSocket
	let ws: WebSocket | null = $state(null);
	let connected = $state(false);

	// WebRTC
	let peerConnections = $state<Map<string, RTCPeerConnection>>(new Map());
	let localStream: MediaStream | null = $state(null);

	// Game
	let isHost = $state(false);
	let gameInitialized = $state(false);
	let error = $state('');

	// Reactive derived values
	let gameState = $derived(gameEngine.currentState);
	let players = $derived(gameState?.players || {});
	let status = $derived(gameState?.status || 'waiting');

	// Determine if we should show the game interface
	let shouldShowGame = $derived((isHost && gameInitialized) || (!isHost && gameSync.receivedInitialState));

	// Debug effect - logs when state changes
	$effect(() => {
		console.log('[UI] State changed:', {
			connected,
			gameInitialized,
			hasGameState: !!gameState,
			status,
			playerCount: Object.keys(players).length,
			isHost,
			receivedInitialState: gameSync.receivedInitialState,
			shouldShowGame
		});
	});

	const RTC_URL = 'https://rtc.mossp.me';
	const WS_URL = 'wss://rtc.mossp.me';

	onMount(async () => {
		// Load token
		const savedToken = localStorage.getItem('rtc_token');
		const savedUserId = localStorage.getItem('rtc_user_id');
		if (savedToken && savedUserId) {
			token = savedToken;
			userId = savedUserId;
		}

		// Load WASM
		try {
			await gameEngine.load();
		} catch (err: any) {
			error = `Failed to load game engine: ${err.message}`;
		}

		return () => cleanup();
	});

	function cleanup() {
		if (ws) ws.close();
		gameSync.cleanup();
		if (localStream) {
			localStream.getTracks().forEach(t => t.stop());
		}
		for (const pc of peerConnections.values()) {
			pc.close();
		}
	}

	async function createRoom() {
		error = '';
		if (!displayName.trim()) {
			error = 'Please enter your name';
			return;
		}

		try {
			// Create room via API
			const response = await fetch(`${RTC_URL}/api/rooms`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${token}`
				},
				body: JSON.stringify({ maxPlayers: 4 })
			});

			if (!response.ok) throw new Error(`Failed: ${response.status}`);

			const data = await response.json();
			roomId = data.roomId;
			roomCode = data.code;
			isHost = true;

			// Connect to room
			await connectToRoom();

			// Initialize game engine as host
			gameSync.setHost(true);
			const result = await gameEngine.initialize({
				gameType: 'simple',
				maxPlayers: 4,
				hostID: userId,
				hostName: displayName
			});

			if (result.success) {
				gameInitialized = true;
			} else {
				error = result.error || 'Failed to initialize game';
			}
		} catch (e: any) {
			error = e.message;
		}
	}

	async function joinRoom() {
		error = '';
		if (!roomCode.trim() || !displayName.trim()) {
			error = 'Please enter room code and name';
			return;
		}

		isHost = false;
		gameSync.setHost(false);
		await connectToRoom();
	}

	async function connectToRoom() {
		error = '';
		try {
			// Get camera/mic
			localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

			// Connect to WebSocket
			ws = new WebSocket(`${WS_URL}/ws/signal/${roomCode}?displayName=${encodeURIComponent(displayName)}`);

			ws.onopen = () => {
				connected = true;
			};

			ws.onmessage = async (e) => {
				const data = JSON.parse(e.data);
				await handleSignalingMessage(data);
			};

			ws.onerror = () => { error = 'WebSocket error'; };
			ws.onclose = () => { connected = false; };
		} catch (e: any) {
			error = e.message;
		}
	}

	async function handleSignalingMessage(data: any) {
		const fromPeerID = data.from;

		if (data.type === 'join' && fromPeerID !== userId) {
			// New peer joined - create offer
			if (isHost) {
				await createPeerConnection(fromPeerID, true);
			}
		} else if (data.type === 'offer') {
			await createPeerConnection(fromPeerID, false);
			const pc = peerConnections.get(fromPeerID);
			if (pc) {
				await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }));
				const answer = await pc.createAnswer();
				await pc.setLocalDescription(answer);
				ws!.send(JSON.stringify({ type: 'answer', sdp: answer.sdp }));
			}
		} else if (data.type === 'answer') {
			const pc = peerConnections.get(fromPeerID);
			if (pc) {
				await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
			}
		} else if (data.type === 'candidate' && data.candidate) {
			const pc = peerConnections.get(fromPeerID);
			if (pc) {
				await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
			}
		} else if (data.type === 'leave') {
			const pc = peerConnections.get(fromPeerID);
			if (pc) {
				pc.close();
				peerConnections.delete(fromPeerID);
			}
		}
	}

	async function createPeerConnection(peerID: string, createOffer: boolean) {
		const pc = new RTCPeerConnection({
			iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
		});

		// Add local stream
		if (localStream) {
			localStream.getTracks().forEach(track => pc.addTrack(track, localStream!));
		}

		// ICE candidate handler
		pc.onicecandidate = (event) => {
			if (event.candidate && ws && connected) {
				ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
			}
		};

		peerConnections.set(peerID, pc);

		// Add to game sync (creates data channel)
		gameSync.addPeerConnection(peerID, pc);

		// Create offer if needed
		if (createOffer) {
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			ws!.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));
		}
	}

	// Game actions
	async function toggleReady() {
		error = '';
		try {
			await gameSync.sendAction(userId, 'ready', {});
		} catch (err: any) {
			error = err.message;
		}
	}

	async function startGame() {
		error = '';
		try {
			await gameSync.sendAction(userId, 'start', {});
		} catch (err: any) {
			error = err.message;
		}
	}

	async function movePlayer(x: number, y: number) {
		error = '';
		try {
			await gameSync.sendAction(userId, 'move', { x, y });
		} catch (err: any) {
			error = err.message;
		}
	}

	function handleGameAreaClick(event: MouseEvent) {
		if (status !== 'active') return;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		movePlayer(x, y);
	}
</script>

<div class="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
	<div class="container mx-auto px-4 py-8">
		<header class="text-center mb-8">
			<h1 class="text-5xl font-bold text-white mb-4">Multiplayer Game Demo</h1>
			<p class="text-slate-300 text-lg">WebRTC + Go WASM Game Sync</p>
		</header>

		{#if error}
			<div class="bg-red-500/20 border border-red-500 text-red-200 px-6 py-4 rounded-lg mb-6 max-w-2xl mx-auto">
				{error}
			</div>
		{/if}

		{#if !connected}
			<!-- Room Setup -->
			<div class="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
				<div class="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
					<h2 class="text-2xl font-semibold text-white mb-4">Create Game</h2>
					<div class="space-y-4">
						<div>
							<label class="block text-sm font-medium text-slate-300 mb-2">Your Name</label>
							<input
								type="text"
								bind:value={displayName}
								placeholder="Enter your name"
								class="w-full px-4 py-2 bg-black/30 border border-white/20 rounded-lg text-white"
							/>
						</div>
						<button
							onclick={createRoom}
							disabled={!displayName.trim() || !token}
							class="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 text-white font-semibold py-3 px-6 rounded-lg"
						>
							Create Game Room
						</button>
					</div>
				</div>

				<div class="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
					<h2 class="text-2xl font-semibold text-white mb-4">Join Game</h2>
					<div class="space-y-4">
						<div>
							<label class="block text-sm font-medium text-slate-300 mb-2">Room Code</label>
							<input
								type="text"
								bind:value={roomCode}
								placeholder="ABC123"
								class="w-full px-4 py-2 bg-black/30 border border-white/20 rounded-lg text-white"
							/>
						</div>
						<div>
							<label class="block text-sm font-medium text-slate-300 mb-2">Your Name</label>
							<input
								type="text"
								bind:value={displayName}
								placeholder="Enter your name"
								class="w-full px-4 py-2 bg-black/30 border border-white/20 rounded-lg text-white"
							/>
						</div>
						<button
							onclick={joinRoom}
							disabled={!roomCode.trim() || !displayName.trim() || !token}
							class="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold py-3 px-6 rounded-lg"
						>
							Join Game Room
						</button>
					</div>
				</div>
			</div>

			{#if !token}
				<p class="text-center text-slate-400 mt-4">Please <a href="/" class="text-purple-400 hover:underline">login</a> first</p>
			{/if}
		{:else if shouldShowGame && gameState}
			<!-- Game Interface -->
			<div class="grid lg:grid-cols-3 gap-6">
				<!-- Players -->
				<div class="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
					<h2 class="text-2xl font-semibold text-white mb-4">
						Players ({Object.keys(players).length}/4)
					</h2>
					<div class="space-y-2 mb-4">
						{#each Object.values(players) as player}
							<div class="p-3 bg-black/30 rounded-lg">
								<div class="flex items-center justify-between">
									<div>
										<span class="text-white font-medium">{player.name}</span>
										{#if player.isHost}
											<span class="ml-2 text-xs bg-purple-600 px-2 py-1 rounded">HOST</span>
										{/if}
									</div>
									{#if player.isReady}
										<span class="text-green-400">✓ Ready</span>
									{:else}
										<span class="text-slate-400">Not Ready</span>
									{/if}
								</div>
							</div>
						{/each}
					</div>

					{#if status === 'waiting'}
						<div class="space-y-2">
							{#if players[userId] && !players[userId].isReady}
								<button onclick={toggleReady} class="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg">
									Ready Up
								</button>
							{/if}
							{#if isHost && Object.keys(players).length >= 2 && gameEngine.allPlayersReady}
								<button onclick={startGame} class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg">
									Start Game
								</button>
							{/if}
						</div>
					{/if}

					<div class="mt-4 p-3 bg-black/30 rounded-lg">
						<p class="text-slate-400 text-sm">Room Code:</p>
						<p class="text-white text-xl font-bold">{roomCode}</p>
					</div>
				</div>

				<!-- Game Area -->
				<div class="lg:col-span-2 bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
					<h2 class="text-2xl font-semibold text-white mb-4">
						{status.charAt(0).toUpperCase() + status.slice(1)}
					</h2>

					{#if status === 'waiting'}
						<div class="aspect-video bg-black/40 rounded-lg flex items-center justify-center">
							<p class="text-slate-400 text-xl">Waiting to start...</p>
						</div>
					{:else if status === 'active'}
						<div
							class="aspect-video bg-black/40 rounded-lg relative cursor-crosshair"
							role="button"
							tabindex="0"
							onclick={handleGameAreaClick}
							onkeydown={(e) => e.key === 'Enter' && handleGameAreaClick}
						>
							{#each Object.values(players) as player}
								{#if player.data.x !== undefined && player.data.y !== undefined}
									<div
										class="absolute w-8 h-8 rounded-full flex items-center justify-center text-white font-bold transition-all duration-200"
										style="left: {player.data.x - 16}px; top: {player.data.y - 16}px; background-color: {player.id === userId ? '#9333ea' : '#3b82f6'};"
										title={player.name}
									>
										{player.name.charAt(0).toUpperCase()}
									</div>
								{/if}
							{/each}

							<div class="absolute bottom-4 left-4 right-4 text-center">
								<p class="text-slate-300 text-sm bg-black/60 px-4 py-2 rounded-lg inline-block">
									Click to move • Round {gameState.data.round || 0}
								</p>
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
