"""Which addresses the phone can reach this PC on, and what might block it."""

from __future__ import annotations

import json
import shutil
import socket
import subprocess

_SKIP_PREFIXES = ("lo", "docker", "br-", "veth", "virbr")


def lan_addresses() -> list[dict]:
    """IPv4 addresses on real interfaces, most likely LAN address first."""
    addresses: list[dict] = []
    ip = shutil.which("ip")
    if ip:
        try:
            out = subprocess.run([ip, "-j", "-4", "addr", "show"], capture_output=True, text=True, timeout=2).stdout
            for iface in json.loads(out or "[]"):
                name = iface.get("ifname", "")
                if name.startswith(_SKIP_PREFIXES):
                    continue
                for addr in iface.get("addr_info", []):
                    if addr.get("family") == "inet" and addr.get("local"):
                        addresses.append({"iface": name, "address": addr["local"]})
        except (OSError, ValueError, subprocess.SubprocessError):
            addresses = []
    if not addresses:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            try:
                s.connect(("192.0.2.1", 9))  # no packet is sent; this just picks the outgoing interface
                addresses.append({"iface": "default", "address": s.getsockname()[0]})
            except OSError:
                pass
    # Private LAN ranges first (the phone is almost certainly on one), VPNs last.
    addresses.sort(key=lambda a: (not a["address"].startswith(("192.168.", "10.", "172.")), a["iface"]))
    return addresses


def active_firewalls() -> list[str]:
    """Firewall services that are running (they block the phone's UDP packets until allowed)."""
    systemctl = shutil.which("systemctl")
    if systemctl is None:
        return []
    active = []
    for service in ("ufw", "firewalld"):
        try:
            state = subprocess.run([systemctl, "is-active", service], capture_output=True, text=True, timeout=2).stdout
        except (OSError, subprocess.SubprocessError):
            continue
        if state.strip() == "active":
            active.append(service)
    return active
