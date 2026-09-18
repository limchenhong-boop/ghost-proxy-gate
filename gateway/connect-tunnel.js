import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.168.0.0",16],["192.0.0.0",24],["198.18.0.0",15],["224.0.0.0",4],["240.0.0.0",4]]) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["::",128],["::1",128],["fc00::",7],["fe80::",10],["ff00::",8],["2001:db8::",32]]) blocked.addSubnet(address, prefix, "ipv6");

export async function connectTunnel(upstream, hostname, port, report) {
  if (!/^[a-zA-Z0-9.:[\]-]+$/.test(hostname) || !Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error("Invalid destination"), { code: "INVALID_TARGET" });
  report.stage = "destination-dns";
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address, family }) => blocked.check(address, family === 6 ? "ipv6" : "ipv4"))) throw Object.assign(new Error("Private destination blocked"), { code: "DESTINATION_BLOCKED" });
  report.dns = true;
  // Pin the validated address against DNS rebinding; libcurl still supplies the
  // original TLS SNI and HTTP Host inside the untouched tunnel.
  const destination = addresses.find((a) => a.family === 4) || addresses[0];
  const authority = `${destination.family === 6 ? `[${destination.address}]` : destination.address}:${port}`;
  report.stage = "upstream-connect";
  const proxy = upstream.url;
  const headers = { Host: authority };
  if (proxy.username || proxy.password) headers["Proxy-Authorization"] = "Basic " + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64");
  return new Promise((resolve, reject) => {
    const request = (proxy.protocol === "https:" ? https : http).request({
      hostname: proxy.hostname.replace(/^\[|\]$/g, ""), port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
      method: "CONNECT", path: authority, headers, agent: false,
    });
    const timer = setTimeout(() => request.destroy(Object.assign(new Error("CONNECT deadline"), { code: "CONNECT_TIMEOUT" })), 20000);
    request.once("error", (error) => { clearTimeout(timer); reject(error); });
    request.once("connect", (response, socket, head) => {
      clearTimeout(timer);
      report.connectStatus = response.statusCode;
      if (response.statusCode !== 200) { socket.destroy(); reject(Object.assign(new Error("Upstream refused CONNECT"), { code: `CONNECT_HTTP_${response.statusCode}` })); return; }
      socket.pause();
      socket.setTimeout(0); // No inactivity timeout on streaming / long-lived traffic.
      socket.setNoDelay(true);
      if (head.length) socket.unshift(head);
      report.connected = true;
      report.stage = "tunnel";
      resolve(socket);
    });
    request.end();
  });
}