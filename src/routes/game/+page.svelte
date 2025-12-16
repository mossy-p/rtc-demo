<script lang="ts">
	import { onMount } from 'svelte';
	import { gameEngine, type GameState, type Player } from '$lib/game-engine.svelte';

	let loading = $state(true);
	let error = $state('');
	let playerID = $state('');
	let playerName = $state('');
	let initialized = $state(false);

	// Reactive accessors
	let wasmLoaded = $derived(gameEngine.isInitialized);
	let gameState = $derived(gameEngine.currentState);
	let players = $derived(gameState?.players || {});
	let status = $derived(gameState?.status || 'waiting');
	let playerCount = $derived(gameEngine.playerCount);
	let allReady = $derived(gameEngine.allPlayersReady);

	onMount(async () => {
		// Load WASM on mount
		try {
			await gameEngine.load();
			// Generate random player ID
			playerID = 'player_' + Math.random().toString(36).substring(7);
		} catch (err: any) {
			error = err.message;
		} finally {
			loading = false;
		}
	});

	async function createGame() {
		error = '';
		if (!playerName.trim()) {
			error = 'Please enter your name';
			return;
		}

		try {
			const result = await gameEngine.initialize({
				gameType: 'simple',
				maxPlayers: 4,
				hostID: playerID,
				hostName: playerName
			});

			if (result.success) {
				initialized = true;
			} else {
				error = result.error || 'Failed to create game';
			}
		} catch (err: any) {
			error = err.message;
		}
	}

	async function toggleReady() {
		error = '';
		try {
			const result = await gameEngine.handleAction(playerID, 'ready', {});
			if (!result.success) {
				error = result.error || 'Failed to toggle ready';
			}
		} catch (err: any) {
			error = err.message;
		}
	}

	async function startGame() {
		error = '';
		try {
			const result = await gameEngine.handleAction(playerID, 'start', {});
			if (!result.success) {
				error = result.error || 'Failed to start game';
			}
		} catch (err: any) {
			error = err.message;
		}
	}

	async function movePlayer(x: number, y: number) {
		error = '';
		try {
			const result = await gameEngine.handleAction(playerID, 'move', { x, y });
			if (!result.success) {
				error = result.error || 'Failed to move';
			}
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
			<h1 class="text-5xl font-bold text-white mb-4">Game Engine Demo</h1>
			<p class="text-slate-300 text-lg">Client-side game orchestration with Go WASM</p>
		</header>

		{#if loading}
			<div class="text-center text-white">
				<p class="text-xl">Loading WASM...</p>
			</div>
		{:else if error}
			<div class="bg-red-500/20 border border-red-500 text-red-200 px-6 py-4 rounded-lg mb-6 max-w-2xl mx-auto">
				{error}
			</div>
		{/if}

		{#if wasmLoaded && !initialized}
			<!-- Create Game Form -->
			<div class="max-w-md mx-auto bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
				<h2 class="text-2xl font-semibold text-white mb-4">Create Game</h2>
				<div class="space-y-4">
					<div>
						<label class="block text-sm font-medium text-slate-300 mb-2">Your Name</label>
						<input
							type="text"
							bind:value={playerName}
							placeholder="Enter your name"
							class="w-full px-4 py-2 bg-black/30 border border-white/20 rounded-lg text-white"
						/>
					</div>
					<button
						onclick={createGame}
						disabled={!playerName.trim()}
						class="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 text-white font-semibold py-3 px-6 rounded-lg"
					>
						Create Game
					</button>
					<p class="text-xs text-slate-400 text-center">You'll be the host and can start the game</p>
				</div>
			</div>
		{:else if initialized && gameState}
			<!-- Game Interface -->
			<div class="grid lg:grid-cols-3 gap-6">
				<!-- Players Panel -->
				<div class="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
					<h2 class="text-2xl font-semibold text-white mb-4">
						Players ({playerCount}/{gameState.data.maxPlayers || 4})
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

					<!-- Actions -->
					{#if status === 'waiting'}
						<div class="space-y-2">
							{#if players[playerID] && !players[playerID].isReady}
								<button
									onclick={toggleReady}
									class="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg"
								>
									Ready Up
								</button>
							{/if}

							{#if players[playerID]?.isHost && playerCount >= 2 && allReady}
								<button
									onclick={startGame}
									class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg"
								>
									Start Game
								</button>
							{:else if players[playerID]?.isHost}
								<p class="text-xs text-slate-400 text-center">
									Need at least 2 players, and all must be ready
								</p>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Game Area -->
				<div class="lg:col-span-2 bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
					<h2 class="text-2xl font-semibold text-white mb-4">
						Game - {status.charAt(0).toUpperCase() + status.slice(1)}
					</h2>

					{#if status === 'waiting'}
						<div class="aspect-video bg-black/40 rounded-lg flex items-center justify-center">
							<p class="text-slate-400 text-xl">Waiting for players...</p>
						</div>
					{:else if status === 'active'}
						<!-- Game Canvas -->
						<div
							class="aspect-video bg-black/40 rounded-lg relative cursor-crosshair"
							role="button"
							tabindex="0"
							onclick={handleGameAreaClick}
							onkeydown={(e) => e.key === 'Enter' && handleGameAreaClick}
						>
							<!-- Render player positions -->
							{#each Object.values(players) as player}
								{#if player.data.x !== undefined && player.data.y !== undefined}
									<div
										class="absolute w-8 h-8 rounded-full flex items-center justify-center text-white font-bold"
										style="left: {player.data.x - 16}px; top: {player.data.y - 16}px; background-color: {player.isHost ? '#9333ea' : '#3b82f6'};"
										title={player.name}
									>
										{player.name.charAt(0).toUpperCase()}
									</div>
								{/if}
							{/each}

							<!-- Instructions -->
							<div class="absolute bottom-4 left-4 right-4 text-center">
								<p class="text-slate-300 text-sm bg-black/60 px-4 py-2 rounded-lg inline-block">
									Click anywhere to move
								</p>
							</div>
						</div>

						<!-- Game Stats -->
						<div class="mt-4 grid grid-cols-2 gap-4">
							<div class="bg-black/30 rounded-lg p-4">
								<p class="text-slate-400 text-sm">Round</p>
								<p class="text-white text-2xl font-bold">{gameState.data.round || 0}</p>
							</div>
							<div class="bg-black/30 rounded-lg p-4">
								<p class="text-slate-400 text-sm">Version</p>
								<p class="text-white text-2xl font-bold">{gameState.version}</p>
							</div>
						</div>
					{/if}
				</div>
			</div>

			<!-- State Debug -->
			<details class="mt-8 bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
				<summary class="text-white font-semibold cursor-pointer">Debug: Game State</summary>
				<pre class="mt-4 text-xs text-slate-300 overflow-x-auto">{JSON.stringify(gameState, null, 2)}</pre>
			</details>
		{/if}
	</div>
</div>
