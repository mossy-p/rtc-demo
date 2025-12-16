<script lang="ts">
	import { onMount } from 'svelte';

	let username = $state('');
	let password = $state('');
	let token = $state('');
	let userId = $state('');
	let roomId = $state('');
	let roomCode = $state('');
	let displayName = $state('');
	let ws: WebSocket | null = $state(null);
	let connected = $state(false);
	let error = $state('');
	let messages: Array<{ type: string; data: any; timestamp: string }> = $state([]);

	const RTC_URL = 'https://rtc.mossp.me';
	const WS_URL = 'wss://rtc.mossp.me';

	// Load token from localStorage on mount
	onMount(() => {
		const savedToken = localStorage.getItem('rtc_token');
		const savedUserId = localStorage.getItem('rtc_user_id');
		if (savedToken && savedUserId) {
			token = savedToken;
			userId = savedUserId;
		}
		return () => { if (ws) ws.close(); };
	});

	async function login() {
		error = '';
		try {
			const response = await fetch(`${RTC_URL}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, password })
			});
			if (!response.ok) {
				throw new Error(`Login failed: ${response.status}`);
			}
			const data = await response.json();
			token = data.token;
			userId = data.user_id;

			// Save to localStorage
			localStorage.setItem('rtc_token', token);
			localStorage.setItem('rtc_user_id', userId);

			// Clear password for security
			password = '';
		} catch (e: any) {
			error = e.message;
		}
	}

	function logout() {
		token = '';
		userId = '';
		localStorage.removeItem('rtc_token');
		localStorage.removeItem('rtc_user_id');
		if (ws) {
			ws.close();
			ws = null;
			connected = false;
		}
	}

	async function createRoom() {
		error = '';
		if (!token) {
			error = 'Please login first';
			return;
		}
		try {
			const response = await fetch(`${RTC_URL}/api/rooms`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${token}`
				},
				body: JSON.stringify({ maxPlayers: 8 })
			});
			if (!response.ok) {
				throw new Error(`Failed: ${response.status}`);
			}
			const data = await response.json();
			roomId = data.roomId;
			roomCode = data.code;
		} catch (e: any) {
			error = e.message;
		}
	}

	function connectToRoom() {
		if (!roomCode || !displayName) {
			error = 'Please enter room code and display name';
			return;
		}
		error = '';
		try {
			ws = new WebSocket(`${WS_URL}/ws/signal/${roomCode}?displayName=${encodeURIComponent(displayName)}`);
			ws.onopen = () => { connected = true; addMessage('system', { message: 'Connected' }); };
			ws.onmessage = (e) => { try { addMessage('received', JSON.parse(e.data)); } catch {} };
			ws.onerror = () => { error = 'WebSocket error'; };
			ws.onclose = () => { connected = false; addMessage('system', { message: 'Disconnected' }); };
		} catch (e: any) {
			error = e.message;
		}
	}

	function disconnect() { if (ws) { ws.close(); ws = null; connected = false; } }

	function sendOffer() {
		if (!ws || !connected) return;
		const msg = { type: 'offer', sdp: 'demo-sdp-offer', targetPeerId: 'peer-123' };
		ws.send(JSON.stringify(msg)); addMessage('sent', msg);
	}

	function sendAnswer() {
		if (!ws || !connected) return;
		const msg = { type: 'answer', sdp: 'demo-sdp-answer', targetPeerId: 'peer-123' };
		ws.send(JSON.stringify(msg)); addMessage('sent', msg);
	}

	function sendICE() {
		if (!ws || !connected) return;
		const msg = { type: 'ice-candidate', candidate: { candidate: 'demo-ice' }, targetPeerId: 'peer-123' };
		ws.send(JSON.stringify(msg)); addMessage('sent', msg);
	}

	function addMessage(type: string, data: any) {
		messages = [...messages, { type, data, timestamp: new Date().toLocaleTimeString() }];
	}
</script>

