import socket
import time

HOST = "192.168.255.128"
PORT = 5000

with socket.create_connection((HOST, PORT), timeout=5) as client:
    client.settimeout(2)

    # Clear any initial console output
    try:
        client.recv(8192)
    except socket.timeout:
        pass

    # Send a read-only command
    client.sendall(b"show ip route\r\n")

    time.sleep(2)

    output = b""

    while True:
        try:
            data = client.recv(8192)
            if not data:
                break
            output += data
        except socket.timeout:
            break

    print("ROUTER1 ROUTING TABLE")
    print(output.decode("utf-8", errors="replace"))