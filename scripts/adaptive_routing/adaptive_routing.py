
import heapq
import socket
import time
import requests
# ==========================================
# GNS3 CONFIGURATION
# ==========================================

R1_HOST = "192.168.255.128"
R1_PORT = 5000

DESTINATION = "192.168.2.0/24"

R2_NEXT_HOP = "192.168.12.2"
R3_NEXT_HOP = "10.0.13.2"

def get_backend_route():
    url = "http://127.0.0.1:5002/api/routing/decisions?limit=1"

    response = requests.get(url, timeout=10)
    response.raise_for_status()

    data = response.json()
    decisions = data.get("data", [])

    if not decisions:
        raise RuntimeError("No routing decision found in backend.")

    path = decisions[0].get("routerPath")

    if not path or path[0] != "R1" or path[-1] != "R4":
        raise RuntimeError(f"Invalid backend route: {path}")

    print("\nROUTE RECEIVED FROM NODE BACKEND:", path)
    return path

# ==========================================
# NETWORK TOPOLOGY
# ==========================================

network = {
    "R1": {"R2": 2, "R3": 5},
    "R2": {"R1": 2, "R4": 2},
    "R3": {"R1": 5, "R4": 1},
    "R4": {"R2": 2, "R3": 1}
}


# ==========================================
# DIJKSTRA ALGORITHM
# ==========================================

def shortest_path(graph, start, end):
    queue = [(0, start, [start])]
    visited = set()

    while queue:
        cost, node, path = heapq.heappop(queue)

        if node == end:
            return cost, path

        if node in visited:
            continue

        visited.add(node)

        for neighbor, link_cost in graph[node].items():
            if neighbor not in visited:
                heapq.heappush(
                    queue,
                    (cost + link_cost, neighbor, path + [neighbor])
                )

    return float("inf"), []


# ==========================================
# SEND COMMANDS TO ROUTER1
# ==========================================

def configure_router1(commands):

    try:
        with socket.create_connection(
            (R1_HOST, R1_PORT), timeout=5
        ) as client:

            client.settimeout(0.5)

            # Clear initial console output
            try:
                client.recv(8192)
            except socket.timeout:
                pass

            for command in commands:
                client.sendall(command.encode() + b"\r\n")
                time.sleep(0.7)

            time.sleep(1)

            output = b""

            while True:
                try:
                    data = client.recv(8192)
                    if not data:
                        break
                    output += data
                except socket.timeout:
                    break

            return output.decode("utf-8", errors="replace")

    except Exception as error:
        return f"Router error: {error}"


# ==========================================
# MAIN ADAPTIVE ROUTING PROGRAM
# ==========================================

if __name__ == "__main__":

    print("=" * 55)
    print("PREDICTIVE TELEMETRY-DRIVEN ADAPTIVE ROUTING")
    print("=" * 55)

    # Step 1: Get the selected route from Node.js backend
    print("\nFETCHING ROUTE FROM NODE.JS BACKEND...")

    try:
        path = get_backend_route()

    except Exception as error:
        print("Backend route retrieval failed:", error)
        raise SystemExit(1)

    print("\nBACKEND SELECTED ROUTE:")
    print(" -> ".join(path))

    # Step 2: Identify the next hop
    if path == ["R1", "R3", "R4"]:
        selected_next_hop = R3_NEXT_HOP

    elif path == ["R1", "R2", "R4"]:
        selected_next_hop = R2_NEXT_HOP

    else:
        print("Unexpected route. No changes applied.")
        raise SystemExit(1)

    # Step 3: Apply the backend-selected route to GNS3
    print("\nAPPLYING BACKEND ROUTE TO GNS3 ROUTER1...")

    commands = [
        "configure terminal",
        f"no ip route {DESTINATION} {R2_NEXT_HOP} 1",
        f"no ip route {DESTINATION} {R2_NEXT_HOP} 10",
        f"no ip route {DESTINATION} {R3_NEXT_HOP} 1",
        f"no ip route {DESTINATION} {R3_NEXT_HOP} 10",
        f"ip route {DESTINATION} {selected_next_hop}",
        "end",
        f"show ip route {DESTINATION}"
    ]

    result = configure_router1(commands)

    print("\nROUTER1 RESPONSE:")
    print(result)

    print("\nADAPTIVE ROUTING EXECUTION FINISHED.")