<div class="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
	<div class="container mx-auto px-4 py-8">
		<header class="text-center mb-8">
			<h1 class="text-5xl font-bold text-white mb-4">WebRTC Signaling Demo</h1>
			<p class="text-slate-300 text-lg">Testing rtc.mossp.me signaling server</p>
		</header>

		{#if !token}
			<div class="max-w-md mx-auto mb-12 bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
				<h2 class="text-2xl font-semibold text-white mb-4">Login</h2>
				<div class="space-y-4">
					<div>
						<label class="block text-sm font-medium text-slate-300 mb-2">Username</label>
						<input type="text" bind:value={username} placeholder="Enter any username" class="w-full px-4 py-2 bg-black/30 border border-white/20 rounded-lg text-white" />
					</div>
					<div>
						<label class="block text-sm font-medium text-slate-300 mb-2">Password</label>
						<input type="password" bind:value={password} placeholder="Enter any password" class="w-full px-4 py-2 bg-black/30 border border-white/20 rounded-lg text-white" />
					</div>
					<button onclick={login} disabled={!username || !password} class="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 text-white font-semibold py-3 px-6 rounded-lg">Login</button>
					<p class="text-xs text-slate-400 text-center">Demo mode: accepts any username/password</p>
				</div>
			</div>
		{:else}
			<div class="max-w-md mx-auto mb-8 bg-white/10 backdrop-blur-lg rounded-lg p-4 border border-white/20 flex justify-between items-center">
				<div>
					<p class="text-sm text-slate-400">Logged in as</p>
					<p class="text-white font-semibold">{userId}</p>
				</div>
				<button onclick={logout} class="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg">Logout</button>
			</div>
		{/if}

		{#if error}
			<div class="bg-red-500/20 border border-red-500 text-red-200 px-6 py-4 rounded-lg mb-6">{error}</div>
		{/if}

		{#if token}
			<div class="grid md:grid-cols-2 gap-8 mb-8">
			<div class="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
				<h2 class="text-2xl font-semibold text-white mb-4">1. Create Room</h2>
				<button onclick={createRoom} class="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-lg">Create New Room</button>
				{#if roomCode}
					<div class="mt-4 p-4 bg-green-500/20 border border-green-500 rounded-lg">
						<p class="text-green-200 font-semibold mb-2">Room Created!</p>
						<p class="text-white text-sm">Code: <code class="bg-black/30 px-2 py-1 rounded text-xl font-bold">{roomCode}</code></p>
					</div>
				{/if}
			</div>

			<div class="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
				<h2 class="text-2xl font-semibold text-white mb-4">2. Join Room</h2>
				<div class="space-y-4">
					<div>
						<label class="block text-sm font-medium text-slate-300 mb-2">Room Code</label>
						<input type="text" bind:value={roomCode} placeholder="ABC123" class="w-full px-4 py-2 bg-black/30 border border-white/20 rounded-lg text-white" />
					</div>
					<div>
						<label class="block text-sm font-medium text-slate-300 mb-2">Display Name</label>
						<input type="text" bind:value={displayName} placeholder="Player 1" class="w-full px-4 py-2 bg-black/30 border border-white/20 rounded-lg text-white" />
					</div>
					{#if !connected}
						<button onclick={connectToRoom} disabled={!roomCode || !displayName} class="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold py-3 px-6 rounded-lg">Connect</button>
					{:else}
						<button onclick={disconnect} class="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-lg">Disconnect</button>
					{/if}
				</div>
				{#if connected}
					<div class="mt-4 p-4 bg-green-500/20 border border-green-500 rounded-lg"><p class="text-green-200 font-semibold">Connected!</p></div>
				{/if}
			</div>
		</div>

		{#if connected}
			<div class="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20 mb-8">
				<h2 class="text-2xl font-semibold text-white mb-4">3. Send Signaling Messages</h2>
				<div class="grid grid-cols-3 gap-4">
					<button onclick={sendOffer} class="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6 rounded-lg">Send Offer</button>
					<button onclick={sendAnswer} class="bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 px-6 rounded-lg">Send Answer</button>
					<button onclick={sendICE} class="bg-cyan-600 hover:bg-cyan-700 text-white font-semibold py-3 px-6 rounded-lg">Send ICE</button>
				</div>
			</div>
		{/if}

		<div class="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
			<h2 class="text-2xl font-semibold text-white mb-4">Message Log</h2>
			<div class="space-y-2 max-h-96 overflow-y-auto">
				{#if messages.length === 0}
					<p class="text-slate-400 text-center py-8">No messages yet</p>
				{:else}
					{#each messages as msg}
						<div class="p-3 bg-black/30 rounded-lg border border-white/10">
							<div class="flex justify-between mb-1">
								<span class="text-sm font-semibold {msg.type === 'sent' ? 'text-blue-400' : msg.type === 'received' ? 'text-green-400' : 'text-slate-400'}">{msg.type.toUpperCase()}</span>
								<span class="text-xs text-slate-500">{msg.timestamp}</span>
							</div>
							<pre class="text-xs text-slate-300 overflow-x-auto">{JSON.stringify(msg.data, null, 2)}</pre>
						</div>
					{/each}
				{/if}
			</div>
		</div>

		{/if}

		<footer class="text-center mt-12 text-slate-400 text-sm">
			<p>Powered by <a href="https://rtc.mossp.me/health" target="_blank" class="text-purple-400">rtc.mossp.me</a></p>
		</footer>
	</div>
</div>