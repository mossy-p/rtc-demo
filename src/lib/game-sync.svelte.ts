/**
 * Game Sync Manager
 * Handles WebRTC data channel communication for game state synchronization
 */

import { gameEngine, type GameState, type ActionResult } from './game-engine.svelte';

export type GameMessage =
	| { type: 'state'; state: GameState }
	| { type: 'state-diff'; diff: Partial<GameState> }
	| { type: 'action'; playerID: string; action: string; payload: any }
	| { type: 'action-result'; success: boolean; error?: string; result?: any };

export class GameSyncManager {
	private isHost = $state(false);
	private dataChannels = $state<Map<string, RTCDataChannel>>(new Map());
	private peerConnections = $state<Map<string, RTCPeerConnection>>(new Map());
	public connectedPlayers = $state<Set<string>>(new Set());

	/**
	 * Set whether this client is the host (runs game engine)
	 */
	setHost(host: boolean) {
		this.isHost = host;
	}

	/**
	 * Add a peer connection and create data channel
	 */
	addPeerConnection(peerID: string, pc: RTCPeerConnection) {
		this.peerConnections.set(peerID, pc);

		if (this.isHost) {
			// Host creates data channel
			const channel = pc.createDataChannel('game-sync', {
				ordered: true,
				maxRetransmits: 3
			});

			this.setupDataChannel(peerID, channel);
			console.log(`[Host] Created data channel for peer ${peerID}`);
		} else {
			// Client waits for data channel from host
			pc.ondatachannel = (event) => {
				const channel = event.channel;
				this.setupDataChannel(peerID, channel);
				console.log(`[Client] Received data channel from peer ${peerID}`);
			};
		}
	}

	/**
	 * Setup data channel event handlers
	 */
	private setupDataChannel(peerID: string, channel: RTCDataChannel) {
		this.dataChannels.set(peerID, channel);

		channel.onopen = () => {
			console.log(`Data channel opened with ${peerID}`);
			this.connectedPlayers.add(peerID);

			// If host, send initial game state
			if (this.isHost) {
				const state = gameEngine.getState();
				if (state) {
					this.sendToPlayer(peerID, {
						type: 'state',
						state
					});
				}
			}
		};

		channel.onclose = () => {
			console.log(`Data channel closed with ${peerID}`);
			this.connectedPlayers.delete(peerID);
			this.dataChannels.delete(peerID);
		};

		channel.onerror = (error) => {
			console.error(`Data channel error with ${peerID}:`, error);
		};

		channel.onmessage = (event) => {
			try {
				const message: GameMessage = JSON.parse(event.data);
				this.handleMessage(peerID, message);
			} catch (err) {
				console.error('Failed to parse game message:', err);
			}
		};
	}

	/**
	 * Handle incoming game messages
	 */
	private async handleMessage(fromPeerID: string, message: GameMessage) {
		switch (message.type) {
			case 'state':
				// Client receives full state from host
				if (!this.isHost) {
					gameEngine.state = message.state;
					console.log('[Client] Received full game state');
				}
				break;

			case 'state-diff':
				// Client receives state update from host
				if (!this.isHost && gameEngine.state) {
					// Apply diff to current state
					Object.assign(gameEngine.state, message.diff);
					console.log('[Client] Applied state diff');
				}
				break;

			case 'action':
				// Host receives action from player
				if (this.isHost) {
					console.log(`[Host] Received action from ${fromPeerID}:`, message.action);

					const result = await gameEngine.handleAction(
						message.playerID,
						message.action,
						message.payload
					);

					// Send result back to player
					this.sendToPlayer(fromPeerID, {
						type: 'action-result',
						success: result.success,
						error: result.error,
						result: result.result
					});

					// If successful, broadcast state to all players
					if (result.success) {
						const state = gameEngine.getState();
						if (state) {
							this.broadcastState(state);
						}
					}
				}
				break;

			case 'action-result':
				// Player receives action result from host
				if (!this.isHost) {
					console.log('[Client] Action result:', message);
					// Could trigger UI feedback here
				}
				break;
		}
	}

	/**
	 * Send action to host (called by players)
	 */
	async sendAction(playerID: string, action: string, payload: any): Promise<void> {
		if (this.isHost) {
			// If we're the host, process locally
			await gameEngine.handleAction(playerID, action, payload);
			const state = gameEngine.getState();
			if (state) {
				this.broadcastState(state);
			}
		} else {
			// Send to host
			const hostChannel = Array.from(this.dataChannels.values())[0]; // Assume single host connection
			if (hostChannel && hostChannel.readyState === 'open') {
				hostChannel.send(
					JSON.stringify({
						type: 'action',
						playerID,
						action,
						payload
					} as GameMessage)
				);
			} else {
				console.error('No open data channel to host');
			}
		}
	}

	/**
	 * Broadcast state to all connected players (called by host)
	 */
	private broadcastState(state: GameState) {
		if (!this.isHost) return;

		const message: GameMessage = {
			type: 'state',
			state
		};

		const data = JSON.stringify(message);

		for (const [peerID, channel] of this.dataChannels) {
			if (channel.readyState === 'open') {
				channel.send(data);
			}
		}

		console.log(`[Host] Broadcasted state to ${this.dataChannels.size} players`);
	}

	/**
	 * Send message to specific player (called by host)
	 */
	private sendToPlayer(peerID: string, message: GameMessage) {
		const channel = this.dataChannels.get(peerID);
		if (channel && channel.readyState === 'open') {
			channel.send(JSON.stringify(message));
		}
	}

	/**
	 * Close all connections
	 */
	cleanup() {
		for (const channel of this.dataChannels.values()) {
			channel.close();
		}
		this.dataChannels.clear();
		this.peerConnections.clear();
		this.connectedPlayers.clear();
	}

	/**
	 * Get reactive accessors
	 */
	get playerCount(): number {
		return this.connectedPlayers.size + (this.isHost ? 1 : 0); // Include host
	}

	get isConnected(): boolean {
		return this.dataChannels.size > 0 || this.isHost;
	}
}

// Export singleton instance
export const gameSync = new GameSyncManager();
