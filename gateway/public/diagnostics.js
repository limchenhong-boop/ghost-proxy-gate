const result = document.getElementById("results");
const checks = document.getElementById("checks");
document.getElementById("run").onclick = async (event) => {
  event.target.disabled = true; result.textContent = "Running actual Wisp requests…"; checks.replaceChildren();
  try {
    const response = await fetch("/diagnostics/run", { method: "POST", credentials: "same-origin" });
    const data = await response.json();
    for (const [key, label] of [["backend","Backend"],["wisp","Wisp"],["outboundTransport","Outbound transport"],["upstreamProxy","Upstream proxy"],["destinationRequest","Destination request"],["responseReceived","Response received"]]) {
      const row = document.createElement("tr");
      for (const text of [label, data[key] || "NOT RUN"]) { const cell = document.createElement("td"); cell.textContent = text; row.append(cell); }
      checks.append(row);
    }
    result.textContent = JSON.stringify(data, null, 2);
  } catch { result.textContent = "FAIL: developer diagnostic endpoint could not be reached."; }
  finally { event.target.disabled = false; }
};
document.getElementById("public").onclick = (event) => {
  const button = event.target; button.disabled = true;
  const output = document.getElementById("public-result"); output.textContent = "Connecting to public /wisp/…";
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/wisp/`);
  socket.binaryType = "arraybuffer";
  let started = false, finished = false, text = "", bytes = 0;
  const finish = (message) => { if (finished) return; finished = true; clearTimeout(timer); output.textContent = message; socket.close(); button.disabled = false; };
  const timer = setTimeout(() => finish("FAIL: public Wisp response deadline exceeded."), 30000);
  socket.onerror = () => finish("FAIL: public WebSocket could not connect.");
  socket.onclose = () => { if (!finished) finish("FAIL: Wisp closed before a destination response."); };
  socket.onmessage = ({ data }) => {
    const packet = new Uint8Array(data); if (packet.length < 5) return;
    const id = new DataView(data).getUint32(1, true);
    if (!started && packet[0] === 3 && id === 0) {
      started = true;
      const host = new TextEncoder().encode("example.com");
      const connect = new Uint8Array(8 + host.length); connect[0] = 1;
      new DataView(connect.buffer).setUint32(1, 1, true); connect[5] = 1;
      new DataView(connect.buffer).setUint16(6, 80, true); connect.set(host, 8); socket.send(connect);
      const request = new TextEncoder().encode("GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n");
      const payload = new Uint8Array(5 + request.length); payload[0] = 2;
      new DataView(payload.buffer).setUint32(1, 1, true); payload.set(request, 5); socket.send(payload);
    } else if (packet[0] === 2 && id === 1) {
      bytes += packet.length - 5; text += new TextDecoder().decode(packet.subarray(5));
      if (text.includes("\r\n\r\n")) finish(/^HTTP\/1\.[01] [23]\d\d/.test(text) ? `PASS: public /wisp/ handshake and destination response; ${bytes} bytes; ${text.split("\r\n")[0]}. TLS is checked by the separate server test.` : "FAIL: destination returned a non-success HTTP response.");
      else if (bytes > 65536) finish("FAIL: invalid HTTP response headers.");
    } else if (packet[0] === 4) finish(`FAIL: Wisp stream closed (reason ${packet[5] ?? "unknown"}).`);
  };
};