/*
 * HITL Drone Simulator — Zustand Store
 * -------------------------------------
 * Holds the latest telemetry (throttle/yaw/pitch/roll) and the
 * WebSocket connection status.
 *
 * IMPORTANT — performance note:
 * At 50Hz, calling `set()` on every message and reading it back with
 * `useStore(state => state.throttle)` would trigger a React re-render
 * up to 50 times/sec for every subscribed component. That's fine for
 * a couple of numbers, but joystick *position* updates are pure
 * transform math, so App.jsx skips React re-renders for the knobs
 * entirely: it calls `useDroneStore.subscribe(...)` directly and
 * writes the CSS transform straight to the DOM node via a ref.
 * The store itself stays a completely normal Zustand store — no
 * special API needed — this is just how it's consumed.
 */

import { create } from "zustand";

const WS_URL = "ws://localhost:8000/ws";
const RECONNECT_DELAY_MS = 1500;

export const useDroneStore = create((set, get) => ({
  // Live telemetry (raw ranges: throttle 0-100, others -100..100)
  throttle: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,

  // Connection lifecycle
  connectionStatus: "disconnected", // "disconnected" | "connecting" | "connected" | "error"
  lastMessageAt: null,

  _socket: null,

  connect: () => {
    if (get()._socket) return; // already connecting/connected

    set({ connectionStatus: "connecting" });
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      set({ connectionStatus: "connected", _socket: socket });
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        set({
          throttle: data.throttle,
          yaw: data.yaw,
          pitch: data.pitch,
          roll: data.roll,
          lastMessageAt: Date.now(),
        });
      } catch (err) {
        console.warn("Failed to parse telemetry message:", event.data);
      }
    };

    socket.onerror = () => {
      set({ connectionStatus: "error" });
    };

    socket.onclose = () => {
      set({ connectionStatus: "disconnected", _socket: null });
      // Auto-reconnect
      setTimeout(() => {
        get().connect();
      }, RECONNECT_DELAY_MS);
    };
  },

  disconnect: () => {
    const socket = get()._socket;
    if (socket) socket.close();
    set({ _socket: null, connectionStatus: "disconnected" });
  },
}));
