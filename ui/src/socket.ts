import type { Room } from "../../src/server/room.js";

/** Read-only connection to the office server, reconnecting if it drops. */
export function connect(onRoom: (room: Room) => void, onStatus: (connected: boolean) => void): void {
  const open = () => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => onStatus(true);
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data));
        if (m?.type === "room") onRoom(m.room as Room);
      } catch {
        // ignore a malformed message
      }
    };
    ws.onclose = () => {
      onStatus(false);
      setTimeout(open, 1500);
    };
  };
  open();
}
