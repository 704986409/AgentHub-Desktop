# AgentHub Desktop Read-Only Contract (V0.8.1)

This document specifies the strict architectural and network contract between **AgentHub Desktop** (`AgentHub-Desktop`) and the local **AgentHub Core** daemon (`AgentHub`).

---

## 1. Architectural Scope & Boundary

AgentHub Desktop is a rich visual supervisor and cockpit for multi-agent workflows. In `V0.8.1`, AgentHub Desktop introduces a dedicated **read-only bridge** to observe the local AgentHub Core service without altering or mutating any state in AgentHub Core.

```
+--------------------------------------------------------------------+
|                         AgentHub Desktop                           |
|                                                                    |
|  [Title Bar Badge] <---> [agentHubStore] <---> [window.agentHub]   |
|                                                      |             |
|                                                 (IPC Bridge)       |
|                                                      v             |
|                                            [AgentHubConnection]    |
|                                            /                  \    |
|                        (HTTP GETs Only)  /                      \  | (WS Listen Only)
+-----------------------------------------/------------------------\-+
                                         /                          \
                                        v                            v
                              GET /api/v1/health            ws://127.0.0.1:3210/api/v1/realtime
                              GET /api/v1/state
                              GET /api/v1/events
                                        \                            /
                                         \                          /
+-----------------------------------------\------------------------/--+
|                                          v                      v   |
|                                   AgentHub Core Backend             |
|                                   (Strictly Sealed 0.7.0G)          |
+--------------------------------------------------------------------+
```

---

## 2. Invariant 1: Strictly Read-Only (Zero Mutation)

1. **HTTP GET Only**: All communication from AgentHub Desktop to AgentHub Core HTTP endpoints is strictly performed using HTTP `GET` requests.
2. **Zero Mutation Calls**: AgentHub Desktop must **never** send `POST`, `PUT`, `PATCH`, or `DELETE` requests to AgentHub Core under `V0.8.1`.
3. **No Mutation Headers**: AgentHub Desktop must **never** send `Idempotency-Key` or any headers reserved for mutation commands.
4. **No Task/Review/Merge Actions**: All operations related to task creation, status transitions, review submissions, or worktree merges in AgentHub Core are out of scope for `V0.8.1`.

---

## 3. Invariant 2: Loopback Network Boundary

1. **Strict 127.0.0.1 Binding**: AgentHub Desktop will only connect to `127.0.0.1` on port `3210` by default (`http://127.0.0.1:3210` and `ws://127.0.0.1:3210/api/v1/realtime`).
2. **Rejection of Non-Loopback Targets**:
   - `0.0.0.0` is forbidden.
   - LAN IP ranges (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`) are forbidden.
   - Remote hosts and public IPs are forbidden.
   - Hostnames requiring external DNS resolution are rejected.
3. **Protocol Enforcement**: Only unencrypted HTTP/WS over loopback is permitted. HTTPS/WSS is rejected to prevent MITM proxies or remote misconfigurations.

---

## 4. Invariant 3: Unidirectional Realtime Stream

1. **Server-to-Client Only**: The WebSocket connection at `/api/v1/realtime` is strictly server-to-client.
2. **No Outbound Frames**: AgentHub Desktop client must never send application frames over the WebSocket. (AgentHub Core rejects any inbound client message with status code `1008`).
3. **Hello Handshake Validation**: Upon connection, AgentHub Desktop waits for the initial server hello frame (`{ type: "hello", version: 1 }`). If the version is incompatible, the socket is immediately terminated.
4. **Coalesced Resync**: Realtime WebSocket events serve purely as cache invalidation signals. Upon receiving an event, AgentHub Desktop triggers a debounced (50ms) REST fetch of `/api/v1/state` to maintain an authoritative, atomic snapshot.

---

## 5. Invariant 4: Privacy & Information Architecture

1. **No Backend Private Paths**: AgentHub Desktop DTOs and state models strictly mirror public API fields (`projectId`, `agentId`, `taskId`, `status`, `title`, etc.).
2. **No Leakage of Private Filesystem Metadata**: The client does not accept, display, or store backend-internal absolute paths such as:
   - `repositoryRoot`
   - `worktreePath`
   - Agent execution `cwd`
   - Process environment variables or secrets

---

## 6. Invariant 5: Fault Tolerance & Graceful Degradation

1. **Offline Safety**: If AgentHub Core is not running or fails to start, AgentHub Desktop runs completely normally. Offline status is shown via a subtle grey badge (`AgentHub: Offline`).
2. **Degraded State Handling**: If a realtime WebSocket drops while an existing state snapshot is cached, the connection transitions to `degraded`. Cached data is preserved, and exponential backoff reconnection (1s, 2s, 5s, 10s max) is automatically engaged.
3. **Zero Main Thread Blocking**: All network operations are asynchronous, subject to a strict 5000ms timeout, and will never stall the Electron main thread or renderer UI.
