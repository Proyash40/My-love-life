/*
 * HITL Drone Simulator — Dashboard
 * ---------------------------------
 * Renders two RC-style joysticks (Left: throttle/yaw, Right: pitch/roll)
 * driven by live telemetry from the Zustand store.
 *
 * Performance approach:
 * The knobs are moved by writing `transform: translate(x, y)` directly
 * to the DOM node on every WebSocket message via `useDroneStore.subscribe`,
 * completely bypassing React's render cycle for the 50Hz data. React only
 * re-renders for low-frequency UI (connection status, numeric readout,
 * which is throttled separately). This keeps the UI smooth even at 50Hz
 * and avoids reconciling the whole tree dozens of times a second.
 */

import { useEffect, useRef, useState } from "react";
import { useDroneStore } from "./store";
import "./App.css";

const BOX_RADIUS = 70; // max travel distance for a knob from box center, in px

// Clamp + convert a -100..100 (or 0..100) value into a pixel offset
function toOffset(value, min, max, radius) {
  const normalized = (value - min) / (max - min); // 0..1
  return (normalized * 2 - 1) * radius; // -radius..radius
}

function Joystick({ label, xLabel, yLabel, knobRef }) {
  return (
    <div className="stick-panel">
      <div className="stick-box">
        <div className="stick-box__crosshair stick-box__crosshair--h" />
        <div className="stick-box__crosshair stick-box__crosshair--v" />
        <div className="stick-box__corner stick-box__corner--tl" />
        <div className="stick-box__corner stick-box__corner--tr" />
        <div className="stick-box__corner stick-box__corner--bl" />
        <div className="stick-box__corner stick-box__corner--br" />
        <div className="stick-knob" ref={knobRef} />
      </div>
      <div className="stick-panel__label">{label}</div>
      <div className="stick-panel__axes">
        <span>{xLabel}</span>
        <span>{yLabel}</span>
      </div>
    </div>
  );
}

function StatusPill() {
  const status = useDroneStore((s) => s.connectionStatus);
  const label = {
    connected: "LINK OK",
    connecting: "CONNECTING",
    disconnected: "NO LINK",
    error: "LINK ERROR",
  }[status];
  return <div className={`status-pill status-pill--${status}`}>{label}</div>;
}

function Readout() {
  // Low-frequency-enough for a normal React subscription (numbers update
  // at 50Hz too, but this panel is cheap to re-render — 4 text nodes).
  const { throttle, yaw, pitch, roll } = useDroneStore((s) => ({
    throttle: s.throttle,
    yaw: s.yaw,
    pitch: s.pitch,
    roll: s.roll,
  }));
  return (
    <div className="readout">
      <div className="readout__item">
        <span className="readout__key">THR</span>
        <span className="readout__val">{throttle}</span>
      </div>
      <div className="readout__item">
        <span className="readout__key">YAW</span>
        <span className="readout__val">{yaw}</span>
      </div>
      <div className="readout__item">
        <span className="readout__key">PIT</span>
        <span className="readout__val">{pitch}</span>
      </div>
      <div className="readout__item">
        <span className="readout__key">ROL</span>
        <span className="readout__val">{roll}</span>
      </div>
    </div>
  );
}

export default function App() {
  const leftKnobRef = useRef(null);
  const rightKnobRef = useRef(null);
  const connect = useDroneStore((s) => s.connect);

  useEffect(() => {
    connect();
  }, [connect]);

  // Subscribe directly to the store (outside React) and imperatively
  // move the knobs. This is the piece that keeps 50Hz updates cheap.
  useEffect(() => {
    const applyTransform = (state) => {
      if (leftKnobRef.current) {
        const x = toOffset(state.yaw, -100, 100, BOX_RADIUS);
        const y = toOffset(state.throttle, 0, 100, BOX_RADIUS) * -1; // up = more throttle
        leftKnobRef.current.style.transform = `translate(${x}px, ${y}px)`;
      }
      if (rightKnobRef.current) {
        const x = toOffset(state.roll, -100, 100, BOX_RADIUS);
        const y = toOffset(state.pitch, -100, 100, BOX_RADIUS) * -1; // up = nose up
        rightKnobRef.current.style.transform = `translate(${x}px, ${y}px)`;
      }
    };

    // Paint current state immediately, then on every future update
    applyTransform(useDroneStore.getState());
    const unsubscribe = useDroneStore.subscribe(applyTransform);
    return unsubscribe;
  }, []);

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <div className="dashboard__title">
          <span className="dashboard__title-main">FLIGHT LINK</span>
          <span className="dashboard__title-sub">hardware-in-the-loop telemetry</span>
        </div>
        <StatusPill />
      </header>

      <main className="dashboard__body">
        <Joystick label="LEFT STICK" xLabel="YAW" yLabel="THROTTLE" knobRef={leftKnobRef} />
        <Readout />
        <Joystick label="RIGHT STICK" xLabel="ROLL" yLabel="PITCH" knobRef={rightKnobRef} />
      </main>
    </div>
  );
}
