/*
 * HITL Drone Simulator — Arduino Firmware
 * ----------------------------------------
 * Simulates an automated flight sequence and streams the resulting
 * control values over Serial as CSV: "throttle,yaw,pitch,roll\n"
 *
 * Ranges:
 *   throttle : 0   to 100
 *   yaw      : -100 to 100
 *   pitch    : -100 to 100
 *   roll     : -100 to 100
 *
 * Update rate: 50 Hz (every 20 ms), driven by millis() so it doesn't
 * drift or block other work.
 *
 * Wiring: none required — this is a pure simulation. Replace the
 * calculateFlightControls() body with real sensor/PID logic later;
 * the Serial contract stays the same.
 */

const long BAUD_RATE   = 115200;
const unsigned long LOOP_INTERVAL_MS = 20;   // 1000ms / 50Hz = 20ms

unsigned long lastSendTime = 0;
unsigned long flightClockMs = 0; // time since flight sequence started

// Current control outputs
int throttle = 0;
int yaw      = 0;
int pitch    = 0;
int roll     = 0;

// ---- Flight phases (seconds, cumulative) ----
const float T_TAKEOFF_END   = 3.0;   // 0s  -> 3s : spool up & climb
const float T_HOVER_END     = 6.0;   // 3s  -> 6s : stabilize / hover
const float T_MANEUVER_END  = 16.0;  // 6s  -> 16s: banking + yaw sweep
const float T_DESCENT_END   = 20.0;  // 16s -> 20s: descend
const float T_LOOP_RESET    = 22.0;  // 20s -> 22s: settle, then loop

void setup() {
  Serial.begin(BAUD_RATE);
  lastSendTime = millis();
}

void loop() {
  unsigned long now = millis();

  if (now - lastSendTime >= LOOP_INTERVAL_MS) {
    lastSendTime = now;
    flightClockMs += LOOP_INTERVAL_MS;

    calculateFlightControls(flightClockMs / 1000.0f);
    sendTelemetry();

    // Loop the sequence indefinitely
    if (flightClockMs / 1000.0f >= T_LOOP_RESET) {
      flightClockMs = 0;
    }
  }
}

// Computes throttle/yaw/pitch/roll for the current point in the
// simulated flight sequence. Replace this with real automation
// (PID output, mission logic, etc.) — keep the same variable names
// and ranges so the rest of the pipeline is unaffected.
void calculateFlightControls(float t) {
  if (t < T_TAKEOFF_END) {
    // Spool up throttle smoothly from 0 -> 70, everything else level
    float progress = t / T_TAKEOFF_END;
    throttle = (int)(70 * progress);
    yaw = 0; pitch = 0; roll = 0;

  } else if (t < T_HOVER_END) {
    // Stable hover with a tiny amount of natural sensor "wobble"
    throttle = 65 + (int)(3 * sin(t * 4.0));
    yaw   = (int)(2 * sin(t * 2.0));
    pitch = (int)(2 * cos(t * 2.3));
    roll  = (int)(2 * sin(t * 1.7));

  } else if (t < T_MANEUVER_END) {
    // Banking turn: roll + yaw sweep, slight forward pitch, throttle up a touch
    float m = t - T_HOVER_END; // 0 -> 10s window
    throttle = 72 + (int)(5 * sin(m * 0.8));
    yaw   = (int)(60 * sin(m * 0.6));
    pitch = (int)(-25 - 10 * sin(m * 0.5)); // nose down = forward flight
    roll  = (int)(45 * sin(m * 0.6));       // banks in sync with yaw

  } else if (t < T_DESCENT_END) {
    // Descent: throttle ramps down, level out attitude
    float progress = (t - T_MANEUVER_END) / (T_DESCENT_END - T_MANEUVER_END);
    throttle = (int)(70 - 45 * progress);
    yaw   = (int)(10 * (1.0 - progress) * sin(t * 1.0));
    pitch = (int)(10 * (1.0 - progress));
    roll  = (int)(5 * (1.0 - progress) * sin(t * 1.3));

  } else {
    // Touchdown / settle
    throttle = 5;
    yaw = 0; pitch = 0; roll = 0;
  }

  throttle = constrain(throttle, 0, 100);
  yaw   = constrain(yaw, -100, 100);
  pitch = constrain(pitch, -100, 100);
  roll  = constrain(roll, -100, 100);
}

void sendTelemetry() {
  Serial.print(throttle);
  Serial.print(',');
  Serial.print(yaw);
  Serial.print(',');
  Serial.print(pitch);
  Serial.print(',');
  Serial.print(roll);
  Serial.print('\n');
}
