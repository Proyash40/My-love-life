"""
HITL Drone Simulator — Middleware Bridge
-----------------------------------------
Reads "throttle,yaw,pitch,roll\n" lines from the Arduino over Serial
and rebroadcasts them as JSON to every connected WebSocket client.

Run:
    pip install fastapi uvicorn pyserial
    python main.py

Then open the React dashboard and point it at ws://localhost:8000/ws
"""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Optional

import serial
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# ---- Configuration ----------------------------------------------------
SERIAL_PORT = "COM3"        # Windows e.g. "COM3" | macOS/Linux e.g. "/dev/ttyUSB0" or "/dev/tty.usbmodemXXXX"
BAUD_RATE = 115200
RECONNECT_DELAY_SEC = 2.0   # wait before retrying a dropped/failed serial connection
READ_TIMEOUT_SEC = 1.0

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("hitl-bridge")


# ---- Connection manager -------------------------------------------------
class ConnectionManager:
    """Tracks connected WebSocket clients and fans out telemetry to all of them."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info("Client connected (%d total)", len(self.active_connections))

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info("Client disconnected (%d total)", len(self.active_connections))

    async def broadcast(self, message: dict):
        if not self.active_connections:
            return
        payload = json.dumps(message)
        stale: list[WebSocket] = []
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                stale.append(connection)
        for conn in stale:
            self.disconnect(conn)


manager = ConnectionManager()


# ---- Serial reader (background task) ------------------------------------
class SerialReader:
    """
    Owns the serial connection. Runs forever in a background asyncio task:
    opens the port, reads lines, parses them, and hands parsed telemetry
    to the broadcast callback. If the port disconnects or a read/parse
    error occurs, it closes the port and retries after a short delay
    instead of crashing the server.
    """

    def __init__(self, port: str, baud_rate: int, on_data):
        self.port = port
        self.baud_rate = baud_rate
        self.on_data = on_data
        self._ser: Optional[serial.Serial] = None
        self._running = False

    async def run_forever(self):
        self._running = True
        while self._running:
            try:
                self._connect()
                await self._read_loop()
            except (serial.SerialException, OSError) as exc:
                logger.warning("Serial error (%s). Retrying in %.1fs...", exc, RECONNECT_DELAY_SEC)
            except Exception as exc:  # defensive catch-all so the task never dies silently
                logger.exception("Unexpected error in serial loop: %s", exc)
            finally:
                self._close()
            if self._running:
                await asyncio.sleep(RECONNECT_DELAY_SEC)

    def _connect(self):
        logger.info("Opening serial port %s @ %d baud...", self.port, self.baud_rate)
        self._ser = serial.Serial(self.port, self.baud_rate, timeout=READ_TIMEOUT_SEC)
        logger.info("Serial port opened.")

    def _close(self):
        if self._ser and self._ser.is_open:
            try:
                self._ser.close()
            except Exception:
                pass
        self._ser = None

    async def _read_loop(self):
        loop = asyncio.get_event_loop()
        while self._running:
            # readline() is blocking; run it in a thread so it doesn't stall the event loop
            raw_line = await loop.run_in_executor(None, self._ser.readline)
            if not raw_line:
                continue  # read timeout, no data yet — keep looping

            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line:
                continue

            parsed = self._parse(line)
            if parsed is not None:
                await self.on_data(parsed)

    @staticmethod
    def _parse(line: str) -> Optional[dict]:
        parts = line.split(",")
        if len(parts) != 4:
            logger.debug("Skipping malformed line: %r", line)
            return None
        try:
            throttle, yaw, pitch, roll = (int(p) for p in parts)
        except ValueError:
            logger.debug("Skipping unparsable line: %r", line)
            return None
        return {"throttle": throttle, "yaw": yaw, "pitch": pitch, "roll": roll}

    def stop(self):
        self._running = False


reader = SerialReader(SERIAL_PORT, BAUD_RATE, on_data=manager.broadcast)


# ---- FastAPI app ----------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(reader.run_forever())
    logger.info("Serial reader task started.")
    yield
    reader.stop()
    task.cancel()
    logger.info("Serial reader task stopped.")


app = FastAPI(title="HITL Drone Bridge", lifespan=lifespan)

# Allow the React dev server to connect from a different origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def health():
    return {"status": "ok", "serial_port": SERIAL_PORT, "clients": len(manager.active_connections)}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # We don't expect incoming messages, but keep the connection alive
            # and responsive to a client-initiated disconnect.
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
