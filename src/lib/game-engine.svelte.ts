/**
 * Game Engine WASM Wrapper
 * Provides reactive state management for the Go WASM game engine
 */

import { browser } from '$app/environment';

export type GameState = {
	version: number;
	createdAt: string;
	updatedAt: string;
	status: 'waiting' | 'active' | 'paused' | 'ended';
	players: Record<string, Player>;
	data: Record<string, any>;
};

export type Player = {
	id: string;
	name: string;
	joinedAt: string;
	isHost: boolean;
	isReady: boolean;
	data: Record<string, any>;
};

export type ActionResult = {
	success: boolean;
	error?: string;
	result?: any;
	state?: GameState;
};

class GameEngineWASM {
	private go: any = null;
	private wasmInstance: any = null;
	private initialized = $state(false);
	private loading = $state(false);
	public state = $state<GameState | null>(null);
	public error = $state<string | null>(null);

	/**
	 * Load and initialize the WASM module
	 */
	async load(): Promise<void> {
		if (!browser) {
			throw new Error('WASM can only be loaded in the browser');
		}

		if (this.loading || this.initialized) {
			return;
		}

		this.loading = true;
		this.error = null;

		try {
			// Load wasm_exec.js
			await this.loadWasmExec();

			// Create Go instance
			this.go = new (window as any).Go();

			// Fetch and instantiate WASM
			const response = await fetch('/game-engine.wasm');
			const buffer = await response.arrayBuffer();
			const result = await WebAssembly.instantiate(buffer, this.go.importObject);

			this.wasmInstance = result.instance;

			// Run the WASM module
			this.go.run(this.wasmInstance);

			this.initialized = true;
			console.log('Game Engine WASM loaded successfully');
		} catch (err: any) {
			this.error = `Failed to load WASM: ${err.message}`;
			console.error('WASM load error:', err);
			throw err;
		} finally {
			this.loading = false;
		}
	}

	/**
	 * Load the wasm_exec.js helper script
	 */
	private async loadWasmExec(): Promise<void> {
		return new Promise((resolve, reject) => {
			if ((window as any).Go) {
				resolve();
				return;
			}

			const script = document.createElement('script');
			script.src = '/wasm_exec.js';
			script.onload = () => resolve();
			script.onerror = () => reject(new Error('Failed to load wasm_exec.js'));
			document.head.appendChild(script);
		});
	}

	/**
	 * Initialize a new game
	 */
	async initialize(config: {
		gameType: string;
		maxPlayers?: number;
		hostID?: string;
		hostName?: string;
		[key: string]: any;
	}): Promise<ActionResult> {
		if (!this.initialized) {
			throw new Error('WASM not loaded. Call load() first.');
		}

		try {
			const result = (window as any).gameEngineInitialize(JSON.stringify(config));

			if (result.success && result.state) {
				this.state = JSON.parse(result.state);
			} else if (result.error) {
				this.error = result.error;
			}

			return result;
		} catch (err: any) {
			this.error = `Initialize failed: ${err.message}`;
			return { success: false, error: this.error };
		}
	}

	/**
	 * Handle a player action
	 */
	async handleAction(
		playerID: string,
		action: string,
		payload: Record<string, any>
	): Promise<ActionResult> {
		if (!this.initialized) {
			throw new Error('WASM not loaded');
		}

		try {
			const result = (window as any).gameEngineHandleAction(
				playerID,
				action,
				JSON.stringify(payload)
			);

			if (result.success && result.state) {
				this.state = JSON.parse(result.state);
			} else if (result.error) {
				this.error = result.error;
			}

			return result;
		} catch (err: any) {
			this.error = `Action failed: ${err.message}`;
			return { success: false, error: this.error };
		}
	}

	/**
	 * Get the current game state
	 */
	getState(): GameState | null {
		if (!this.initialized) {
			return null;
		}

		try {
			const stateJSON = (window as any).gameEngineGetState();
			return JSON.parse(stateJSON);
		} catch (err) {
			return null;
		}
	}

	/**
	 * Reset the game
	 */
	async reset(): Promise<ActionResult> {
		if (!this.initialized) {
			throw new Error('WASM not loaded');
		}

		try {
			const result = (window as any).gameEngineReset();

			if (result.success && result.state) {
				this.state = JSON.parse(result.state);
			}

			return result;
		} catch (err: any) {
			this.error = `Reset failed: ${err.message}`;
			return { success: false, error: this.error };
		}
	}

	/**
	 * Get reactive state accessors
	 */
	get isInitialized() {
		return this.initialized;
	}

	get isLoading() {
		return this.loading;
	}

	get currentError() {
		return this.error;
	}

	get currentState() {
		return this.state;
	}

	/**
	 * Get player count
	 */
	get playerCount(): number {
		return this.state ? Object.keys(this.state.players).length : 0;
	}

	/**
	 * Check if all players are ready
	 */
	get allPlayersReady(): boolean {
		if (!this.state || this.playerCount === 0) {
			return false;
		}

		return Object.values(this.state.players).every((p) => p.isReady);
	}

	/**
	 * Get a specific player
	 */
	getPlayer(playerID: string): Player | null {
		return this.state?.players[playerID] || null;
	}
}

// Export singleton instance
export const gameEngine = new GameEngineWASM();
