import requests
import json

def check(name, url, method="GET", data=None):
    try:
        if method == "GET":
            r = requests.get(url, timeout=1)
        else:
            r = requests.post(url, json=data, timeout=2)
        status = "✅" if r.status_code == 200 else "⚠️"
        print(f"{status} {name:.<30} {r.status_code}")
        return r.json()
    except:
        print(f"❌ {name:.<30} OFFLINE")
        return None

print("\n--- SWARM CORE V3.2 DIAGNOSTICS ---")
# Check Infrastructure
check("Proxy API (3000)", "http://localhost:3000/discover")
check("WS Stream (3001)", "http://localhost:3001") # Just checking port bind

# Check Agents
for port in ["8080", "8081", "8082"]:
    check(f"Agent Port {port}", f"http://localhost:{port}/health")

print("-----------------------------------\n")
